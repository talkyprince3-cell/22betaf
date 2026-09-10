/**
 * Per-country configuration. The country a player registers with decides their
 * wallet currency, minimum deposit, KYC shape, payment gateway, payout rail and
 * withdrawal gate. Every one of those values is env-overridable per deployment.
 */

export type PayoutRail = "mobile" | "bank";
export type Gateway =
  | "flutterwave_momo"
  | "flutterwave_card"
  | "korapay"
  | "moolre"
  | "paystack"
  | "manual";

export type KycKind = "bvn" | "nin" | "national_id";

export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  dialCode: string;
  /** Local significant digits, after the leading 0 and dial code are stripped. */
  phoneDigits: number;
  gateway: Gateway;
  payoutRail: PayoutRail;
  kyc: { kind: KycKind; label: string; pattern: RegExp; hint: string }[];
  minFirstDeposit: number;
  /** Smallest top-up once the account is funded. */
  minDeposit: number;
  /** Largest single transaction the rail will take. */
  maxDeposit: number;
  verificationAmount: number;
  /** Qualifying deposits needed to unlock withdrawals. 0 reverts to the cumulative-total rule. */
  withdrawQualifyCount: number;
  withdrawQualifyAmount: number;
  networks: string[];
}

const BASE: Record<string, CountryConfig> = {
  GH: {
    code: "GH",
    name: "Ghana",
    currency: "GHS",
    currencySymbol: "GH₵",
    dialCode: "233",
    phoneDigits: 9,
    gateway: "flutterwave_momo",
    payoutRail: "mobile",
    // Ghana collects no KYC value at sign-up; identity is carried by the
    // mobile-money number, which is already name-verified by the network.
    kyc: [],
    minFirstDeposit: 200,
    minDeposit: 1,
    maxDeposit: 50000,
    verificationAmount: 300,
    withdrawQualifyCount: 3,
    withdrawQualifyAmount: 300,
    networks: ["MTN Mobile Money", "Telecel Cash", "AirtelTigo Money"],
  },
  NG: {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    currencySymbol: "₦",
    dialCode: "234",
    phoneDigits: 10,
    // Cards are taken on our own checkout page rather than a hosted one.
    gateway: "flutterwave_card",
    payoutRail: "bank",
    kyc: [
      { kind: "bvn", label: "BVN", pattern: /^\d{11}$/, hint: "11 digits" },
      { kind: "nin", label: "NIN", pattern: /^\d{11}$/, hint: "11 digits" },
    ],
    minFirstDeposit: 500,
    minDeposit: 100,
    maxDeposit: 1000000,
    verificationAmount: 10000,
    withdrawQualifyCount: 3,
    withdrawQualifyAmount: 10000,
    networks: ["Bank transfer"],
  },
  KE: {
    code: "KE",
    name: "Kenya",
    currency: "KES",
    currencySymbol: "KSh",
    dialCode: "254",
    phoneDigits: 9,
    gateway: "manual",
    payoutRail: "mobile",
    kyc: [{ kind: "national_id", label: "National ID", pattern: /^\d{7,8}$/, hint: "7 or 8 digits" }],
    minFirstDeposit: 50,
    minDeposit: 10,
    maxDeposit: 150000,
    verificationAmount: 2000,
    withdrawQualifyCount: 3,
    withdrawQualifyAmount: 2000,
    networks: ["M-Pesa", "Airtel Money"],
  },
  ZA: {
    code: "ZA",
    name: "South Africa",
    currency: "ZAR",
    currencySymbol: "R",
    dialCode: "27",
    phoneDigits: 9,
    gateway: "manual",
    payoutRail: "bank",
    kyc: [{ kind: "national_id", label: "ID number", pattern: /^\d{13}$/, hint: "13 digits" }],
    minFirstDeposit: 50,
    minDeposit: 10,
    maxDeposit: 50000,
    verificationAmount: 500,
    withdrawQualifyCount: 3,
    withdrawQualifyAmount: 500,
    networks: ["Bank transfer"],
  },
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Country config with the per-country env overrides applied. */
export function getCountry(code: string | null | undefined): CountryConfig {
  const cc = (code ?? "GH").toUpperCase();
  const base = BASE[cc] ?? BASE.GH;
  return {
    ...base,
    minFirstDeposit: num(`MIN_FIRST_DEPOSIT_${base.code}`, base.minFirstDeposit),
    minDeposit: num(`MIN_DEPOSIT_${base.code}`, base.minDeposit),
    maxDeposit: num(`MAX_DEPOSIT_${base.code}`, base.maxDeposit),
    verificationAmount: num(`VERIFICATION_AMOUNT_${base.code}`, base.verificationAmount),
    withdrawQualifyCount: num(`WITHDRAW_QUALIFY_COUNT_${base.code}`, base.withdrawQualifyCount),
    withdrawQualifyAmount: num(`WITHDRAW_QUALIFY_AMOUNT_${base.code}`, base.withdrawQualifyAmount),
  };
}

export function allCountries(): CountryConfig[] {
  return Object.keys(BASE).map((c) => getCountry(c));
}

/** Normalise a local or international number to bare international digits. */
export function normalisePhone(input: string, cc: string): string | null {
  const country = getCountry(cc);
  let d = (input || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith(country.dialCode)) d = d.slice(country.dialCode.length);
  d = d.replace(/^0+/, "");
  if (d.length !== country.phoneDigits) return null;
  return country.dialCode + d;
}

export function validateKyc(value: string, cc: string): { ok: boolean; kind?: KycKind; error?: string } {
  const country = getCountry(cc);

  // A market with no configured shapes does not ask for a KYC value at all.
  if (!country.kyc.length) return { ok: true };

  const v = (value || "").trim().toUpperCase();
  for (const k of country.kyc) {
    if (k.pattern.test(v)) return { ok: true, kind: k.kind };
  }
  const labels = country.kyc.map((k) => `${k.label} (${k.hint})`).join(" or ");
  return { ok: false, error: `Enter a valid ${labels}` };
}

export function formatMoney(amount: number, currency: string): string {
  const c = Object.values(BASE).find((x) => x.currency === currency);
  const symbol = c?.currencySymbol ?? currency;
  return `${symbol}${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}


/** "53****086" — enough of a number to recognise, not enough to reuse. */
export function maskPhoneTail(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length < 6) return d;
  const local = d.length > 9 ? d.slice(-9) : d;
  return `${local.slice(0, 2)}****${local.slice(-3)}`;
}
