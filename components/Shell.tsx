"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, LayoutGrid, Gamepad2, ReceiptText, User } from "lucide-react";
import { useSession, useSlip } from "@/lib/store";
import { BrandIcon } from "@/components/icons";
import { AccountDrawer } from "@/components/AccountDrawer";
import { formatMoney } from "@/lib/countries";

/**
 * The app shell.
 *
 * Header is 44px on the brand bar: mark on the left, then search and the two
 * account actions. Bottom navigation is five items with the home mark first,
 * and the bet slip rides above it as a floating counter that only appears once
 * there is something on the slip.
 *
 * Content runs edge to edge at every width — a desktop board fills the viewport
 * rather than sitting in a centred column. Only the padding grows with the
 * screen. Form panels (login, deposit) keep their own narrow measure.
 */

function HeaderActions({ onOpenAccount }: { onOpenAccount: () => void }) {
  const player = useSession((s) => s.player);
  const hydrated = useSession((s) => s.hydrated);
  const setBalance = useSession((s) => s.setBalance);
  const setOpenBets = useSession((s) => s.setOpenBets);

  // Keep the header balance honest without the player having to reload. The
  // same read carries the open-ticket count for the My Bets badge, so the
  // badge follows the balance rather than polling on its own.
  const playerId = player?.id;
  useEffect(() => {
    if (!playerId) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/me?userId=${playerId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!alive) return;
        if (json.user) setBalance(Number(json.user.balance));
        if (typeof json.openBets === "number") setOpenBets(json.openBets);
      } catch {
        /* the header balance is not worth an error state */
      }
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [playerId, setBalance, setOpenBets]);

  if (!hydrated) return <div className="h-7 w-32 rounded bg-[var(--surface-2)]" />;

  if (!player) {
    return (
      <>
        <Link
          href="/register"
          className="rounded-[3px] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-ink)]"
        >
          Join Now
        </Link>
        {/* Outlined in white, not accent: the coral only carries 2.6:1 against
            the teal brand bar, where white sits at 8.3:1. This is also how the
            reference header pairs its filled Register with its Login. */}
        <Link
          href="/login"
          className="rounded-[3px] px-3 py-1.5 text-[13px] font-medium text-[var(--text-bright)] ring-1 ring-[var(--text-bright)]"
        >
          Log In
        </Link>
      </>
    );
  }

  return (
    <>
      <button
        onClick={onOpenAccount}
        aria-label="Account and balance"
        className="rounded-full px-3 py-1 text-[13px] font-bold text-[var(--text-bright)] ring-1 ring-[var(--text-bright)]"
      >
        {formatMoney(Number(player.balance), player.currency)}
      </button>
      <Link
        href="/deposit"
        className="rounded-[3px] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-ink)]"
      >
        Deposit
      </Link>
    </>
  );
}

export function Header() {
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-[var(--surface)]">
      <div className="flex h-[44px] w-full items-center gap-2 px-2.5 md:px-5">
        {/* The full wordmark rather than the square mark: at 44px the bar has
            the height for it, and the name is worth more here than a glyph. */}
        <Link href="/" className="flex shrink-0 items-center">
          <Image src="/logo.svg" alt="22betafro" width={109} height={24} priority />
        </Link>

        <div className="flex flex-1 items-center justify-end gap-2">
          <Link href="/search" aria-label="Search" className="p-1 text-[var(--text-bright)]">
            <Search size={21} strokeWidth={2} />
          </Link>
          <HeaderActions onOpenAccount={() => setAccountOpen(true)} />
        </div>
      </div>

      <AccountDrawer open={accountOpen} onClose={() => setAccountOpen(false)} />
    </header>
  );
}

// ------------------------------------------------------------- bottom nav

const NAV = [
  { href: "/", label: "Home", Icon: BrandIcon },
  { href: "/az", label: "AZ Menu", Icon: LayoutGrid },
  { href: "/games", label: "Games", Icon: Gamepad2 },
  { href: "/my-bets", label: "My Bets", Icon: ReceiptText },
  { href: "/account", label: "Me", Icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  // Open tickets only. A lifetime total would climb into the hundreds and stop
  // meaning anything; what a player wants off this tab is how many are still
  // running.
  const openBets = useSession((s) => s.openBets);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 bg-[var(--surface)] pb-[env(safe-area-inset-bottom)]">
      <div className="grid w-full grid-cols-5 md:mx-auto md:max-w-2xl">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const count = item.href === "/my-bets" ? openBets : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={
                count > 0
                  ? `${item.label}, ${count} open ticket${count === 1 ? "" : "s"}`
                  : undefined
              }
              className="relative flex flex-col items-center gap-1 pb-2 pt-2.5"
              style={{ color: active ? "var(--text-bright)" : "var(--text-muted)" }}
            >
              <span className="relative">
                <item.Icon size={20} strokeWidth={1.8} />
                {count > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-[var(--accent)] px-1 text-center text-[10px] font-black leading-4 text-[var(--accent-ink)]"
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
              {active && (
                <span className="absolute bottom-0 h-[3px] w-7 rounded-full bg-[var(--focus)]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Floating slip counter — only shown once there is something to place. */
export function SlipButton() {
  const legs = useSlip((s) => s.legs);
  const setOpen = useSlip((s) => s.setOpen);

  if (!legs.length) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`Bet slip, ${legs.length} selection${legs.length === 1 ? "" : "s"}`}
      className="fixed bottom-[74px] right-3 z-30 flex h-[52px] w-[52px] flex-col items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-lg"
    >
      <span className="text-[17px] font-black leading-none">{legs.length}</span>
      <span className="text-[9px] font-bold leading-none">SLIP</span>
    </button>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="min-h-[70vh] w-full pb-24">{children}</main>
      <SlipButton />
      <BottomNav />
    </>
  );
}
