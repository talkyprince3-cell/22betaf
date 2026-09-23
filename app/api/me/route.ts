import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getCountry } from "@/lib/countries";
import { checkWithdrawalGate, qualifiesForApproval } from "@/lib/withdrawals";
import { linkedSubAdmin } from "@/lib/partner";

/**
 * The signed-in player's own record.
 *
 * The player id arrives as a query parameter because there is no server
 * session — see the security note in the README. Anything added here is
 * readable by anyone who learns a player id.
 */
export async function GET(req: Request) {
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: user, error } = await supabase
    .from("users")
    .select(
      "id, name, phone, email, country_code, currency, balance, total_deposited, total_withdrawn, verification_step, qualifying_deposits, withdrawal_approved, payout_number, payout_bank, bonus_paid, created_at",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error || !user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const country = getCountry(user.country_code);
  const gate = checkWithdrawalGate(user, 0);

  // Tier points come from turnover, so they are summed off the stakes.
  const { data: staked } = await supabase.from("bets").select("stake").eq("user_id", user.id);
  const tierPoints = (staked ?? []).reduce((sum, b) => sum + Number(b.stake), 0);

  // A partner betting on their own account sees a way back to the dashboard.
  const linked = await linkedSubAdmin(user);
  const { data: partner } = linked
    ? await supabase
        .from("sub_admins")
        .select("id, referral_code, approved")
        .eq("id", linked.id)
        .maybeSingle()
    : { data: null };

  return NextResponse.json({
    user,
    country: {
      code: country.code,
      name: country.name,
      currency: country.currency,
      currencySymbol: country.currencySymbol,
      minFirstDeposit: country.minFirstDeposit,
      gateway: country.gateway,
      payoutRail: country.payoutRail,
      networks: country.networks,
    },
    withdrawal: {
      // A sub-admin meets the deposit verification, then the form opens.
      // Amount is not known on this read, so a passed verification counts as
      // unlocked even though a zero-amount probe can never clear the gate.
      unlocked: Boolean(partner) && qualifiesForApproval(user),
      failed: partner && !qualifiesForApproval(user) ? "deposits" : gate.failed,
      progress: gate.progress,
    },
    partner: partner ?? null,
    tierPoints: Math.floor(tierPoints),
  });
}
