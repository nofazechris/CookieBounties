import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { COOKIE_CHAIN } from "@/lib/cookie/chain";

/**
 * Nightly wallet integration (PRD §8–§10). Nightly injects a Solana provider at
 * `window.nightly.solana`; we talk to it directly (connect, sign) and wrap it as an Anchor-
 * compatible wallet so the program SDK can sign with it. The backend never sees a private key.
 */

type SignableTx = Transaction | VersionedTransaction;

interface NightlyProvider {
  publicKey?: { toString(): string; toBytes(): Uint8Array } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signTransaction<T extends SignableTx>(tx: T): Promise<T>;
  signAllTransactions<T extends SignableTx>(txs: T[]): Promise<T[]>;
  /** Nightly-specific: point the wallet at a given SVM network so it simulates/signs correctly. */
  changeNetwork?(network: { genesisHash: string; url?: string }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

interface NightlyWindow {
  nightly?: { solana?: NightlyProvider } & Partial<NightlyProvider>;
}

/** The injected Nightly Solana provider, or null if the extension isn't installed. */
export function getNightlyProvider(): NightlyProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as NightlyWindow;
  const p = w.nightly?.solana ?? (w.nightly as NightlyProvider | undefined);
  return p && typeof p.connect === "function" ? p : null;
}

export function isNightlyInstalled(): boolean {
  return getNightlyProvider() !== null;
}

/** An Anchor `Wallet` backed by the connected Nightly provider. */
export class NightlyWallet {
  constructor(
    readonly publicKey: PublicKey,
    private readonly provider: NightlyProvider,
  ) {}

  async signTransaction<T extends SignableTx>(tx: T): Promise<T> {
    return this.provider.signTransaction(tx);
  }

  async signAllTransactions<T extends SignableTx>(txs: T[]): Promise<T[]> {
    return this.provider.signAllTransactions(txs);
  }
}

export interface ConnectedWallet {
  address: string;
  publicKey: PublicKey;
  wallet: NightlyWallet;
}

/** Prompt Nightly to connect and return an Anchor-ready wallet. */
export async function connectNightly(): Promise<ConnectedWallet> {
  const provider = getNightlyProvider();
  if (!provider) throw new Error("Nightly is not installed.");
  const res = await provider.connect();
  // Nightly may return the key on the result, or set it on the provider after connecting.
  const pk = res?.publicKey ?? provider.publicKey;
  if (!pk) throw new Error("Nightly connected but returned no public key.");
  const address = pk.toString();
  const publicKey = new PublicKey(address);
  return { address, publicKey, wallet: new NightlyWallet(publicKey, provider) };
}

/** Reconnect silently if Nightly already trusts this site; null if not connected. */
export async function connectNightlyIfTrusted(): Promise<ConnectedWallet | null> {
  const provider = getNightlyProvider();
  if (!provider) return null;
  try {
    const res = await provider.connect({ onlyIfTrusted: true });
    const address = res.publicKey.toString();
    const publicKey = new PublicKey(address);
    return { address, publicKey, wallet: new NightlyWallet(publicKey, provider) };
  } catch {
    return null;
  }
}

/**
 * Ask Nightly to switch its active network to Cookie Chain, so the wallet simulates and signs
 * against the right chain (otherwise it stays on Solana and rejects with "ProgramAccountNotFound").
 * Best-effort — if the wallet doesn't support `changeNetwork`, the user switches manually.
 */
export async function switchToCookieChain(): Promise<boolean> {
  const provider = getNightlyProvider();
  if (!provider || typeof provider.changeNetwork !== "function") return false;
  try {
    await provider.changeNetwork({
      genesisHash: COOKIE_CHAIN.genesisHash,
      url: COOKIE_CHAIN.rpcUrl,
    });
    return true;
  } catch (e) {
    console.warn("[cookie] Nightly changeNetwork failed:", (e as Error)?.message);
    return false;
  }
}

export async function disconnectNightly(): Promise<void> {
  const provider = getNightlyProvider();
  if (provider) {
    try {
      await provider.disconnect();
    } catch {
      // Nightly may already be disconnected — ignore.
    }
  }
}

/** A read-only connection to Cookie Chain. */
export function getConnection(): Connection {
  return new Connection(COOKIE_CHAIN.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: COOKIE_CHAIN.wsUrl || undefined,
  });
}

/** COOK balance of a wallet, in the token's smallest unit (lamports). */
export async function fetchCookBalance(publicKey: PublicKey): Promise<bigint> {
  const lamports = await getConnection().getBalance(publicKey, "confirmed");
  return BigInt(lamports);
}

/**
 * Best-effort network check (PRD §10): confirm the configured RPC is reachable as Cookie Chain.
 * A precise cluster assertion depends on Nightly's network API; reachability is the practical
 * guard for the hackathon, and financial actions stay disabled until it passes.
 */
export async function isOnCookieChain(): Promise<boolean> {
  if (!COOKIE_CHAIN.rpcUrl) return false;
  try {
    await getConnection().getGenesisHash();
    return true;
  } catch {
    return false;
  }
}
