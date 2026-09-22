# Cookie Bounties

A community bounty board on Cookie Chain: post a task, lock the reward in escrow, and the
contributor is paid on-chain when their work is approved. Built from the Claude Design compile in
[`design/Cookie Bounties.dc.html`](design/Cookie%20Bounties.dc.html).

## Stack

- **Cookie Chain** (SVM / Solana-compatible), native token **COOK** — via **Nightly** wallet
- **Anchor / Rust** escrow program (`program/`) — the authority over funds
- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (base + keyframes; screens carry their exact look as ported inline styles)
- **Drizzle ORM** over **Neon Postgres** — application/indexing DB (never the authority over money)

### On-chain vs demo mode

The app has a **real on-chain path** and a **demo fallback**, chosen automatically:

- **Real** (when `NEXT_PUBLIC_COOKIE_RPC_URL` + `NEXT_PUBLIC_BOUNTIES_PROGRAM_ID` are set):
  Nightly connect + live COOK balance, and `create + fund` builds, signs, broadcasts and confirms
  a real transaction into the program escrow PDA before any UI state changes. The client SDK lives
  in `src/lib/program/`, the wallet in `src/lib/wallet/`.
- **Demo** (no chain configured): the wallet/escrow flow runs as a staged local mock so the app is
  fully clickable without a deployed program — it never reports a live transaction as confirmed.

The blockchain is always the source of truth for money; Neon only indexes it.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. The app runs with **no database** — the board falls back to the
in-repo seed in `src/lib/cookie/data.ts`.

### Using Postgres

Create `.env.local` (never commit it — it's gitignored) with the values below, then run the
migrations:

```bash
# Cookie Chain (public)
NEXT_PUBLIC_COOKIE_RPC_URL=https://rpc.cookiescan.io
NEXT_PUBLIC_COOKIE_EXPLORER_URL=https://cookiescan.io
NEXT_PUBLIC_BOUNTIES_PROGRAM_ID=<your deployed program id>
# Neon Postgres (server-only secret)
DATABASE_URL=<your neon connection string>
# Optional: require this on the Vercel Cron GET to /api/indexer/sync
CRON_SECRET=<random string>
```

```bash
npm run db:push   # create the tables from the schema
```

`npm run db:generate` / `npm run db:migrate` produce and apply versioned SQL migrations instead.
The board and activity feed populate from the on-chain indexer (`/api/indexer/sync`), so seeding is
optional (`npm run db:seed` loads sample data for local UI work).

## Layout

```
program/                        Anchor escrow program (Rust) — see program/README.md
design/                         The source Claude Design compile + its runtime (input, not built)
src/
  app/
    layout.tsx                  Fonts (Caprasimo + Figtree), metadata
    globals.css                 Base, the design's keyframes, hover/focus interaction classes
    page.tsx                    Server: reads bounties, renders the client app
    api/metadata/               Off-chain metadata store (URI recorded on-chain)
    api/indexer/                sync (reconcile chain → Neon) + events (record tx/activity)
  components/cookie/
    CookieBountiesApp.tsx       The client state machine — every screen + the modal stack
    BountyCard.tsx              The shared bounty card
  lib/
    cookie/
      chain.ts                  Cookie Chain config, COOK formatting, CookieScan URLs
      types.ts / data.ts        Domain types + seed board + formatters
      theme.ts                  Palette (exact colours from the design)
      service.ts                Read side — Postgres when configured, else the seed
      metadata.ts               Off-chain metadata store (Neon or in-process)
      indexer.ts                Reconcile on-chain accounts → Neon; record tx/activity
    program/
      idl/                      Anchor IDL (regenerate with `anchor build`)
      client.ts                 Anchor Program factory (Nightly + read-only)
      pdas.ts                   PDA derivation (must match the Rust seeds)
      sdk.ts                    High-level actions (create+fund, submit, approve, cancel, refund)
    wallet/
      nightly.ts                Nightly connect/sign + Cookie Chain connection + balance
    db/
      schema.ts                 Drizzle tables (bounties, submissions, transactions, activity, metadata)
      index.ts                  Lazy Drizzle client
      seed.ts                   `npm run db:seed`
```

## Deploy the program & go live

```bash
cd program
anchor build && anchor keys sync      # build + write the real program id
anchor deploy --provider.cluster <COOKIE_CHAIN_RPC_URL>
```

Then in the app's `.env` set `NEXT_PUBLIC_COOKIE_RPC_URL`, `NEXT_PUBLIC_COOKIE_EXPLORER_URL`,
`NEXT_PUBLIC_BOUNTIES_PROGRAM_ID` (from the deploy) and `DATABASE_URL`, copy
`program/target/idl/cookie_bounties.json` over `src/lib/program/idl/cookie_bounties.json`, run
`npm run db:push`, and the app switches to the real on-chain path automatically.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` / `db:seed` | Sync schema / load fixtures |
