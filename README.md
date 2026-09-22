# 🍪 Cookie Bounties

**Fund the work first. Pay it out on-chain.**

Cookie Bounties is a community bounty board on **Cookie Chain** where the reward is locked in a
smart-contract **escrow the moment a task is posted** — not promised, not held by a middleman.
Anyone can pick up the task; when the creator approves the work, the program releases the COOK to
the contributor in the same breath. No task done? The escrow returns to the creator after the
deadline. The money is always where it should be: on-chain, and impossible to fake.

> Traditional bounty: *"Do the work and I'll pay you."*
> **Cookie Bounties: *"I already funded the reward. The contract is holding it. Get it approved, get paid."***

---

## 🚀 Deployed on Cookie Chain

| | |
| --- | --- |
| **Program ID** | [`5Pb9fVyi7t9b5wxDb6tJSNyZUbcuw1uqqacnCYUGq97j`](https://cookiescan.io/address/5Pb9fVyi7t9b5wxDb6tJSNyZUbcuw1uqqacnCYUGq97j) |
| **Network** | Cookie Chain (SVM / Solana-compatible) · RPC `https://rpc.cookiescan.io` |
| **Explorer** | [CookieScan](https://cookiescan.io/address/5Pb9fVyi7t9b5wxDb6tJSNyZUbcuw1uqqacnCYUGq97j) |
| **Deploy tx** | [`KGZNyy25…q1piJQQ`](https://cookiescan.io/tx/KGZNyy25MgYGDnR6HmkWeiP1XvEfZrpNkpGXpdBaUgLQkXGeQQFMyesP7c4UoknM9A3PycjgDrNKWGYKq1piJQQ) |
| **Wallet** | Nightly |
| **Live demo** | _coming soon (Vercel)_ |

The Anchor program is **live and holding real COOK in escrow** — every create, fund, submit,
approve and refund in the app is a real transaction on Cookie Chain.

---

## How it works

```
POST ──▶ FUND ──▶ BUILD ──▶ SUBMIT ──▶ REVIEW ──▶ APPROVE ──▶ PAID
  │        │                                          │
  │        └── reward locked in escrow PDA            └── escrow released to the contributor
  └── deadline set; if it lapses with no winner, the creator refunds the escrow
```

1. **Post & fund** — a creator writes the task, sets the COOK reward and a deadline, and signs **one
   transaction** that creates the bounty *and* funds the escrow together.
2. **Build & submit** — anyone opens an active bounty and submits a link to their work before the
   deadline. Only the reference lives on-chain; the file stays off-chain.
3. **Approve & pay** — only the creator can approve, and approval **releases the escrow to the
   winner in the same transaction** — the reward can never be paid twice.
4. **Refund** — if the deadline passes with no approved work, the creator reclaims the escrow.

## Features

- 🔐 **Upfront escrow** — rewards are locked in a program-derived account before anyone starts.
- ⏱️ **Live countdown** — every bounty shows a real, ticking time-to-deadline.
- 👤 **Role-aware** — creators get a review/approve dashboard; contributors get a submit flow.
- 📊 **Real analytics** — the marketplace, activity feed and leaderboard are computed from indexed
  on-chain state (nothing hardcoded).
- 🔁 **Self-updating board** — an indexer reconciles chain → Neon after every action, every 20s in
  the app, and on a Vercel Cron.
- 🧱 **Non-custodial** — the backend never holds keys or funds; every transfer is signed in Nightly.

## Architecture

```
Nightly ──sign──▶ Next.js ──▶ Anchor program ──▶ Escrow PDA ──▶ Contributor
                     │
                     └──▶ Neon Postgres  ◀── indexer ◀── Cookie Chain (source of truth)
```

The **blockchain is the authority over money**; Neon is a fast, searchable mirror for the
marketplace, activity and analytics — it is never trusted with balances, ownership or payouts.

## On-chain program

`program/` is the Anchor/Rust program that owns every escrow. Source of truth for all funds.

### Instructions

| Instruction | Signer | Effect |
| --- | --- | --- |
| `create_and_fund_bounty` | creator | Creates the bounty + escrow PDA and moves the reward into escrow in one tx → **Active** |
| `submit_work` | contributor | Records a submission (only while Active and before the deadline) |
| `approve_submission` | creator | Releases the escrow to the winning contributor → **Completed** |
| `cancel_bounty` | creator | Before any approval — refunds the escrow to the creator → **Cancelled** |
| `refund_bounty` | creator | After the deadline with no winner — refunds the escrow → **Expired** |

### PDAs (accounts)

| Account | Seeds |
| --- | --- |
| Bounty | `["bounty", creator, bounty_id]` |
| Escrow | `["escrow", bounty]` |
| Submission | `["submission", bounty, submission_id]` |

### Safety invariants (enforced on-chain)

- Only the **creator** can approve, cancel or refund.
- A completed bounty **cannot be paid twice**, and cannot be refunded.
- The contributor **cannot** withdraw from escrow directly — only an approval releases it.
- The reward **cannot be changed** after funding.
- Refund requires the **deadline to have passed** with no approved winner.

COOK is Cookie Chain's native token (9 decimals), so the escrow holds native lamports — no backend
wallet ever custodies funds. See [`program/README.md`](program/README.md) for build/test/deploy.

## Tech stack

- **Cookie Chain** (SVM), native token **COOK** (9 decimals) · **Nightly** wallet
- **Anchor / Rust** escrow program (`program/`)
- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Tailwind CSS v4**
- **Drizzle ORM** over **Neon Postgres** (indexing only)

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no `.env.local` the board renders sample data; to go real, add a
`.env.local` (gitignored — never commit it):

```bash
# Cookie Chain (public)
NEXT_PUBLIC_COOKIE_RPC_URL=https://rpc.cookiescan.io
NEXT_PUBLIC_COOKIE_EXPLORER_URL=https://cookiescan.io
NEXT_PUBLIC_COOKIE_GENESIS_HASH=9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2
NEXT_PUBLIC_BOUNTIES_PROGRAM_ID=5Pb9fVyi7t9b5wxDb6tJSNyZUbcuw1uqqacnCYUGq97j
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Server-only secret — set in your host's env, never in git
DATABASE_URL=<your neon connection string>
# Optional: require this on the Vercel Cron GET to /api/indexer/sync
CRON_SECRET=<random string>
```

```bash
npm run db:push   # create the Neon tables
```

Connect Nightly on **Cookie Chain** (add it as a custom SVM network with the RPC above), and the app
runs the full real flow. The board fills from the indexer (`/api/indexer/sync`); `npm run db:seed`
loads sample data for pure UI work.

## Deploy

### 1) The program (Anchor / Rust)

Requires the Solana/Agave toolchain (on Windows, WSL2). From `program/`:

```bash
cargo build-sbf                                   # builds target/deploy/cookie_bounties.so
solana config set --url https://rpc.cookiescan.io
solana program deploy target/deploy/cookie_bounties.so
```

> COOK is Cookie Chain's native gas token, so the deploy fee is paid in COOK — bridge some to your
> deploy wallet via [hyperlane.cookiescan.io](https://hyperlane.cookiescan.io). If your toolchain is
> old, current crates need Rust ≥ 1.85 (`edition2024`); use a recent Agave, not Solana 1.18.

Put the printed **Program Id** in `NEXT_PUBLIC_BOUNTIES_PROGRAM_ID`, and if `anchor build` emitted
an IDL, copy `program/target/idl/cookie_bounties.json` over `src/lib/program/idl/cookie_bounties.json`.

### 2) The app (Vercel)

Push to GitHub, import the repo in Vercel, and set the env vars above in **Project → Settings →
Environment Variables** (set `NEXT_PUBLIC_APP_URL` to your Vercel domain).

**Keeping the board fresh when idle (free — no Vercel Pro):** the app already reconciles after every
action and every 20s while someone's on the page. To also update while idle, a **GitHub Actions**
workflow ([`.github/workflows/reconcile.yml`](.github/workflows/reconcile.yml)) pings
`/api/indexer/sync` on a schedule — Vercel Hobby only allows daily crons, so this sidesteps that.
Add two repo secrets (**Settings → Secrets and variables → Actions**): `APP_URL` (your deployed URL)
and `CRON_SECRET` (matching the app env). Trigger it manually anytime from the **Actions** tab.

## Layout

```
program/                        Anchor escrow program (Rust) — see program/README.md
design/                         Source Claude Design compile + runtime (build input, not shipped)
src/
  app/
    page.tsx / dashboard/       Server routes: read bounties + activity, render the client app
    api/metadata/               Off-chain metadata store (the URI is what goes on-chain)
    api/indexer/sync/           Reconcile chain → Neon (POST from app, GET for Vercel Cron)
  components/cookie/            The app shell, bounty card, live countdown
  lib/
    cookie/                     chain config, types, seed, analytics, service (reads), indexer
    program/                    Anchor IDL, PDAs, client, high-level SDK (create/fund/submit/…)
    wallet/nightly.ts           Nightly connect/sign + Cookie Chain balance
    db/                         Drizzle schema + client + seed
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm run db:push` · `db:seed` | Sync schema · load sample data |

---

Built for the Cookie Chain hackathon. The core demonstration: a creator funds a real bounty, the
smart contract holds it, a contributor submits work, the creator approves, and the contributor
receives the escrowed COOK on Cookie Chain — verifiable on CookieScan.
