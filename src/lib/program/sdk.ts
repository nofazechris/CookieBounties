import { BN } from "@coral-xyz/anchor";
import { PublicKey, type Transaction } from "@solana/web3.js";
import type { NightlyWallet } from "@/lib/wallet/nightly";
import { getProgram } from "./client";
import { bountyPda, escrowPda, submissionPda } from "./pdas";

/**
 * High-level Cookie Bounties actions (PRD §45–§49). The UI calls these; raw Anchor/transaction
 * construction stays out of components. Every action broadcasts a real transaction and only
 * resolves after Cookie Chain confirms it — never before.
 *
 * The Anchor `Program` is loaded from a runtime JSON IDL (no generated TS types here), so the
 * `methods`/`account` namespaces are accessed untyped internally; the exported functions keep a
 * strong, typed surface.
 */

/** Transaction phases, surfaced to the transaction UI's five-step progress. */
export type TxPhase = "preparing" | "signing" | "broadcasting" | "confirming" | "done";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** App category label → Anchor enum variant (lower-camel key). */
function categoryVariant(category: string): Record<string, Record<string, never>> {
  const key = category.charAt(0).toLowerCase() + category.slice(1);
  const known = ["development", "design", "content", "community", "research", "marketing", "memes", "other"];
  return { [known.includes(key) ? key : "other"]: {} };
}

/** Build → sign (Nightly) → broadcast → confirm, reporting each phase. Never resolves early. */
async function sendWithPhases(
  program: any,
  wallet: NightlyWallet,
  builder: { transaction(): Promise<Transaction> },
  onPhase?: (p: TxPhase) => void,
): Promise<string> {
  onPhase?.("preparing");
  const tx = await builder.transaction();
  const connection = program.provider.connection;
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  onPhase?.("signing");
  const signed = await wallet.signTransaction(tx);

  onPhase?.("broadcasting");
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize());
  } catch (e: any) {
    // Surface the program/simulation logs so the UI can show the real reason (§70).
    let logs: string[] | null = e?.logs ?? null;
    if (!logs && typeof e?.getLogs === "function") {
      logs = await e.getLogs(connection).catch(() => null);
    }
    throw new Error((e?.message ?? "send failed") + (logs?.length ? " | " + logs.join(" ") : ""));
  }

  onPhase?.("confirming");
  const conf = await connection.confirmTransaction(signature, "confirmed");
  if (conf?.value?.err) {
    throw new Error("Transaction failed on-chain: " + JSON.stringify(conf.value.err));
  }

  onPhase?.("done");
  return signature;
}

export interface CreateAndFundArgs {
  bountyId: bigint;
  title: string;
  descriptionUri: string;
  category: string;
  /** Reward in COOK smallest unit. */
  rewardAmount: bigint;
  /** Unix deadline in seconds. */
  deadline: number;
}

export interface CreateAndFundResult {
  signature: string;
  bounty: string;
  escrow: string;
}

export async function createAndFundBounty(
  wallet: NightlyWallet,
  args: CreateAndFundArgs,
  onPhase?: (p: TxPhase) => void,
): Promise<CreateAndFundResult> {
  const program: any = getProgram(wallet);
  const bounty = bountyPda(wallet.publicKey, args.bountyId);
  const escrow = escrowPda(bounty);

  const builder = program.methods
    .createAndFundBounty(
      new BN(args.bountyId.toString()),
      args.title,
      args.descriptionUri,
      categoryVariant(args.category),
      new BN(args.rewardAmount.toString()),
      new BN(args.deadline),
    )
    .accountsPartial({ creator: wallet.publicKey, bounty, escrow });

  const signature = await sendWithPhases(program, wallet, builder, onPhase);
  return { signature, bounty: bounty.toString(), escrow: escrow.toString() };
}

export async function submitWork(
  wallet: NightlyWallet,
  bounty: PublicKey,
  submissionUri: string,
  onPhase?: (p: TxPhase) => void,
): Promise<{ signature: string; submission: string }> {
  const program: any = getProgram(wallet);
  const bountyAccount = await program.account.bounty.fetch(bounty);
  const submissionId = BigInt((bountyAccount.submissionCount as number) ?? 0);
  const submission = submissionPda(bounty, submissionId);

  const builder = program.methods
    .submitWork(submissionUri)
    .accountsPartial({ contributor: wallet.publicKey, bounty, submission });

  const signature = await sendWithPhases(program, wallet, builder, onPhase);
  return { signature, submission: submission.toString() };
}

export async function approveSubmission(
  wallet: NightlyWallet,
  bounty: PublicKey,
  submission: PublicKey,
  contributor: PublicKey,
  onPhase?: (p: TxPhase) => void,
): Promise<string> {
  const program: any = getProgram(wallet);
  const escrow = escrowPda(bounty);
  const builder = program.methods
    .approveSubmission()
    .accountsPartial({ creator: wallet.publicKey, bounty, submission, escrow, contributor });
  return sendWithPhases(program, wallet, builder, onPhase);
}

export async function cancelBounty(
  wallet: NightlyWallet,
  bounty: PublicKey,
  onPhase?: (p: TxPhase) => void,
): Promise<string> {
  const program: any = getProgram(wallet);
  const escrow = escrowPda(bounty);
  const builder = program.methods.cancelBounty().accountsPartial({ creator: wallet.publicKey, bounty, escrow });
  return sendWithPhases(program, wallet, builder, onPhase);
}

export async function refundBounty(
  wallet: NightlyWallet,
  bounty: PublicKey,
  onPhase?: (p: TxPhase) => void,
): Promise<string> {
  const program: any = getProgram(wallet);
  const escrow = escrowPda(bounty);
  const builder = program.methods.refundBounty().accountsPartial({ creator: wallet.publicKey, bounty, escrow });
  return sendWithPhases(program, wallet, builder, onPhase);
}
