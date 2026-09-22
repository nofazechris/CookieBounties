import 'server-only';
import { getDb, isDbConfigured } from '@/lib/db';
import {
  bounties as bountiesTable,
  submissions as submissionsTable,
  activity as activityTable,
} from '@/lib/db/schema';
import { getReadonlyProgram } from '@/lib/program/client';
import { formatCook } from '@/lib/cookie/chain';
import type { BountyMetadata, SubmissionMetadata } from '@/lib/cookie/metadata';

/**
 * Lightweight indexer (§40–§42, §80). Rather than a long-running log subscription, this reconciles:
 * it reads the program's on-chain accounts and upserts them into Neon so the marketplace, activity
 * feed and analytics stay fast — while the chain remains the source of truth. Upserts are keyed on
 * the account pubkey / transaction signature, so re-running is idempotent (§41).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_MAP: Record<string, string> = {
  active: 'ACTIVE',
  reviewing: 'REVIEWING',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
};

/** Anchor decodes a fieldless enum as `{ variantKey: {} }`; take the single key. */
function enumKey(value: unknown): string {
  return value && typeof value === 'object' ? (Object.keys(value)[0] ?? '') : '';
}

function statusLabel(onChain: unknown): string {
  return STATUS_MAP[enumKey(onChain)] ?? 'ACTIVE';
}

function categoryLabel(onChain: unknown): string {
  const k = enumKey(onChain);
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Other';
}

function hoursUntil(deadlineSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, Math.floor((deadlineSeconds - now) / 3600));
}

async function fetchJson<T>(uri: string): Promise<T | null> {
  try {
    const res = await fetch(uri, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T } | T;
    // /api/metadata/[id] returns { kind, data }; a raw host may return the object directly.
    return (body as { data?: T }).data ?? (body as T);
  } catch {
    return null;
  }
}

/** Reconcile all on-chain bounties + submissions into Neon. Returns counts. */
export async function reconcileFromChain(): Promise<{ bounties: number; submissions: number }> {
  if (!isDbConfigured()) throw new Error('DATABASE_URL is not set.');
  const program: any = getReadonlyProgram();
  const db = getDb();

  const bountyAccounts: any[] = await program.account.bounty.all();
  const submissionAccounts: any[] = await program.account.submission.all();

  for (const { publicKey, account } of bountyAccounts) {
    const pubkey = publicKey.toString();
    const deadline = Number(account.deadline?.toString?.() ?? account.deadline ?? 0);
    const meta = account.descriptionUri ? await fetchJson<BountyMetadata>(account.descriptionUri) : null;
    // Order by on-chain creation time (unix seconds fits an int4; the bounty id is a ms timestamp
    // that overflows it). Newest = largest createdAt.
    const createdAtSec = Number(account.createdAt?.toString?.() ?? account.createdAt ?? 0);

    await db
      .insert(bountiesTable)
      .values({
        id: pubkey,
        pubkey,
        category: categoryLabel(account.category),
        title: meta?.title ?? account.title ?? 'Untitled bounty',
        reward: formatCook(BigInt(account.rewardAmount.toString())),
        hours: hoursUntil(deadline),
        creator: account.creator.toString(),
        status: statusLabel(account.status),
        deadlineTs: deadline,
        sortOrder: createdAtSec,
        description: meta?.description ?? '',
        descriptionUri: account.descriptionUri ?? null,
        requirements: JSON.stringify(meta?.requirements ?? []),
        submitInstructions: meta?.submitInstructions ?? '',
        winningSubmission: account.winningSubmission ? account.winningSubmission.toString() : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: bountiesTable.id,
        set: {
          status: statusLabel(account.status),
          hours: hoursUntil(deadline),
          winningSubmission: account.winningSubmission ? account.winningSubmission.toString() : null,
          updatedAt: new Date(),
        },
      });
  }

  for (const { publicKey, account } of submissionAccounts) {
    const pubkey = publicKey.toString();
    const meta = account.submissionUri ? await fetchJson<SubmissionMetadata>(account.submissionUri) : null;
    const submissionId = Number(account.submissionId?.toString?.() ?? 0);

    const statusText = enumKey(account.status)
      ? enumKey(account.status).replace(/^./, (c) => c.toUpperCase())
      : 'Pending';

    await db
      .insert(submissionsTable)
      .values({
        pubkey,
        bountyId: account.bounty.toString(),
        num: `#${submissionId + 1}`,
        contributor: account.contributor.toString(),
        submittedWhen: new Date(Number(account.submittedAt?.toString?.() ?? 0) * 1000).toISOString(),
        status: statusText,
        note: meta?.description ?? '',
        url: meta?.links?.[0] ?? account.submissionUri ?? '',
      })
      .onConflictDoUpdate({
        target: submissionsTable.pubkey,
        set: { status: statusText },
      });
  }

  // Derive the activity feed purely from on-chain facts (idempotent via dedupeKey). There is no
  // client-writable activity endpoint, so nothing can spoof the feed.
  for (const { publicKey, account } of bountyAccounts) {
    const pk = publicKey.toString();
    const created = new Date(Number(account.createdAt?.toString?.() ?? 0) * 1000);
    await putActivity(`fund:${pk}`, 'Bounty funded', pk, account.creator.toString(), created);
    const st = statusLabel(account.status);
    if (st === 'COMPLETED' || st === 'PAID') {
      await putActivity(`paid:${pk}`, 'Reward paid', pk, account.creator.toString(), created);
    }
  }
  for (const { publicKey, account } of submissionAccounts) {
    const pk = publicKey.toString();
    const when = new Date(Number(account.submittedAt?.toString?.() ?? 0) * 1000);
    await putActivity(`submit:${pk}`, 'New contribution', account.bounty.toString(), account.contributor.toString(), when);
  }

  return { bounties: bountyAccounts.length, submissions: submissionAccounts.length };
}

/** Insert one activity-feed entry, once (unique dedupeKey). Only called with on-chain-derived data. */
async function putActivity(
  dedupeKey: string,
  eventType: string,
  bountyPubkey: string,
  wallet: string,
  createdAt: Date,
): Promise<void> {
  await getDb()
    .insert(activityTable)
    .values({ dedupeKey, eventType, bountyPubkey, wallet, createdAt })
    .onConflictDoNothing({ target: activityTable.dedupeKey });
}
