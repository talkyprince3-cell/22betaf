import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

/** Platform totals for the overview page, broken out by currency. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  const [{ data: payments }, { count: players }, { count: depositors }, { data: openBets }, { count: pendingDeposits }] =
    await Promise.all([
      supabase.from("payments").select("amount, currency, status, metadata").limit(5000),
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).gt("total_deposited", 0),
      supabase.from("bets").select("stake, potential_win, currency").eq("status", "pending").limit(2000),
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("provider", "manual"),
    ]);

  const deposits: Record<string, number> = {};
  const withdrawals: Record<string, number> = {};

  for (const p of payments ?? []) {
    const meta = (p.metadata ?? {}) as { type?: string };
    const settled = p.status === "confirmed" || p.status === "resolved";
    if (!settled) continue;
    const bucket = meta.type === "withdrawal" ? withdrawals : deposits;
    bucket[p.currency] = Math.round(((bucket[p.currency] ?? 0) + Number(p.amount)) * 100) / 100;
  }

  const liability: Record<string, number> = {};
  let openStake = 0;
  for (const b of openBets ?? []) {
    liability[b.currency] = Math.round(((liability[b.currency] ?? 0) + Number(b.potential_win)) * 100) / 100;
    openStake += Number(b.stake);
  }

  return NextResponse.json({
    deposits,
    withdrawals,
    players: players ?? 0,
    depositors: depositors ?? 0,
    openTickets: openBets?.length ?? 0,
    openStake: Math.round(openStake * 100) / 100,
    liability,
    pendingDeposits: pendingDeposits ?? 0,
  });
}
