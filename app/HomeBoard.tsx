"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Page } from "@/components/Shell";
import { MatchList } from "@/components/MatchList";
import { BetSlip } from "@/components/BetSlip";
import { SupportChat } from "@/components/SupportChat";
import { StoryList, QuickPanel, LoadCodeWidget, HighlightList } from "@/components/home/Panels";
import { FeaturedMatches } from "@/components/home/FeaturedMatches";
import { useNow } from "@/lib/now";
import type { FeedMatch } from "@/lib/fixtures";

const POLL_MS = 30_000;

/** How many matches each home section shows before "See all". */
const UPCOMING_ON_HOME = 6;
const LIVE_ON_HOME = 4;

/** The features section tabs, mirroring the reference home. */
const FEATURE_TABS = [
  { key: "matches", label: "Matches" },
  { key: "boosted", label: "Best Odds" },
  { key: "codes", label: "Codes" },
  { key: "live", label: "Live" },
];

const FOOTER_LINKS = [
  { label: "Today's Matches", href: "/?tab=today" },
  { label: "Best Odds", href: "/?tab=boosted" },
  { label: "Load Code", href: "/load-code" },
];

/**
 * The way out of a shortened section.
 *
 * A word in the corner of a heading is easy to miss on a phone; this is a bar
 * the width of the list it ends, so the tap target is the whole thing.
 */
function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-2 flex items-center justify-center gap-1 rounded bg-[var(--bg-elevated)] py-3 text-[13px] font-bold text-[var(--accent)]"
    >
      {label}
      <ChevronRight size={15} strokeWidth={2.5} />
    </Link>
  );
}

export function HomeBoard() {
  const tab = useSearchParams().get("tab");
  const [feed, setFeed] = useState<FeedMatch[] | null>(null);
  const [feature, setFeature] = useState("matches");
  const now = useNow();

  // The home page shares one poll with the board below it.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/fixtures", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setFeed(json.matches ?? []);
      } catch {
        /* the board below renders its own error state */
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  /**
   * The home page shows a few matches, so they had better be the right few.
   * Boosted prices go first; the custom-match ordering is `MatchList`'s own
   * job and survives this, because both passes are stable.
   */
  const homeFeed = useMemo(() => {
    if (!feed) return feed;
    return [...feed.filter((m) => m.bestOdds), ...feed.filter((m) => !m.bestOdds)];
  }, [feed]);

  const liveCount = useMemo(() => (feed ?? []).filter((m) => m.isLive).length, [feed]);

  const soonCount = useMemo(() => {
    const cutoff = now + 3 * 3_600_000;
    return (feed ?? []).filter((m) => !m.isLive && new Date(m.kickoff).getTime() <= cutoff).length;
  }, [feed, now]);

  const featured = useMemo(() => {
    if (!feed) return [];
    const pool =
      feature === "live"
        ? feed.filter((m) => m.isLive)
        : feature === "boosted"
          ? feed.filter((m) => m.bestOdds)
          : feed.filter((m) => !m.isLive);

    // The house's own matches open the HOT rail. They are the ones the
    // operator chose to run, so they should not be buried behind whatever the
    // upstream feed happened to return first.
    return [
      ...pool.filter((m) => m.source === "custom"),
      ...pool.filter((m) => m.source !== "custom"),
    ].slice(0, 10);
  }, [feed, feature]);

  // A tab in the URL means the player came from a chip or the quick panel and
  // wants the full board, not the home furniture.
  if (tab) {
    return (
      <Page>
        <div className="px-2 pt-2 md:px-5 md:pt-4">
          <MatchList tab={tab} />
        </div>
        <BetSlip />
        <SupportChat />
      </Page>
    );
  }

  return (
    <Page>
      <StoryList />
      <QuickPanel />
      <LoadCodeWidget />
      <HighlightList liveCount={liveCount} soonCount={soonCount} />

      <section className="mt-1">
        <div className="scroll-x flex items-center gap-4 px-3 pb-2.5 md:gap-6 md:px-5">
          <span className="shrink-0 text-[15px] font-black text-[var(--text-bright)]">HOT</span>
          {FEATURE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFeature(t.key)}
              className="shrink-0 text-[15px] font-medium transition-colors"
              style={{ color: feature === t.key ? "var(--accent)" : "var(--text-faint)" }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {feed === null ? (
          <div className="scroll-x flex gap-2 px-2.5 md:gap-3 md:px-5">
            {[0, 1].map((i) => (
              <div key={i} className="h-[168px] w-[300px] shrink-0 rounded-[8px] bg-[var(--bg-elevated)]" />
            ))}
          </div>
        ) : featured.length ? (
          <FeaturedMatches matches={featured} />
        ) : (
          <p className="px-3 py-6 text-center text-[13px] text-[var(--text-muted)]">
            Nothing here right now.
          </p>
        )}

        <div className="mt-2 flex items-center justify-around border-y border-[var(--line)] py-2.5 md:justify-start md:gap-10 md:px-5">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.label} href={l.href} className="text-[12px] text-[var(--text-muted)]">
              {l.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-3">
        <div className="flex items-center gap-2 px-3 pb-2 md:px-5">
          <span className="text-[15px] font-black text-[var(--text-bright)]">LIVE</span>
          <span className="text-[15px] font-medium text-[var(--accent)]">Football</span>
          {liveCount > 0 && (
            <span className="rounded-full bg-[var(--live)] px-1.5 text-[10px] font-bold text-white">
              {liveCount}
            </span>
          )}
        </div>
        <div className="px-2 md:px-5">
          <MatchList
            tab="live"
            matches={homeFeed}
            limit={LIVE_ON_HOME}
            emptyLabel="No matches in play right now."
          />
          {liveCount > LIVE_ON_HOME && (
            <SeeAll href="/?tab=live" label={`See all ${liveCount} live matches`} />
          )}
        </div>
      </section>

      <section className="mt-4">
        <h2 className="px-3 pb-2 text-[15px] font-black text-[var(--text-bright)] md:px-5 md:text-[17px]">
          Upcoming
        </h2>
        <div className="px-2 md:px-5">
          {/* The home page is a shop window. The full board is one tap away. */}
          <MatchList tab="upcoming" matches={homeFeed} limit={UPCOMING_ON_HOME} />
          <SeeAll href="/?tab=upcoming" label="See all upcoming matches" />
        </div>
      </section>

      <BetSlip />
      <SupportChat />
    </Page>
  );
}
