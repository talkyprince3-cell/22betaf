import { dbOrThrow } from "./supabase";
import { getCountry } from "./countries";
import { sendSms, paymentReceivedSms } from "./sms";

export const COMMISSION_RATE = 0.7;
export const MAX_VERIFICATION_STEP = 4;

export interface CreditResult {
  credited: boolean;
  /** False when the reference had already credited — the caller should treat this as success. */
  duplicate?: boolean;
  balance?: number;
  bonusPaid?: number;
  reason?: string;
}

/**
 * The single choke point for money entering a wallet. Every deposit rail —
 * Flutterwave, Korapay, Moolre, Paystack, Telegram and the manual mobile-money
 * rail — funnels into this function without exception.
 *
 * Step 1 moves the money. Steps 2 to 5 are all best-effort: the deposit is
 * already credited by the time they run, so a failure in any of them is logged
 * and swallowed rather than being allowed to roll back a credited deposit.
 */
export async function applyDepositCredit(opts: {
  userId: string;
  amount: number;
  currency: string;
  reference: string;
  provider: string;
}): Promise<CreditResult> {
  const { userId, amount, currency, reference, provider } = opts;
  const supabase = dbOrThrow();

  if (!(amount > 0)) return { credited: false, reason: "Amount must be positive" };

  // --- Idempotency -------------------------------------------------------
  // A payment reference can only ever credit once. This guarded update is what
  // makes the credit safe against two webhooks landing at the same instant:
  // only the run that actually transitions the row out of pending proceeds.
  // The amount goes back on the row as part of the claim: a charge that settled
  // short of what was asked for is worth what settled, and the console, the
  // receipt and the credit should all be reading the same figure.
  const { data: claimed, error: claimErr } = await supabase
    .from("payments")
    .update({ status: "confirmed", resolved_at: new Date().toISOString(), amount })
    .eq("reference", reference)
    .in("status", ["pending", "failed"])
    .select("id, user_id, amount, currency")
    .maybeSingle();

  if (claimErr) {
    console.error("[deposit] could not claim payment", reference, claimErr);
    return { credited: false, reason: "Could not claim payment" };
  }

  if (!claimed) {
    // Either it never existed, or another run already credited it.
    const { data: existing } = await supabase
      .from("payments")
      .select("status")
      .eq("reference", reference)
      .maybeSingle();

    if (existing?.status === "confirmed" || existing?.status === "resolved") {
      return { credited: false, duplicate: true, reason: "Already credited" };
    }
    return { credited: false, reason: "Payment not found" };
  }

  // --- Step 1: credit the wallet (the only step allowed to fail loudly) ---
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select(
      "id, phone, currency, country_code, balance, total_deposited, first_deposit_at, bonus_paid, verification_step, qualifying_deposits, referred_by",
    )
    .eq("id", userId)
    .single();

  if (userErr || !user) {
    console.error("[deposit] player missing, releasing claim", userId, userErr);
    await supabase
      .from("payments")
      .update({ status: "pending", resolved_at: null })
      .eq("reference", reference);
    return { credited: false, reason: "Player not found" };
  }

  const isFirst = !user.first_deposit_at;
  const newBalance = Number(user.balance) + amount;

  const { error: creditErr } = await supabase
    .from("users")
    .update({
      balance: newBalance,
      total_deposited: Number(user.total_deposited) + amount,
      ...(isFirst ? { first_deposit_at: new Date().toISOString() } : {}),
    })
    .eq("id", userId);

  if (creditErr) {
    console.error("[deposit] credit failed, releasing claim", reference, creditErr);
    await supabase
      .from("payments")
      .update({ status: "pending", resolved_at: null })
      .eq("reference", reference);
    return { credited: false, reason: "Could not credit wallet" };
  }

  let balance = newBalance;
  let bonusPaid = 0;

  // --- Step 2: one-time welcome bonus ------------------------------------
  // A pure gift. It does not count toward verification and earns no commission.
  if (isFirst && !user.bonus_paid) {
    const bonus = Number(process.env.FIRST_DEPOSIT_BONUS ?? 100);
    if (bonus > 0) {
      try {
        const withBonus = balance + bonus;
        const { error } = await supabase
          .from("users")
          .update({ balance: withBonus, bonus_paid: true })
          .eq("id", userId)
          .eq("bonus_paid", false);
        if (error) throw error;
        balance = withBonus;
        bonusPaid = bonus;
      } catch (err) {
        console.error("[deposit] welcome bonus failed (deposit stands)", userId, err);
      }
    }
  }

  // --- Step 3: referral commission ---------------------------------------
  // Fires on every deposit, not just the first.
  if (user.referred_by) {
    await payCommission({
      subAdminId: user.referred_by,
      userId,
      amount,
      currency,
      reference,
    }).catch((err) => {
      console.error("[deposit] COMMISSION BACKFILL REQUIRED", { reference, userId, err });
    });
  }

  const country = getCountry(user.country_code);

  // --- Step 4: advance verification, capped at 4 -------------------------
  if (amount >= country.verificationAmount) {
    try {
      const next = Math.min(MAX_VERIFICATION_STEP, Number(user.verification_step) + 1);
      const { error } = await supabase
        .from("users")
        .update({ verification_step: next })
        .eq("id", userId);
      if (error) throw error;
    } catch (err) {
      console.error("[deposit] verification step failed (deposit stands)", userId, err);
    }
  }

  // --- Step 5: withdrawal-gate tick, then the payment-received SMS --------
  if (amount >= country.withdrawQualifyAmount) {
    try {
      const { error } = await supabase
        .from("users")
        .update({ qualifying_deposits: Number(user.qualifying_deposits) + 1 })
        .eq("id", userId);
      if (error) throw error;
    } catch (err) {
      console.error("[deposit] qualifying tick failed (deposit stands)", userId, err);
    }
  }

  try {
    await sendSms(user.phone, paymentReceivedSms(amount, currency, balance));
  } catch (err) {
    console.error("[deposit] SMS failed (deposit stands)", userId, err);
  }

  console.info("[deposit] credited", { reference, provider, userId, amount, currency, bonusPaid });
  return { credited: true, balance, bonusPaid };
}

/**
 * 70% of every confirmed deposit, credited to the referring partner in the
 * player's own currency. Skipped with a logged reason for an unapproved
 * partner. Retried once before giving up.
 */
async function payCommission(opts: {
  subAdminId: string;
  userId: string;
  amount: number;
  currency: string;
  reference: string;
}): Promise<void> {
  const { subAdminId, userId, amount, currency, reference } = opts;
  const supabase = dbOrThrow();

  const attempt = async (): Promise<void> => {
    const { data: partner, error } = await supabase
      .from("sub_admins")
      .select("id, approved, balances, lifetime")
      .eq("id", subAdminId)
      .single();

    if (error || !partner) throw error ?? new Error("partner not found");

    if (!partner.approved) {
      console.info("[commission] skipped, partner not approved", { subAdminId, reference });
      return;
    }

    const earned = Math.round(amount * COMMISSION_RATE * 100) / 100;

    // Balances are held per currency, so a partner working Ghana and Nigeria
    // sees each market separately rather than a meaningless sum.
    const balances = { ...((partner.balances ?? {}) as Record<string, number>) };
    const lifetime = { ...((partner.lifetime ?? {}) as Record<string, number>) };
    balances[currency] = Math.round(((balances[currency] ?? 0) + earned) * 100) / 100;
    lifetime[currency] = Math.round(((lifetime[currency] ?? 0) + earned) * 100) / 100;

    const { error: insErr } = await supabase.from("commissions").insert({
      sub_admin_id: subAdminId,
      user_id: userId,
      payment_reference: reference,
      deposit_amount: amount,
      currency,
      rate: COMMISSION_RATE,
      amount: earned,
    });

    // The unique index on payment_reference makes a double-pay impossible.
    if (insErr) {
      if ((insErr as { code?: string }).code === "23505") {
        console.info("[commission] already paid for reference", reference);
        return;
      }
      throw insErr;
    }

    const { error: balErr } = await supabase
      .from("sub_admins")
      .update({ balances, lifetime })
      .eq("id", subAdminId);
    if (balErr) throw balErr;

    console.info("[commission] paid", { subAdminId, earned, currency, reference });
  };

  try {
    await attempt();
  } catch (first) {
    console.warn("[commission] first attempt failed, retrying", reference, first);
    await attempt();
  }
}

/**
 * Reverse a mistaken deposit: take the money back and give back the
 * qualifying-deposit tick. Used by the admin deposits screen.
 */
export async function reverseDeposit(reference: string): Promise<{ ok: boolean; reason?: string }> {
  const supabase = dbOrThrow();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, user_id, amount, currency, status")
    .eq("reference", reference)
    .maybeSingle();

  if (!payment) return { ok: false, reason: "Payment not found" };

  const { data: user } = await supabase
    .from("users")
    .select("id, balance, total_deposited, qualifying_deposits, country_code")
    .eq("id", payment.user_id)
    .single();

  if (!user) return { ok: false, reason: "Player not found" };

  const amount = Number(payment.amount);
  const country = getCountry(user.country_code);
  const wasQualifying = amount >= country.withdrawQualifyAmount;

  await supabase
    .from("users")
    .update({
      balance: Math.max(0, Number(user.balance) - amount),
      total_deposited: Math.max(0, Number(user.total_deposited) - amount),
      qualifying_deposits: wasQualifying
        ? Math.max(0, Number(user.qualifying_deposits) - 1)
        : user.qualifying_deposits,
    })
    .eq("id", user.id);

  await supabase.from("payments").delete().eq("reference", reference);

  console.info("[deposit] reversed", { reference, amount });
  return { ok: true };
}
