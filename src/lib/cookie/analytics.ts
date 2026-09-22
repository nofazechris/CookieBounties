import { fmt } from "./data";
import type { Bounty } from "./types";

/**
 * Pure aggregations over the bounty board. The data comes from Neon (via the service) or the seed;
 * these derive the hero stats, leaderboard, per-wallet dashboards and wallet summary from it, so
 * nothing on the page is hardcoded.
 */

const shorten = (a: string): string =>
  a.includes("…") || a.length <= 12 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;

export interface GlobalStats {
  activeBounties: number;
  cookInEscrow: number;
  completed: number;
  cookPaid: number;
}

/** Marketplace-wide totals for the hero (§81). */
export function getGlobalStats(bounties: Bounty[]): GlobalStats {
  const live = bounties.filter((b) => b.status === "ACTIVE" || b.status === "REVIEWING");
  const done = bounties.filter((b) => b.status === "COMPLETED" || b.status === "PAID");
  return {
    activeBounties: bounties.filter((b) => b.status === "ACTIVE").length,
    cookInEscrow: live.reduce((n, b) => n + b.reward, 0),
    completed: done.length,
    cookPaid: done.reduce((n, b) => n + b.reward, 0),
  };
}

export interface LeaderRow {
  address: string;
  addressFull: string;
  completed: number;
  earned: number;
}

/** Top contributors, by completed (paid) bounties and COOK earned. */
export function getLeaderboard(bounties: Bounty[]): LeaderRow[] {
  const byContributor = new Map<string, { display: string; completed: number; earned: number }>();
  for (const b of bounties) {
    if (b.status !== "COMPLETED" && b.status !== "PAID") continue;
    const winner = b.submissions.find((sub) => sub.status === "Approved") ?? b.submissions[0];
    if (!winner) continue;
    const key = winner.contributorAddress ?? winner.contributor;
    const cur = byContributor.get(key) ?? { display: winner.contributor, completed: 0, earned: 0 };
    cur.completed += 1;
    cur.earned += b.reward;
    byContributor.set(key, cur);
  }
  return [...byContributor.entries()]
    .map(([full, v]) => ({ address: v.display, addressFull: full, completed: v.completed, earned: v.earned }))
    .sort((a, c) => c.earned - a.earned || c.completed - a.completed);
}

export interface WorkItem {
  bountyId: string;
  title: string;
  reward: string;
  status: string;
  when: string;
  creator: string;
}

export interface WorkStats {
  submitted: number;
  inReview: number;
  completed: number;
  earned: number;
}

/** A contributor's own submissions across the board, keyed to the connected wallet. */
export function getMyWork(bounties: Bounty[], wallet: string): { items: WorkItem[]; stats: WorkStats } {
  const items: WorkItem[] = [];
  let submitted = 0;
  let inReview = 0;
  let completed = 0;
  let earned = 0;

  for (const b of bounties) {
    for (const sub of b.submissions) {
      const isMine = sub.contributorAddress ? sub.contributorAddress === wallet : sub.contributor === shorten(wallet);
      if (!isMine) continue;
      submitted += 1;
      const paid = sub.status === "Approved" && (b.status === "COMPLETED" || b.status === "PAID");
      if (paid) {
        completed += 1;
        earned += b.reward;
      } else if (sub.status !== "Rejected") {
        inReview += 1;
      }
      items.push({
        bountyId: b.id,
        title: b.title,
        reward: `${fmt(b.reward)} COOK`,
        status: paid ? "Paid" : sub.status === "Rejected" ? "Rejected" : "In review",
        when: sub.when,
        creator: b.creator,
      });
    }
  }
  return { items, stats: { submitted, inReview, completed, earned } };
}

export interface WalletSummary {
  completed: number;
  earned: number;
  funded: number;
}

/** The connected wallet's headline numbers for the wallet panel. */
export function getWalletStats(bounties: Bounty[], wallet: string): WalletSummary {
  const work = getMyWork(bounties, wallet);
  const funded = bounties
    .filter((b) => (b.creatorAddress ? b.creatorAddress === wallet : b.creator === shorten(wallet)))
    .reduce((n, b) => n + b.reward, 0);
  return { completed: work.stats.completed, earned: work.stats.earned, funded };
}
