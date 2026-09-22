# cookie_bounties — Anchor program

The escrow authority for Cookie Bounties. Money invariants live here, not in the backend: the
creator funds a bounty into a program-owned escrow PDA atomically with creation, only the creator
can approve, approval releases the reward to the winning contributor, and a completed bounty can
never be paid or refunded again.

## Layout

```
programs/cookie_bounties/src/
  lib.rs        Program entry + instructions + account contexts
  state.rs      Bounty / Escrow / Submission accounts + enums
  errors.rs     BountyError (frontend-ready messages)
  events.rs     Events the Neon indexer consumes
tests/          Anchor mocha tests (escrow round-trip + safety negatives)
```

## Instructions

| Instruction | Who signs | Effect |
| --- | --- | --- |
| `create_and_fund_bounty` | creator | Creates the bounty + escrow PDA and moves the reward into escrow (Active) |
| `submit_work` | contributor | Records a submission (before the deadline, while Active) |
| `approve_submission` | creator | Releases the escrow to the contributor; bounty → Completed |
| `cancel_bounty` | creator | Before any approval; refunds escrow to creator; bounty → Cancelled |
| `refund_bounty` | creator | After the deadline, no winner; refunds escrow; bounty → Expired |

## PDAs

```
bounty     ["bounty", creator, bounty_id]
escrow     ["escrow", bounty]
submission ["submission", bounty, submission_id]
```

## COOK

COOK is the native token (9 decimals), so escrow holds native lamports. `1 COOK = 1_000_000_000`.

## Build, test, deploy

Requires the Solana toolchain + Anchor (on Windows, use WSL2).

```bash
cd program
anchor build            # compile the program + generate the IDL and TS types
anchor test             # spins up a local validator and runs tests/
anchor keys sync        # write the real program id into declare_id! + Anchor.toml
```

Deploy to Cookie Chain (set the provider cluster to the official Cookie Chain RPC, not Solana):

```bash
anchor deploy --provider.cluster <COOKIE_CHAIN_RPC_URL>
```

After deploy, copy the program id into the app's `NEXT_PUBLIC_BOUNTIES_PROGRAM_ID`, and copy
`target/idl/cookie_bounties.json` + `target/types/cookie_bounties.ts` into the frontend
(`src/lib/program/idl/`) so the client can build transactions against it.
