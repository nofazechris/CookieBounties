import { PublicKey } from "@solana/web3.js";
import { BOUNTIES_PROGRAM_ID } from "@/lib/cookie/chain";

/**
 * Deterministic PDA derivation (PRD §17). Must exactly match the Rust seeds:
 *   bounty     ["bounty", creator, bounty_id]
 *   escrow     ["escrow", bounty]
 *   submission ["submission", bounty, submission_id]
 */

export function getProgramId(): PublicKey {
  if (!BOUNTIES_PROGRAM_ID) throw new Error("NEXT_PUBLIC_BOUNTIES_PROGRAM_ID is not set.");
  return new PublicKey(BOUNTIES_PROGRAM_ID);
}

/**
 * Encode a u64 as 8 little-endian bytes (matches Rust `u64::to_le_bytes`). Uses DataView rather
 * than Buffer.writeBigUInt64LE — the browser's bundled Buffer polyfill doesn't implement that
 * method, and findProgramAddressSync accepts a Uint8Array seed just fine.
 */
function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

export function bountyPda(creator: PublicKey, bountyId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), creator.toBuffer(), u64le(bountyId)],
    getProgramId(),
  )[0];
}

export function escrowPda(bounty: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), bounty.toBuffer()], getProgramId())[0];
}

export function submissionPda(bounty: PublicKey, submissionId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("submission"), bounty.toBuffer(), u64le(submissionId)],
    getProgramId(),
  )[0];
}
