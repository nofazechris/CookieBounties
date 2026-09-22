import { pgTable, uuid, text, integer, timestamp, index, jsonb } from 'drizzle-orm/pg-core';

/**
 * Database schema for Cookie Bounties (Neon — the application/indexing database, never the
 * authority over funds; §32–§37). `bounties`/`submissions` mirror on-chain state (populated by the
 * indexer, or seeded for the demo); `transactions` and `activity` are the indexed event log that
 * powers the activity feed and analytics; `metadata` holds the off-chain content whose URI is what
 * the program stores on-chain (§29–§31). Rewards are decimal strings in COOK — never floats.
 */

export const bounties = pgTable('bounties', {
  /** Human-readable slug id, e.g. "mem-01" (demo), or the on-chain bounty pubkey once indexed. */
  id: text('id').primaryKey(),
  /** On-chain bounty account pubkey (null for seed/demo rows). */
  pubkey: text('pubkey'),
  category: text('category').notNull(),
  title: text('title').notNull(),
  /** Reward in COOK, as a decimal string. */
  reward: text('reward').notNull(),
  /** Hours until the deadline (snapshot at index time). */
  hours: integer('hours').notNull(),
  /** Absolute deadline as a unix timestamp (seconds) — drives the live countdown. */
  deadlineTs: integer('deadline_ts'),
  /** Truncated creator wallet address. */
  creator: text('creator').notNull(),
  /** BountyStatus enum value. */
  status: text('status').notNull().default('ACTIVE'),
  /** Sort weight for the "Newest" ordering. */
  sortOrder: integer('sort_order').notNull().default(0),
  description: text('description').notNull(),
  /** URI of the off-chain metadata (what the program stores on-chain). */
  descriptionUri: text('description_uri'),
  /** Requirements as a JSON string array. */
  requirements: text('requirements').notNull().default('[]'),
  submitInstructions: text('submit_instructions').notNull().default(''),
  /** Truncated funding transaction signature. */
  txSig: text('tx_sig').notNull().default(''),
  /** Pubkey of the winning submission, once approved. */
  winningSubmission: text('winning_submission'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** On-chain submission account pubkey (null for seed/demo rows). */
    pubkey: text('pubkey').unique(),
    bountyId: text('bounty_id')
      .notNull()
      .references(() => bounties.id, { onDelete: 'cascade' }),
    /** Display label like "#1". */
    num: text('num').notNull(),
    /** Truncated contributor wallet address. */
    contributor: text('contributor').notNull(),
    /** Human relative time, e.g. "2 hours ago". */
    submittedWhen: text('submitted_when').notNull(),
    /** "Pending" | "Rejected" | … */
    status: text('status').notNull().default('Pending'),
    note: text('note').notNull().default(''),
    /** Off-chain reference to the work. */
    url: text('url').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('submissions_bounty_idx').on(t.bountyId)],
);

/**
 * Indexed on-chain transactions (§36). One row per confirmed program transaction, keyed by its
 * signature so re-indexing the same event is a no-op (§41).
 */
export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  signature: text('signature').notNull().unique(),
  /** CREATE_BOUNTY | FUND_BOUNTY | SUBMIT_WORK | APPROVE_SUBMISSION | CANCEL_BOUNTY | REFUND_BOUNTY */
  type: text('type').notNull(),
  bountyPubkey: text('bounty_pubkey'),
  wallet: text('wallet'),
  status: text('status').notNull().default('confirmed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The activity feed, derived from indexed events (§37). */
export const activity = pgTable(
  'activity',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Idempotency key so re-indexing the same on-chain fact doesn't duplicate the feed entry. */
    dedupeKey: text('dedupe_key').unique(),
    eventType: text('event_type').notNull(),
    bountyPubkey: text('bounty_pubkey'),
    wallet: text('wallet'),
    transactionSignature: text('transaction_signature'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activity_created_idx').on(t.createdAt)],
);

/**
 * Off-chain metadata whose URI is stored on-chain (§29–§31). The create/submit flows write the
 * rich content here and pass `${APP_URL}/api/metadata/{id}` as the on-chain URI.
 */
export const metadata = pgTable('metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** "bounty" | "submission". */
  kind: text('kind').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BountyRow = typeof bounties.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
export type MetadataRow = typeof metadata.$inferSelect;
