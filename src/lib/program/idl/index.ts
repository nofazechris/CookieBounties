import type { Idl } from "@coral-xyz/anchor";
import idlJson from "./cookie_bounties.json";

/**
 * The Cookie Bounties Anchor IDL. Hand-authored to match the program so the client works before
 * the first `anchor build`; after building, overwrite `cookie_bounties.json` with the generated
 * `program/target/idl/cookie_bounties.json` (they are the same shape).
 */
export const COOKIE_BOUNTIES_IDL = idlJson as Idl;
export type CookieBountiesIdlJson = typeof idlJson;
