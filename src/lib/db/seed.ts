/**
 * Seed the database from the in-repo fixture (src/lib/cookie/data.ts).
 *
 * Run with `npm run db:seed` after `npm run db:push`. Idempotent: it clears the two tables and
 * re-inserts the fixture, so re-running always lands the same board.
 *
 * This builds its own Drizzle client rather than importing `@/lib/db` — that module is marked
 * `server-only`, which throws under plain Node (the tsx runner this script uses).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { bounties as bountiesTable, submissions as submissionsTable, activity as activityTable } from './schema';
import { BOUNTIES } from '../cookie/data';

/** Activity fixtures — reference seed bounty ids so the feed join resolves title + amount. */
const ACTIVITY_SEED: Array<{ eventType: string; bountyId: string; wallet: string; minsAgo: number }> = [
  { eventType: 'Reward paid', bountyId: 'res-06', wallet: '3Vb…44K', minsAgo: 9 },
  { eventType: 'Bounty completed', bountyId: 'con-03', wallet: '7xQ…91A', minsAgo: 41 },
  { eventType: 'New contribution', bountyId: 'dev-02', wallet: '2Wc…31E', minsAgo: 60 },
  { eventType: 'Bounty funded', bountyId: 'des-04', wallet: '9Lk…77D', minsAgo: 180 },
  { eventType: 'Bounty funded', bountyId: 'com-05', wallet: '2Wc…31E', minsAgo: 300 },
  { eventType: 'Bounty funded', bountyId: 'mem-01', wallet: '7xQ…92A', minsAgo: 480 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set — nothing to seed.');
    process.exit(1);
  }

  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);
  const client = postgres(url, { prepare: false, ssl: isLocal ? undefined : 'require' });
  const db = drizzle(client, { schema });

  // Clear children first (FK), then parents.
  await db.delete(activityTable);
  await db.delete(submissionsTable);
  await db.delete(bountiesTable);

  for (const b of BOUNTIES) {
    await db.insert(bountiesTable).values({
      id: b.id,
      category: b.category,
      title: b.title,
      reward: String(b.reward),
      hours: b.hours,
      creator: b.creator,
      status: b.status,
      sortOrder: b.sort,
      description: b.description,
      requirements: JSON.stringify(b.requirements),
      submitInstructions: b.submitInstructions,
      txSig: b.txSig,
    });

    if (b.submissions.length > 0) {
      await db.insert(submissionsTable).values(
        b.submissions.map((sub) => ({
          bountyId: b.id,
          num: sub.num,
          contributor: sub.contributor,
          submittedWhen: sub.when,
          status: sub.status,
          note: sub.note,
          url: sub.url,
        })),
      );
    }
  }

  await db.insert(activityTable).values(
    ACTIVITY_SEED.map((a) => ({
      eventType: a.eventType,
      bountyPubkey: a.bountyId,
      wallet: a.wallet,
      createdAt: new Date(Date.now() - a.minsAgo * 60_000),
    })),
  );

  console.log(`Seeded ${BOUNTIES.length} bounties, their submissions, and ${ACTIVITY_SEED.length} activity events.`);
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
