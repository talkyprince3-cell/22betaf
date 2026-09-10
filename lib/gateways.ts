import type { Gateway } from "./countries";
import {
  cardsConfigured,
  chargePaid,
  createCharge,
  createCustomer,
  createMobileMoneyPaymentMethod,
  findChargeByReference,
  getCharge,
  v4Configured,
} from "./flutterwave-v4";

/**
 * Payment gateway adapters.
 *
 * Each rail has its own start / status shape, but they all end at the same
 * place: a confirmed status hands the reference to applyDepositCredit, which is
 * the only function allowed to move money into a wallet.
 *
 * Every adapter degrades to a clear error rather than throwing, so a missing
 * key shows the player a message instead of a stack trace.
 */

export type ChargeStatus = "pending" | "confirmed" | "failed";

/**
 * What the rail says became of a charge.
 *
 * The settled amount matters as much as the status. A player can start a
 * GH₵500 deposit and approve GH₵5 on the handset, and the rail will call that
 * successful — it is, it just is not the deposit that was asked for. Every
 * adapter that can report what actually arrived does, and the credit path uses
 * that figure rather than the one the player typed in.
 */
export interface ChargeOutcome {
  status: ChargeStatus;
  /** What the rail says actually settled. Absent when the rail does not say. */
  paidAmount?: number;
  paidCurrency?: string;
}

export interface StartResult {
  ok: boolean;
  /** Anything the payment row should remember, such as the rail's charge id. */
  metadata?: Record<string, unknown>;
  /** Hosted checkout URL, when the rail redirects. */
  redirectUrl?: string;
  /** True when the player must approve a prompt on their handset. */
  awaitingPrompt?: boolean;
  /** True when the rail additionally wants an OTP typed in. */
  awaitingOtp?: boolean;
  error?: string;
}

export interface GatewayAdapter {
  id: Gateway;
  label: string;
  start(opts: StartOpts): Promise<StartResult>;
  /** `meta` is the payment row's metadata, which may carry the charge id. */
  status(reference: string, meta?: Record<string, unknown>): Promise<ChargeOutcome>;
}

export interface StartOpts {
  reference: string;
  amount: number;
  currency: string;
  phone: string;
  email: string;
  name: string;
  redirectUrl: string;
}

function env(name: string): string | null {
  return process.env[name] || null;
}

// ------------------------------------------------------------ Flutterwave

/**
 * The network has to be named on a Ghana mobile-money charge, and the number's
 * prefix is the only thing we have to name it from.
 *
 * Unknown prefixes fall to MTN, which carries most of the country. Getting it
 * wrong costs a rejected charge and a clear message, not a lost payment.
 *
 * Telecel Cash is still VODAFONE to the rail, whatever the network calls itself
 * now. These are the codes a working v4 integration sends.
 */
export function ghanaNetwork(phone: string): "MTN" | "VODAFONE" | "AIRTELTIGO" {
  const digits = String(phone || "").replace(/\D/g, "");
  // Reduce to the local significant number, however it was typed.
  const local = digits.startsWith("233") ? digits.slice(3) : digits.replace(/^0+/, "");
  const prefix = local.slice(0, 2);
  if (prefix === "20" || prefix === "50") return "VODAFONE";
  if (prefix === "26" || prefix === "27" || prefix === "56" || prefix === "57") return "AIRTELTIGO";
  return "MTN";
}

/**
 * Ask v4 how a charge ended up.
 *
 * The charge id is the authoritative way to ask, so it is used whenever the
 * payment row kept one. Looking it up by our own reference is the fallback for
 * a row written before the id came back.
 */
async function v4Outcome(reference: string, meta?: Record<string, unknown>): Promise<ChargeOutcome> {
  const chargeId = typeof meta?.charge_id === "string" ? meta.charge_id : undefined;
  const charge = chargeId ? await getCharge(chargeId) : await findChargeByReference(reference);

  // A charge that is not there yet is a player still holding the prompt. That
  // is pending, not failed — failing it would strand them.
  if (!charge) return { status: "pending" };

  const s = String(charge.status ?? "").toLowerCase();
  const status: ChargeStatus = chargePaid(charge)
    ? "confirmed"
    : s === "failed" || s === "voided"
      ? "failed"
      : "pending";
  const paid = Number(charge.amount);
  return {
    status,
    paidAmount: Number.isFinite(paid) && paid > 0 ? paid : undefined,
    paidCurrency: charge.currency,
  };
}

/**
 * Ghana: a mobile-money charge the player approves on the handset.
 *
 * Three calls make one charge on v4 — the customer, the payment method, then
 * the charge itself — and the player sees none of that. They see the prompt.
 */
const flutterwaveMomo: GatewayAdapter = {
  id: "flutterwave_momo",
  label: "Mobile money",
  async start({ reference, amount, currency, phone, email, name }) {
    if (!v4Configured()) return { ok: false, error: "Mobile money is not available right now" };

    const customer = await createCustomer({
      email: email || `${phone}@3btafric.com`,
      name,
      phone,
      dialCode: "233",
      reference,
    });
    if (!customer.ok || !customer.data?.id) {
      return { ok: false, error: customer.error ?? "Could not start the charge" };
    }

    const method = await createMobileMoneyPaymentMethod({
      countryCode: "233",
      network: ghanaNetwork(phone),
      phone,
    });
    if (!method.ok || !method.data?.id) {
      return { ok: false, error: method.error ?? "That number was not accepted" };
    }

    const charge = await createCharge({
      reference,
      amount,
      currency,
      customerId: customer.data.id,
      paymentMethodId: method.data.id,
      redirectUrl: "",
    });
    if (!charge.ok || !charge.data) {
      return { ok: false, error: charge.error ?? "Could not start the charge" };
    }

    const step = charge.data.step;
    return {
      ok: true,
      metadata: { charge_id: charge.data.chargeId },
      redirectUrl: step.kind === "redirect" ? step.url : undefined,
      awaitingPrompt: step.kind !== "redirect",
    };
  },
  status: v4Outcome,
};

/**
 * Nigeria: our own checkout page, on our own domain.
 *
 * There is nothing to call at the start of this one. The player is sent to
 * /checkout, types the card there, and the routes under /api/deposits/card do
 * the talking to Flutterwave v4. All this adapter owes the rest of the app is
 * a way to ask how the charge ended up.
 */
const flutterwaveCard: GatewayAdapter = {
  id: "flutterwave_card",
  label: "Card",
  async start({ reference }) {
    if (!cardsConfigured()) return { ok: false, error: "Card payments are not available right now" };
    return { ok: true, redirectUrl: `/checkout?reference=${encodeURIComponent(reference)}` };
  },
  status: v4Outcome,
};

// ---------------------------------------------------------------- Korapay

const korapay: GatewayAdapter = {
  id: "korapay",
  label: "Korapay",
  async start({ reference, amount, currency, email, name, redirectUrl }) {
    const key = env("KORAPAY_SECRET_KEY");
    if (!key) return { ok: false, error: "Korapay is not available right now" };
    try {
      const res = await fetch("https://api.korapay.com/merchant/api/v1/charges/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          amount,
          currency,
          redirect_url: redirectUrl,
          customer: { email: email || "player@3btafric.com", name },
          notification_url: `${redirectUrl.split("/account")[0]}/api/deposits/korapay/webhook`,
        }),
      });
      const json = await res.json();
      if (!json?.status) return { ok: false, error: json?.message ?? "Could not start checkout" };
      return { ok: true, redirectUrl: json.data?.checkout_url };
    } catch (err) {
      console.error("[korapay] start", err);
      return { ok: false, error: "Could not start checkout" };
    }
  },
  async status(reference) {
    const key = env("KORAPAY_SECRET_KEY");
    if (!key) return { status: "pending" };
    try {
      const res = await fetch(`https://api.korapay.com/merchant/api/v1/charges/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const json = await res.json();
      const s = String(json?.data?.status ?? "").toLowerCase();
      const status: ChargeStatus =
        s === "success" ? "confirmed" : s === "failed" || s === "expired" ? "failed" : "pending";
      const paid = Number(json?.data?.amount);
      return {
        status,
        paidAmount: Number.isFinite(paid) && paid > 0 ? paid : undefined,
        paidCurrency: json?.data?.currency,
      };
    } catch {
      return { status: "pending" };
    }
  },
};

// ----------------------------------------------------------------- Moolre

const moolre: GatewayAdapter = {
  id: "moolre",
  label: "Moolre",
  async start({ reference, amount, currency, phone }) {
    const key = env("MOOLRE_API_KEY");
    const user = env("MOOLRE_API_USER");
    const account = env("MOOLRE_ACCOUNT_NUMBER");
    if (!key || !user || !account) return { ok: false, error: "Moolre is not available right now" };
    try {
      const res = await fetch("https://api.moolre.com/open/transact/receive", {
        method: "POST",
        headers: { "X-API-USER": user, "X-API-PUBKEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 1,
          channel: 13,
          currency,
          payer: phone,
          amount,
          accountnumber: account,
          reference,
          externalref: reference,
        }),
      });
      const json = await res.json();
      if (json?.status !== 1) return { ok: false, error: json?.message ?? "Could not start the charge" };
      return { ok: true, awaitingPrompt: true };
    } catch (err) {
      console.error("[moolre] start", err);
      return { ok: false, error: "Could not start the charge" };
    }
  },
  async status(reference) {
    const key = env("MOOLRE_API_KEY");
    const user = env("MOOLRE_API_USER");
    const account = env("MOOLRE_ACCOUNT_NUMBER");
    if (!key || !user || !account) return { status: "pending" };
    try {
      const res = await fetch("https://api.moolre.com/open/transact/status", {
        method: "POST",
        headers: { "X-API-USER": user, "X-API-PUBKEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ type: 1, accountnumber: account, externalref: reference }),
      });
      const json = await res.json();
      const code = Number(json?.data?.txstatus ?? json?.status);
      const status: ChargeStatus = code === 1 ? "confirmed" : code === 2 || code === 3 ? "failed" : "pending";
      const paid = Number(json?.data?.amount);
      return {
        status,
        paidAmount: Number.isFinite(paid) && paid > 0 ? paid : undefined,
        paidCurrency: json?.data?.currency,
      };
    } catch {
      return { status: "pending" };
    }
  },
};

// ---------------------------------------------------------------- Paystack

const paystack: GatewayAdapter = {
  id: "paystack",
  label: "Paystack",
  async start({ reference, amount, currency, email, phone, redirectUrl }) {
    const key = env("PAYSTACK_SECRET_KEY");
    if (!key) return { ok: false, error: "Paystack is not available right now" };
    try {
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          // Paystack takes the minor unit.
          amount: Math.round(amount * 100),
          currency,
          email: email || `${phone}@3btafric.com`,
          callback_url: redirectUrl,
        }),
      });
      const json = await res.json();
      if (!json?.status) return { ok: false, error: json?.message ?? "Could not start checkout" };
      return { ok: true, redirectUrl: json.data?.authorization_url };
    } catch (err) {
      console.error("[paystack] start", err);
      return { ok: false, error: "Could not start checkout" };
    }
  },
  async status(reference) {
    const key = env("PAYSTACK_SECRET_KEY");
    if (!key) return { status: "pending" };
    try {
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const json = await res.json();
      const s = String(json?.data?.status ?? "").toLowerCase();
      const status: ChargeStatus =
        s === "success" ? "confirmed" : s === "failed" || s === "abandoned" ? "failed" : "pending";
      // Paystack reports in the minor unit.
      const paid = Number(json?.data?.amount) / 100;
      return {
        status,
        paidAmount: Number.isFinite(paid) && paid > 0 ? paid : undefined,
        paidCurrency: json?.data?.currency,
      };
    } catch {
      return { status: "pending" };
    }
  },
};

/**
 * The manual rail: the player sends money to the displayed agent number and
 * uploads a screenshot. Nothing is automatic, so the status stays pending until
 * the operator confirms it in the console.
 */
const manual: GatewayAdapter = {
  id: "manual",
  label: "Mobile money transfer",
  async start() {
    return { ok: true };
  },
  async status(): Promise<ChargeOutcome> {
    return { status: "pending" };
  },
};

const ADAPTERS: Record<Gateway, GatewayAdapter> = {
  flutterwave_momo: flutterwaveMomo,
  flutterwave_card: flutterwaveCard,
  korapay,
  moolre,
  paystack,
  manual,
};

/**
 * What a confirmed charge is actually worth.
 *
 * The rail's own figure wins whenever it gives one in the currency the deposit
 * was opened in. Everything else — a rail that reports nothing, a figure that
 * arrives in another currency — falls back to what the player asked for, which
 * is the best guess available and the behaviour that stood before.
 */
export function settledAmount(outcome: ChargeOutcome, requested: number, currency: string): number {
  const paid = outcome.paidAmount;
  if (!paid || !Number.isFinite(paid) || paid <= 0) return requested;
  if (outcome.paidCurrency && outcome.paidCurrency.toUpperCase() !== String(currency).toUpperCase()) {
    return requested;
  }
  return paid;
}

export function adapterFor(gateway: Gateway): GatewayAdapter {
  return ADAPTERS[gateway] ?? manual;
}

export function allAdapters(): GatewayAdapter[] {
  return Object.values(ADAPTERS);
}
