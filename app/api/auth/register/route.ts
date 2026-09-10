import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/supabase";
import { getCountry, normalisePhone, validateKyc } from "@/lib/countries";

/**
 * Registration. The country decides everything downstream — wallet currency,
 * minimum deposit, the KYC value demanded, the gateway and the payout rail —
 * so it is validated first and stamped onto the player.
 */
export async function POST(req: Request) {
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { name, phone, email, password, countryCode, kycValue, referralCode } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Enter your name" }, { status: 400 });
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const country = getCountry(countryCode);

  const normalisedPhone = normalisePhone(phone ?? "", country.code);
  if (!normalisedPhone) {
    return NextResponse.json(
      { error: `Enter a valid ${country.name} phone number` },
      { status: 400 },
    );
  }

  if (kycValue) {
    const kyc = validateKyc(kycValue, country.code);
    if (!kyc.ok) return NextResponse.json({ error: kyc.error }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("phone", normalisedPhone)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "That phone number already has an account" }, { status: 409 });
  }

  // A referral code attributes the player to a partner permanently.
  let referredBy: string | null = null;
  if (referralCode?.trim()) {
    const { data: partner } = await supabase
      .from("sub_admins")
      .select("id")
      .eq("referral_code", referralCode.trim().toUpperCase())
      .maybeSingle();
    if (partner) referredBy = partner.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data: user, error } = await supabase
    .from("users")
    .insert({
      name: name.trim(),
      phone: normalisedPhone,
      email: email?.trim().toLowerCase() || null,
      password_hash: passwordHash,
      country_code: country.code,
      currency: country.currency,
      kyc_value: kycValue?.trim().toUpperCase() || null,
      referred_by: referredBy,
    })
    .select("id, name, phone, email, country_code, currency, balance")
    .single();

  if (error || !user) {
    console.error("[register] failed", error);
    return NextResponse.json({ error: "Could not create your account" }, { status: 500 });
  }

  return NextResponse.json({ user });
}
