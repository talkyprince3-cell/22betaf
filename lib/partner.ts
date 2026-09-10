import { cookies } from "next/headers";
import { db } from "./supabase";
import { PARTNER_COOKIE, partnerIdFromCookie, verifyPartner } from "./auth";

/**
 * The signed-in partner, and the bridge to their betting account.
 *
 * A partner has two identities that coexist: the dashboard session (a signed
 * cookie) and, optionally, a player session (an id in browser storage). Neither
 * clears the other, which is what lets a partner bet and then return to the
 * dashboard without signing in again.
 */

export interface PartnerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  referral_code: string;
  approved: boolean;
  balances: Record<string, number>;
  lifetime: Record<string, number>;
  payout_name: string | null;
  payout_network: string | null;
  payout_number: string | null;
  user_id: string | null;
  password_hash: string;
}

const COLUMNS =
  "id, name, email, phone, referral_code, approved, balances, lifetime, payout_name, payout_network, payout_number, user_id, password_hash";

/** Resolve the partner from their signed cookie, or null. */
export async function currentPartner(): Promise<PartnerRow | null> {
  const supabase = db();
  if (!supabase) return null;

  const jar = await cookies();
  const cookieValue = jar.get(PARTNER_COOKIE)?.value;
  const id = partnerIdFromCookie(cookieValue);
  if (!id) return null;

  const { data } = await supabase.from("sub_admins").select(COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;

  const partner = data as unknown as PartnerRow;

  // The signature covers the current password hash, so rotating the password
  // invalidates every outstanding cookie.
  if (!verifyPartner(cookieValue, partner.password_hash)) return null;

  return partner;
}

/** Strip the hash before anything is returned to a client. */
export function publicPartner(p: PartnerRow) {
  const { password_hash: _hash, ...safe } = p;
  void _hash;
  return safe;
}
