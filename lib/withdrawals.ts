import { getCountry, formatMoney } from "./countries";

/**
 * The withdrawal gate.
 *
 * Three gates in order; the player only ever sees the first one they fail.
 * This module is the single source of that rule, read by the withdraw sheet,
 * the withdrawal endpoint and the admin players list alike — so the console can
 * never offer Approve to someone the endpoint would still block.
 */

export type GateName = "details" | "deposits" | "approval";

export interface GateSubject {
  country_code: string;
  currency: string;
  balance: number | string;
  total_deposited: number | string;
  qualifying_deposits: number;
  withdrawal_approved: boolean;
  payout_number?: string | null;
  payout_bank?: string | null;
}

export interface GateResult {
  ok: boolean;
  failed?: GateName;
  message?: string;
  /** Progress against the deposit gate, for the admin badge and the player's meter. */
  progress: { have: number; need: number; label: string };
}

export interface PayoutDetails {
  number?: string;
  bank?: string;
}

export function checkWithdrawalGate(
  user: GateSubject,
  amount: number,
  details: PayoutDetails = {},
): GateResult {
  const country = getCountry(user.country_code);
  const useCount = country.withdrawQualifyCount > 0;

  const progress = useCount
    ? {
        have: Number(user.qualifying_deposits),
        need: country.withdrawQualifyCount,
        label: `${user.qualifying_deposits}/${country.withdrawQualifyCount} deposits of ${formatMoney(
          country.withdrawQualifyAmount,
          country.currency,
        )}+`,
      }
    : {
        have: Number(user.total_deposited),
        need: country.withdrawQualifyAmount,
        label: `${formatMoney(Number(user.total_deposited), country.currency)} of ${formatMoney(
          country.withdrawQualifyAmount,
          country.currency,
        )} deposited`,
      };

  // --- Gate 1: payout details -------------------------------------------
  const number = (details.number ?? user.payout_number ?? "").replace(/\s/g, "");
  const bank = details.bank ?? user.payout_bank ?? "";

  if (country.payoutRail === "mobile") {
    const digits = number.replace(/\D/g, "");
    if (digits.length < country.phoneDigits) {
      return { ok: false, failed: "details", message: `Enter a valid ${country.name} mobile money number`, progress };
    }
  } else {
    if (number.replace(/\D/g, "").length < 8) {
      return { ok: false, failed: "details", message: "Enter a valid account number", progress };
    }
    if (!bank.trim()) {
      return { ok: false, failed: "details", message: "Select your bank", progress };
    }
  }

  // --- Gate 2: the deposit gate -----------------------------------------
  // Deposits are counted, not summed: paying the whole qualifying sum in a
  // single deposit unlocks nothing. A market can be dropped back to the older
  // cumulative-total rule with WITHDRAW_QUALIFY_COUNT_<CC>=0.
  if (useCount) {
    if (Number(user.qualifying_deposits) < country.withdrawQualifyCount) {
      const remaining = country.withdrawQualifyCount - Number(user.qualifying_deposits);
      return {
        ok: false,
        failed: "deposits",
        message: `${remaining} more deposit${remaining === 1 ? "" : "s"} of ${formatMoney(
          country.withdrawQualifyAmount,
          country.currency,
        )} or more needed to unlock withdrawals`,
        progress,
      };
    }
  } else if (Number(user.total_deposited) < country.withdrawQualifyAmount) {
    return {
      ok: false,
      failed: "deposits",
      message: `Deposit ${formatMoney(
        country.withdrawQualifyAmount - Number(user.total_deposited),
        country.currency,
      )} more to unlock withdrawals`,
      progress,
    };
  }

  // --- Gate 3: operator approval ----------------------------------------
  // Rather than a lock screen, the caller records the request as a pending
  // payment and tells the player it is being processed.
  if (!user.withdrawal_approved) {
    return {
      ok: false,
      failed: "approval",
      message: "Your withdrawal is being processed and will be paid shortly.",
      progress,
    };
  }

  if (!(amount > 0) || amount > Number(user.balance)) {
    return { ok: false, failed: "details", message: "Amount is more than your balance", progress };
  }

  return { ok: true, progress };
}

/** Whether the operator's Approve button should be offered at all. */
export function qualifiesForApproval(user: GateSubject): boolean {
  const country = getCountry(user.country_code);
  return country.withdrawQualifyCount > 0
    ? Number(user.qualifying_deposits) >= country.withdrawQualifyCount
    : Number(user.total_deposited) >= country.withdrawQualifyAmount;
}
