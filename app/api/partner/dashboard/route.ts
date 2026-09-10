import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentPartner, publicPartner } from "@/lib/partner";

export const dynamic = "force-dynamic";

/** Referred players, their deposits and the partner's earnings. */
export async function GET() {
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  const partner = await currentPartner();
  if (!partner) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: players } = await supabase
    .from("users")
    .select("id, name, phone, country_code, currency, total_deposited, created_at")
    .eq("referred_by", partner.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: commissions } = await supabase
    .from("commissions")
    .select("id, user_id, deposit_amount, currency, rate, amount, created_at")
    .eq("sub_admin_id", partner.id)
    .order("created_at", { ascending: false })
    .limit(200);

  // The partner's own betting wallet, when they have opened one.
  let wallet = null;
  if (partner.user_id) {
    const { data } = await supabase
      .from("users")
      .select("id, name, phone, email, country_code, currency, balance")
      .eq("id", partner.user_id)
      .maybeSingle();
    wallet = data ?? null;
  }

  // What they have self-credited in the last 24 hours, for the limit meter.
  let creditedToday = 0;
  if (partner.user_id) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { data: recent } = await supabase
      .from("payments")
      .select("amount")
      .eq("user_id", partner.user_id)
      .eq("provider", "partner")
      .gte("created_at", since);
    creditedToday = (recent ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  }

  return NextResponse.json({
    partner: publicPartner(partner),
    players: players ?? [],
    commissions: commissions ?? [],
    wallet,
    creditedToday: Math.round(creditedToday * 100) / 100,
    dailyLimit: Number(process.env.PARTNER_CREDIT_DAILY_MAX ?? 20000),
  });
}

/**
 * Where the partner wants to be paid. These fields are free text, because
 * partners span many markets and a fixed list would block a legitimate payout
 * method the day a new market opens.
 */
export async function PATCH(req: Request) {
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  const partner = await currentPartner();
  if (!partner) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  await supabase
    .from("sub_admins")
    .update({
      payout_name: String(body.payout_name ?? "").trim() || null,
      payout_network: String(body.payout_network ?? "").trim() || null,
      payout_number: String(body.payout_number ?? "").trim() || null,
    })
    .eq("id", partner.id);

  return NextResponse.json({ ok: true });
}
