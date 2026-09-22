import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import { Keypair, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { BOUNTIES_PROGRAM_ID } from "@/lib/cookie/chain";
import { getConnection, type NightlyWallet } from "@/lib/wallet/nightly";
import { COOKIE_BOUNTIES_IDL } from "./idl";

/**
 * Build an Anchor `Program` bound to the connected Nightly wallet and the configured Cookie Chain
 * RPC. The program id comes from the environment (set after deploy), overriding the IDL default.
 */
export function getProgram(wallet: NightlyWallet): Program {
  const connection = getConnection();
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl: Idl = { ...COOKIE_BOUNTIES_IDL, address: BOUNTIES_PROGRAM_ID };
  return new Program(idl, provider);
}

/** A wallet that can't sign — only for read-only account fetches (indexer/reconciliation). */
class ReadonlyWallet implements Wallet {
  readonly payer = Keypair.generate();
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs;
  }
}

/** A read-only `Program` for fetching on-chain accounts (no signing). Server or client safe. */
export function getReadonlyProgram(): Program {
  const connection = getConnection();
  const provider = new AnchorProvider(connection, new ReadonlyWallet(), { commitment: "confirmed" });
  const idl: Idl = { ...COOKIE_BOUNTIES_IDL, address: BOUNTIES_PROGRAM_ID };
  return new Program(idl, provider);
}
