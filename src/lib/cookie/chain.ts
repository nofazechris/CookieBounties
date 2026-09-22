/**
 * Cookie Chain network configuration (PRD §6).
 *
 * Cookie Chain is a Solana-compatible SVM network with native token COOK (9 decimals). These
 * values come from the environment so the app can target the official Cookie Chain endpoints —
 * never assume Solana mainnet. `NEXT_PUBLIC_*` values are safe on the client; secrets are not.
 */
export const COOKIE_CHAIN = {
  name: "Cookie Chain",
  rpcUrl: process.env.NEXT_PUBLIC_COOKIE_RPC_URL ?? "",
  wsUrl: process.env.NEXT_PUBLIC_COOKIE_WS_URL ?? "",
  explorerUrl: process.env.NEXT_PUBLIC_COOKIE_EXPLORER_URL ?? "",
  /** Cookie Chain genesis hash — used to ask the wallet to switch to this network on connect. */
  genesisHash: process.env.NEXT_PUBLIC_COOKIE_GENESIS_HASH ?? "9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2",
  nativeToken: "COOK",
  decimals: 9,
} as const;

/** The deployed Cookie Bounties program id, once the Anchor program is deployed (§7, §92). */
export const BOUNTIES_PROGRAM_ID = process.env.NEXT_PUBLIC_BOUNTIES_PROGRAM_ID ?? "";

/**
 * Whether an RPC is configured — enough to connect the wallet and read live COOK balances, even
 * before the escrow program is deployed.
 */
export const isRpcConfigured = (): boolean => Boolean(COOKIE_CHAIN.rpcUrl);

/**
 * Whether the full on-chain write path is wired up (RPC + deployed program id). Transactions
 * (create/fund/submit/approve/cancel/refund) go real only when this is true; until then the UI runs
 * its demo flow and never fakes a confirmed transaction against a live chain.
 */
export const isChainConfigured = (): boolean =>
  Boolean(COOKIE_CHAIN.rpcUrl && BOUNTIES_PROGRAM_ID);

/** 1 COOK in the token's smallest unit (9 decimals) — used for BigInt/BN math, never floats (§71). */
export const COOK_PER_UNIT = 1_000_000_000n;

/** Build a CookieScan transaction URL (§68). Falls back to a bare path if no explorer is set. */
export function getExplorerTxUrl(signature: string): string {
  const base = COOKIE_CHAIN.explorerUrl.replace(/\/$/, "");
  return base ? `${base}/tx/${signature}` : `/tx/${signature}`;
}

/** Build a CookieScan address/wallet URL. */
export function getExplorerAddressUrl(address: string): string {
  const base = COOKIE_CHAIN.explorerUrl.replace(/\/$/, "");
  return base ? `${base}/address/${address}` : `/address/${address}`;
}

/** Format a COOK smallest-unit amount (bigint) as a human string, e.g. 2_000_000_000n → "2". */
export function formatCook(amount: bigint): string {
  const whole = amount / COOK_PER_UNIT;
  const frac = amount % COOK_PER_UNIT;
  if (frac === 0n) return whole.toString();
  // Trim trailing zeros in the fractional part.
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Parse a human COOK string (e.g. "2.5") into the token's smallest unit as a bigint. */
export function parseCook(value: string): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  const fracPadded = (frac + "000000000").slice(0, 9);
  return BigInt(whole || "0") * COOK_PER_UNIT + BigInt(fracPadded || "0");
}
