"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Page } from "@/components/Shell";
import { useSession } from "@/lib/store";
import { getCountry, formatMoney } from "@/lib/countries";
import { showWithdrawalIos } from "@/lib/withdrawal-ios";

export default function WithdrawPage() {
  const router = useRouter();
  const player = useSession((s) => s.player);
  const hydrated = useSession((s) => s.hydrated);
  const setBalance = useSession((s) => s.setBalance);

  const [amount, setAmount] = useState(0);
  const [payoutNumber, setPayoutNumber] = useState("");
  const [payoutBank, setPayoutBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; have: number; need: number } | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const country = player ? getCountry(player.country_code) : getCountry("GH");

  useEffect(() => {
    if (hydrated && !player) router.replace("/login");
  }, [hydrated, player, router]);

  const playerId = player?.id;
  const fetchMe = useCallback(async () => {
    if (!playerId) return null;
    try {
      const res = await fetch(`/api/me?userId=${playerId}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }, [playerId]);

  const apply = useCallback(
    (j: {
      withdrawal: { unlocked: boolean; failed?: string; progress: { label: string; have: number; need: number } };
      user: { payout_number?: string | null; payout_bank?: string | null; balance?: number };
      partner: { id: string } | null;
    }) => {
      const isSubAdmin = Boolean(j.partner);
      setAllowed(isSubAdmin);
      setProgress(j.withdrawal.progress);
      setPayoutNumber((n) => n || j.user.payout_number || player?.phone || "");
      setPayoutBank((b) => b || j.user.payout_bank || "");
      if (typeof j.user.balance === "number") setBalance(Number(j.user.balance));
    },
    [player?.phone, setBalance],
  );

  useEffect(() => {
    let alive = true;
    void fetchMe().then((j) => {
      if (!alive) return;
      if (j) apply(j);
      else setAllowed(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchMe, apply]);

  if (!player) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (allowed !== true) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: player.id, amount, payoutNumber, payoutBank }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (json.progress) setProgress(json.progress);
        setError(json.error ?? "Could not submit your withdrawal");
        return;
      }

      setMessage(json.message);
      if (typeof json.balance === "number") setBalance(json.balance);
      const paid = Number(json.amount);
      const left = Number(json.balance);
      if (Number.isFinite(paid) && Number.isFinite(left)) {
        showWithdrawalIos({
          amount: paid,
          currentBalance: left,
          currency: typeof json.currency === "string" && json.currency ? json.currency : player.currency,
        });
      }
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="mx-auto max-w-md space-y-3">
        <h1 className="text-[18px] font-black">Withdraw</h1>

        {allowed === null && (
          <p className="rounded bg-[var(--bg-elevated)] px-4 py-3 text-[13px] text-[var(--text-muted)]">
            Loading your wallet…
          </p>
        )}

        {allowed === false && (
          <p className="rounded bg-[var(--bg-elevated)] px-4 py-3 text-[13px] text-[var(--text-muted)]">
            Only a sub-admin account can withdraw.
          </p>
        )}

        {allowed && (
        <div className="rounded bg-[var(--bg-elevated)] p-4">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-faint)]">Available</p>
          <p className="text-[26px] font-black text-[var(--accent)]">
            {formatMoney(Number(player.balance), player.currency)}
          </p>
          {progress && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{progress.label}</p>}
        </div>
        )}

        {allowed && (
        <form onSubmit={submit} className="space-y-3 rounded bg-[var(--bg-elevated)] p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Amount ({country.currency})
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded bg-[var(--surface-2)] px-3 py-3 text-[20px] font-black outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              {country.payoutRail === "mobile" ? "Mobile money number" : "Account number"}
            </span>
            <input
              value={payoutNumber}
              onChange={(e) => setPayoutNumber(e.target.value)}
              className="w-full rounded bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </label>

          {country.payoutRail === "bank" && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                Bank
              </span>
              <input
                value={payoutBank}
                onChange={(e) => setPayoutBank(e.target.value)}
                className="w-full rounded bg-[var(--surface-2)] px-3 py-2.5 text-[14px] outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy || amount <= 0}
            className="w-full rounded bg-[var(--accent)] py-3 text-[14px] font-black text-[var(--accent-ink)] disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Request withdrawal"}
          </button>
        </form>
        )}

        {message && (
          <p className="rounded bg-[var(--win)]/15 px-3 py-2.5 text-[12px] text-[var(--win)]">{message}</p>
        )}
        {error && (
          <p className="rounded bg-[var(--lose)]/15 px-3 py-2.5 text-[12px] text-[var(--lose)]">{error}</p>
        )}
      </div>
    </Page>
  );
}
