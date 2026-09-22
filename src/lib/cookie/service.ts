import 'server-only';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb, isDbConfigured } from '@/lib/db';
import {
  bounties as bountiesTable,
  submissions as submissionsTable,
  activity as activityTable,
} from '@/lib/db/schema';
import type { BountyRow, SubmissionRow } from '@/lib/db/schema';
import { BOUNTIES, SEED_ACTIVITY, fmt } from './data';
import type { ActivityItem, Bounty, BountyStatus, Submission } from './types';

/**
 * Read side of the bounty domain. When Postgres is configured the board is served from it;
 * otherwise the in-repo seed (data.ts) stands in, so the app is fully usable with no database
 * (the Stage-0 invariant). The write side — funding, submitting, approving — is the mocked
 * on-chain flow driven client-side, matching the source design's prototype.
 */

/** Shorten a full base58 address for display; leave already-short/pre-truncated values alone. */
function shortenAddr(a: string): string {
  return a.includes("…") || a.length <= 12 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/** A value that is a real (full) on-chain address, or undefined if it's a display stub. */
function fullAddr(a: string): string | undefined {
  return a.includes("…") || a.length <= 12 ? undefined : a;
}

function rowToSubmission(r: SubmissionRow): Submission {
  return {
    num: r.num,
    pubkey: r.pubkey ?? undefined,
    contributorAddress: fullAddr(r.contributor),
    contributor: shortenAddr(r.contributor),
    when: r.submittedWhen,
    status: r.status,
    note: r.note,
    url: r.url,
  };
}

function rowToBounty(b: BountyRow, subs: SubmissionRow[]): Bounty {
  return {
    id: b.id,
    pubkey: b.pubkey ?? undefined,
    creatorAddress: fullAddr(b.creator),
    category: b.category,
    title: b.title,
    reward: Number(b.reward),
    hours: b.hours,
    deadlineTs: b.deadlineTs ?? undefined,
    subs: subs.length,
    creator: shortenAddr(b.creator),
    status: b.status as BountyStatus,
    sort: b.sortOrder,
    description: b.description,
    requirements: safeParseStringArray(b.requirements),
    submitInstructions: b.submitInstructions,
    txSig: b.txSig,
    submissions: subs.map(rowToSubmission),
  };
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Run a DB read with one retry, and never throw — a transient Neon hiccup returns the fallback
 * instead of crashing the page. Retries once (Neon's serverless pooler can cold-start).
 */
async function withDbFallback<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn();
    } catch (e) {
      console.error(`[cookie] ${label} failed (attempt ${attempt}/2):`, (e as Error).message);
      if (attempt === 2) return fallback;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return fallback;
}

/** Every bounty for the board, newest-weight first. Falls back to the seed with no database. */
export async function listBounties(): Promise<Bounty[]> {
  if (!isDbConfigured()) return BOUNTIES;

  return withDbFallback(
    async () => {
      const db = getDb();
      const [bountyRows, submissionRows] = await Promise.all([
        db.select().from(bountiesTable).orderBy(asc(bountiesTable.sortOrder)),
        db.select().from(submissionsTable).orderBy(asc(submissionsTable.createdAt)),
      ]);

      const byBounty = new Map<string, SubmissionRow[]>();
      for (const s of submissionRows) {
        const list = byBounty.get(s.bountyId) ?? [];
        list.push(s);
        byBounty.set(s.bountyId, list);
      }

      return bountyRows.map((b) => rowToBounty(b, byBounty.get(b.id) ?? []));
    },
    [],
    "listBounties",
  );
}

/** Relative time like "8s ago" / "2m ago" / "1h ago" / "3d ago". */
function relTime(d: Date): string {
  const secs = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** The activity feed — indexed events joined to their bounty for a title + amount (§37). */
export async function listActivity(limit = 20): Promise<ActivityItem[]> {
  if (!isDbConfigured()) return SEED_ACTIVITY;

  return withDbFallback(
    async () => {
      const rows = await getDb()
        .select({
          eventType: activityTable.eventType,
          wallet: activityTable.wallet,
          createdAt: activityTable.createdAt,
          title: bountiesTable.title,
          reward: bountiesTable.reward,
        })
        .from(activityTable)
        .leftJoin(bountiesTable, eq(activityTable.bountyPubkey, bountiesTable.id))
        .orderBy(desc(activityTable.createdAt))
        .limit(limit);

      return rows.map((r) => ({
        kind: r.eventType,
        title: r.title ?? r.eventType,
        detail: r.wallet ? `by ${shortenAddr(r.wallet)}` : '',
        amount: r.reward ? `${fmt(Number(r.reward))} COOK` : '',
        ago: relTime(r.createdAt),
      }));
    },
    [],
    "listActivity",
  );
}
