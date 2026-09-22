import { ORANGE, SAGE, AMBER, RED, MUTED } from './theme';
import type { ActivityItem, Bounty, BountyStatus } from './types';

/**
 * Seed content for Cookie Bounties, lifted verbatim from the source design compile
 * (design/Cookie Bounties.dc.html). This is the in-repo fallback the app serves when no
 * database is configured, and the fixture `npm run db:seed` writes into Postgres.
 */

export const CATS = ['All', 'Development', 'Design', 'Content', 'Community', 'Research', 'Memes'];
export const SORTS = ['Newest', 'Highest Reward', 'Ending Soon', 'Most Submissions'];

export const STATUS: Record<BountyStatus, { label: string; color: string; bg: string }> = {
  ACTIVE: { label: 'Active', color: SAGE, bg: 'rgba(174,191,146,0.14)' },
  REVIEWING: { label: 'Reviewing', color: AMBER, bg: 'rgba(226,176,74,0.14)' },
  COMPLETED: { label: 'Completed', color: SAGE, bg: 'rgba(174,191,146,0.14)' },
  PAID: { label: 'Paid', color: ORANGE, bg: 'rgba(246,160,107,0.14)' },
  EXPIRED: { label: 'Expired', color: MUTED, bg: 'rgba(245,234,216,0.08)' },
  CANCELLED: { label: 'Cancelled', color: RED, bg: 'rgba(212,115,94,0.14)' },
};

export const FUND_STEPS = [
  'Preparing transaction',
  'Waiting for Nightly',
  'Broadcasting',
  'Cookie Chain confirming',
  'Bounty funded',
];
export const PAY_STEPS = [
  'Preparing transaction',
  'Waiting for Nightly',
  'Releasing escrow',
  'Cookie Chain confirming',
  'Payment complete',
];

export const BOUNTIES: Bounty[] = [
  {
    id: 'mem-01',
    category: 'Memes',
    title: 'Create a Cookie Chain meme',
    reward: 2,
    hours: 38,
    subs: 12,
    creator: '7xQ…92A',
    status: 'REVIEWING',
    sort: 2,
    description:
      'Create a high-quality meme promoting Cookie Chain that can be posted on X. It should be funny without being cringe, and readable at phone size.',
    requirements: [
      'Original artwork or edit — no reposts',
      'Square or 16:9, at least 1200px wide',
      'No token price talk or financial claims',
    ],
    submitInstructions:
      'Post the meme as an unlisted link (X draft, Imgur, Drive) and paste the URL. Attach the source file if you have one.',
    txSig: '4kD9…qW2m7Rb1sT…Zc8',
    submissions: [
      {
        contributor: '7xQ…91A',
        when: '2 hours ago',
        status: 'Pending',
        num: '#1',
        note: 'I created three meme variations around the "your reward is already there" line — flat cookie mascot, 1200×1200, plus an animated version.',
        url: 'https://cdn.example.com/cookie-memes-v3.zip',
      },
      {
        contributor: '3Vb…44K',
        when: '5 hours ago',
        status: 'Pending',
        num: '#2',
        note: 'One clean meme in the Cookie palette, sized for X timeline. Source PSD included.',
        url: 'https://cdn.example.com/cookie-meme-psd',
      },
      {
        contributor: '9Lk…77D',
        when: 'Yesterday',
        status: 'Rejected',
        num: '#3',
        note: 'Quick edit of an existing template.',
        url: 'https://cdn.example.com/meme-template-edit',
      },
    ],
  },
  {
    id: 'dev-02',
    category: 'Development',
    title: 'Build a Cookie analytics widget',
    reward: 10,
    hours: 74,
    subs: 3,
    creator: '8Fh…29B',
    status: 'ACTIVE',
    sort: 1,
    description:
      'An embeddable widget showing live Cookie Chain stats — block time, active bounties, COOK in escrow. Vanilla JS, no framework dependency.',
    requirements: [
      'Single script tag embed, under 20kb',
      'Reads from the public RPC at rpc.cookiescan.io',
      'Dark and light variants',
    ],
    submitInstructions:
      'Link a public repo and a live demo page. Include a one-line embed snippet in the README.',
    txSig: '9mF2…kT7nX4pQ0aL…Rv3',
    submissions: [
      {
        contributor: '2Wc…31E',
        when: '6 hours ago',
        status: 'Pending',
        num: '#1',
        note: 'Widget is live on my demo page — 14kb gzipped, polls the RPC every 8s with a websocket fallback.',
        url: 'https://demo.example.com/cookie-widget',
      },
      {
        contributor: '5Tn…08F',
        when: 'Yesterday',
        status: 'Pending',
        num: '#2',
        note: 'Repo with both themes and a storybook.',
        url: 'https://github.example.com/cookie-widget',
      },
    ],
  },
  {
    id: 'con-03',
    category: 'Content',
    title: 'Write a Cookie Chain explainer thread',
    reward: 4,
    hours: 22,
    subs: 7,
    creator: '4Qm…10C',
    status: 'COMPLETED',
    sort: 3,
    description:
      'A 10-post thread explaining what an SVM-compatible chain is, for people who have used a wallet but never read a spec.',
    requirements: [
      'Plain language, no jargon without a definition',
      'No performance numbers we have not measured',
      'One diagram or image',
    ],
    submitInstructions: 'Paste a link to the draft thread. Do not publish before approval.',
    txSig: '1Ba7…zY6rM3vK9dH…Jw5',
    submissions: [
      {
        contributor: '7xQ…91A',
        when: '1 hour ago',
        status: 'Approved',
        num: '#1',
        note: 'Ten posts, one hand-drawn diagram of escrow, no price talk anywhere.',
        url: 'https://draft.example.com/svm-thread',
      },
    ],
  },
  {
    id: 'des-04',
    category: 'Design',
    title: 'Design bounty card illustrations',
    reward: 6,
    hours: 96,
    subs: 1,
    creator: '9Lk…77D',
    status: 'ACTIVE',
    sort: 4,
    description:
      'Six small warm illustrations, one per bounty category, that sit on a dark surface without glowing.',
    requirements: ['SVG, single accent colour plus cream', 'Legible at 48px', 'No gradients'],
    submitInstructions: 'Share a Figma link with view access, or a zip of SVGs.',
    txSig: '6Hn3…tR8wC2yF5eP…Ls9',
    submissions: [],
  },
  {
    id: 'com-05',
    category: 'Community',
    title: 'Host a Cookie community call',
    reward: 3,
    hours: 140,
    subs: 0,
    creator: '2Wc…31E',
    status: 'ACTIVE',
    sort: 5,
    description:
      'Run a 30-minute community call for builders shipping on Cookie Chain. Agenda, hosting, and a short written recap afterwards.',
    requirements: ['At least 15 attendees', 'Recording published', 'Written recap under 400 words'],
    submitInstructions: 'Submit the recording link and the recap.',
    txSig: '8Jd5…pM1qV7nB4xR…Gt2',
    submissions: [],
  },
  {
    id: 'res-06',
    category: 'Research',
    title: 'Benchmark SVM fee behaviour under load',
    reward: 8,
    hours: 12,
    subs: 5,
    creator: '5Tn…08F',
    status: 'PAID',
    sort: 6,
    description:
      'Measure real transaction cost and confirmation behaviour for small transfers, and publish the method so anyone can rerun it.',
    requirements: ['Reproducible script', 'Raw data published', 'No claims beyond what you measured'],
    submitInstructions: 'Link the repo with the script and the raw results.',
    txSig: '0Pq8…hF4jN9cZ6mW…Dk1',
    submissions: [
      {
        contributor: '3Vb…44K',
        when: '3 hours ago',
        status: 'Approved',
        num: '#1',
        note: '500 transfers over 4 hours, script and CSVs in the repo.',
        url: 'https://github.example.com/svm-fee-bench',
      },
    ],
  },
];

/**
 * Seed activity feed (fallback when no database, and the fixture `npm run db:seed` writes into the
 * `activity` table). Real events are appended by the indexer as bounties are funded and paid.
 */
export const SEED_ACTIVITY: ActivityItem[] = [
  { kind: 'Reward paid', title: 'Benchmark SVM fee behaviour under load', detail: 'Paid to 3Vb…44K', amount: '8 COOK', ago: '9m ago' },
  { kind: 'Bounty completed', title: 'Write a Cookie Chain explainer thread', detail: 'Paid to 7xQ…91A', amount: '4 COOK', ago: '41m ago' },
  { kind: 'New contribution', title: 'Build a Cookie analytics widget', detail: '2Wc…31E submitted work', amount: '10 COOK', ago: '1h ago' },
  { kind: 'Bounty funded', title: 'Design bounty card illustrations', detail: 'Escrow funded by 9Lk…77D', amount: '6 COOK', ago: '3h ago' },
  { kind: 'Bounty funded', title: 'Host a Cookie community call', detail: 'Escrow funded by 2Wc…31E', amount: '3 COOK', ago: '5h ago' },
  { kind: 'Bounty funded', title: 'Create a Cookie Chain meme', detail: 'Escrow funded by 7xQ…92A', amount: '2 COOK', ago: '8h ago' },
];

/** Format a COOK amount the way the design does — trims a trailing ".00" and rounds to 2dp. */
export const fmt = (n: number): string =>
  (Math.round(n * 100) / 100).toString().replace(/\.00$/, '');

/** "Ends in 1d 14h" / "Ends in 12h" from an hours-remaining count. */
export const endsLabel = (h: number): string =>
  h >= 24 ? `Ends in ${Math.floor(h / 24)}d ${h % 24}h` : `Ends in ${h}h`;

/** "Ends in"-less variant used in table rows. */
export const endsIn = (h: number): string =>
  h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;

/** "1 submission" / "N submissions". */
export const subsLabel = (n: number): string => (n === 1 ? '1 submission' : `${n} submissions`);
