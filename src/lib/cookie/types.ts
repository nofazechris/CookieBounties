/**
 * Domain types for Cookie Bounties. A bounty is a funded task on Cookie Chain; its reward is
 * locked in escrow until it is completed, cancelled or refunded.
 */

/** An entry in the activity feed, derived from indexed on-chain events. */
export interface ActivityItem {
  /** Event label, e.g. "Bounty funded" | "Reward paid" | "New contribution". */
  kind: string;
  title: string;
  detail: string;
  /** Pre-formatted amount, e.g. "2 COOK" (empty when not applicable). */
  amount: string;
  /** Relative time, e.g. "8s ago". */
  ago: string;
}

/** The bounty lifecycle states the escrow program recognises. */
export type BountyStatus =
  | 'ACTIVE'
  | 'REVIEWING'
  | 'COMPLETED'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED';

/** A contributor's submitted work against a bounty. */
export interface Submission {
  /** Short label like "#1" shown in the review list. */
  num: string;
  /** On-chain submission account pubkey (set for indexed on-chain rows; absent in the demo seed). */
  pubkey?: string;
  /** Full contributor wallet address, when known on-chain — the payout recipient on approval. */
  contributorAddress?: string;
  /** Truncated wallet address of the contributor (display). */
  contributor: string;
  /** Human relative time, e.g. "2 hours ago". */
  when: string;
  /** "Pending" | "Rejected" | … — the reviewer-facing label. */
  status: string;
  /** The contributor's note to the creator. */
  note: string;
  /** Off-chain reference to the work (only the URL is recorded on-chain). */
  url: string;
}

export interface Bounty {
  id: string;
  /** On-chain bounty account pubkey (set for indexed on-chain rows; absent in the demo seed). */
  pubkey?: string;
  /** Full creator wallet address, when known on-chain (used to gate creator-only actions). */
  creatorAddress?: string;
  category: string;
  title: string;
  /** Reward in COOK. */
  reward: number;
  /** Hours until the deadline (snapshot). */
  hours: number;
  /** Absolute deadline as a unix timestamp (seconds), when known — drives the live countdown. */
  deadlineTs?: number;
  /** Submission count. */
  subs: number;
  /** Truncated wallet address of the creator. */
  creator: string;
  status: BountyStatus;
  /** Sort weight for the "Newest" ordering. */
  sort: number;
  description: string;
  requirements: string[];
  submitInstructions: string;
  /** Truncated funding transaction signature. */
  txSig: string;
  submissions: Submission[];
}
