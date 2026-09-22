"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  CATS,
  SORTS,
  STATUS,
  FUND_STEPS,
  PAY_STEPS,
  fmt,
  endsLabel,
  subsLabel,
} from "@/lib/cookie/data";
import { ORANGE, SAGE, AMBER, RED, MUTED } from "@/lib/cookie/theme";
import type { Bounty, ActivityItem } from "@/lib/cookie/types";
import { getGlobalStats, getLeaderboard, getMyWork, getWalletStats } from "@/lib/cookie/analytics";
import { BountyCard, type BountyCardView } from "./BountyCard";
import { Countdown } from "./Countdown";
import { isChainConfigured, isRpcConfigured, getExplorerTxUrl, parseCook } from "@/lib/cookie/chain";
import {
  connectNightly,
  disconnectNightly,
  fetchCookBalance,
  isNightlyInstalled,
  type NightlyWallet,
} from "@/lib/wallet/nightly";
import { PublicKey } from "@solana/web3.js";
import {
  createAndFundBounty,
  submitWork,
  approveSubmission,
  cancelBounty,
  refundBounty,
  type TxPhase,
} from "@/lib/program/sdk";

/** Deadline preset → seconds from now. */
function deadlineToSeconds(label: string): number {
  if (label === "24 hours") return 24 * 3600;
  if (label === "7 days") return 7 * 24 * 3600;
  return 48 * 3600; // 48 hours (default) / Custom
}

/** The program's custom error codes (from the Anchor IDL), for friendly messages (PRD §70). */
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "Reward must be greater than zero.",
  6001: "Deadline must be in the future.",
  6002: "Title is too long.",
  6003: "Metadata link is too long.",
  6004: "This bounty is not active.",
  6005: "This bounty has expired.",
  6006: "This bounty has already been completed.",
  6007: "Only the bounty creator can do that.",
  6008: "That submission doesn't belong to this bounty.",
  6009: "That submission isn't pending.",
  6010: "The contributor account doesn't match the submission.",
  6011: "The escrow doesn't belong to this bounty.",
  6012: "The bounty hasn't expired yet.",
  6013: "Can't cancel after a submission is approved.",
  6014: "Escrow has insufficient funds.",
  6015: "Arithmetic overflow.",
};

/** Map a chain/wallet error to a user-facing message (PRD §70). */
function mapChainError(err: unknown): string {
  const msg = (err as Error)?.message ?? "";
  if (/user rejected|rejected the request|cancelled|denied/i.test(msg)) return "Transaction cancelled in Nightly.";
  // Anchor/program custom error code, e.g. "custom program error: 0x1771" or Custom(6001).
  const hex = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
  const dec = msg.match(/Custom["\s:(]+(\d+)/);
  const code = hex ? parseInt(hex[1], 16) : dec ? parseInt(dec[1], 10) : NaN;
  if (!Number.isNaN(code) && PROGRAM_ERRORS[code]) return PROGRAM_ERRORS[code];
  if (/ProgramAccountNotFound|program that does not exist|Attempt to load a program that does not exist/i.test(msg))
    return "Switch Nightly to Cookie Chain (add the network with RPC rpc.cookiescan.io), then try again.";
  if (/insufficient (lamports|funds)|debit an account|attempt to debit|0x1\b/i.test(msg))
    return "Not enough COOK in this wallet to fund the bounty (you need the reward + a little for fees).";
  if (/blockhash|network|fetch|connection|timed out|timeout/i.test(msg)) return "Network error — check your Cookie Chain connection.";
  return msg ? `Transaction failed: ${msg.slice(0, 140)}` : "Transaction failed. Please try again.";
}

type TxKind = "fund" | "pay" | "submit" | "cancel" | "refund";

/** Five-step progress labels per transaction kind (the last is the confirmed state). */
const TX_STEPS: Record<TxKind, string[]> = {
  fund: FUND_STEPS,
  pay: PAY_STEPS,
  submit: ["Preparing transaction", "Waiting for Nightly", "Broadcasting", "Cookie Chain confirming", "Work submitted"],
  cancel: ["Preparing transaction", "Waiting for Nightly", "Broadcasting", "Cookie Chain confirming", "Bounty cancelled"],
  refund: ["Preparing transaction", "Waiting for Nightly", "Broadcasting", "Cookie Chain confirming", "Refund complete"],
};
const TX_TITLES: Record<TxKind, string> = {
  fund: "Funding bounty",
  pay: "Approving submission",
  submit: "Submitting work",
  cancel: "Cancelling bounty",
  refund: "Refunding bounty",
};

/**
 * Cookie Bounties — the interactive app shell, rebuilt from design/Cookie Bounties.dc.html.
 *
 * One client-owned state machine drives every screen (home, explore, detail, the create wizard,
 * my bounties / review, my work, activity, leaderboard, docs) and the modal stack. The wallet and
 * on-chain escrow flow are the design's mocked prototype: connecting Nightly, funding escrow,
 * submitting work, and releasing the reward all run as staged local transactions.
 */

const cap = "'Caprasimo',serif";
/** Where to send people who don't have the Nightly wallet yet (PRD §8 — Nightly is required). */
const NIGHTLY_URL = "https://nightly.app/";

type Screen =
  | "home"
  | "bounties"
  | "detail"
  | "create"
  | "my-bounties"
  | "review"
  | "my-work"
  | "activity"
  | "leaderboard"
  | "docs";

type ModalKind =
  | "connecting"
  | "fund"
  | "approve"
  | "tx"
  | "success"
  | "submit"
  | "submitted"
  | "completed"
  | "wallet"
  | "network"
  | "share";

interface FormState {
  title: string;
  description: string;
  reward: string;
  deadline: string;
  /** datetime-local value when deadline === "Custom". */
  customDeadline: string;
  category: string;
}

interface State {
  screen: Screen;
  modal: ModalKind | null;
  connected: boolean;
  hasNightly: boolean;
  wrongNetwork: boolean;
  address: string;
  balance: number;
  bountyId: string;
  reviewSubIndex: number;
  copied: boolean;
  toast: string | null;
  filter: string;
  sort: string;
  step: number;
  width: number;
  form: FormState;
  submission: { url: string; note: string };
  txKind: TxKind | null;
  txIndex: number;
  networkMode: "missing" | "wrong" | null;
  /** Signature of the last confirmed on-chain transaction (real path), for CookieScan links. */
  txSig: string | null;
  /** My-bounties dashboard scope: the connected wallet's bounties, or all. */
  dashScope: "mine" | "all";
}

// ── Static presentational content (colour-only, no state) ──
// Activity-feed colours by event kind (the feed's data comes from Neon).
const ACTIVITY_STYLE: Record<string, { color: string; tint: string }> = {
  "Bounty funded": { color: ORANGE, tint: "rgba(246,160,107,0.16)" },
  "Bounty completed": { color: SAGE, tint: "rgba(174,191,146,0.16)" },
  "Reward paid": { color: SAGE, tint: "rgba(174,191,146,0.16)" },
  "New contribution": { color: "#f5ead8", tint: "rgba(245,234,216,0.1)" },
  Refunded: { color: MUTED, tint: "rgba(245,234,216,0.08)" },
  "Bounty cancelled": { color: RED, tint: "rgba(212,115,94,0.14)" },
};
const activityStyle = (kind: string) => ACTIVITY_STYLE[kind] ?? { color: "#f5ead8", tint: "rgba(245,234,216,0.1)" };

const FLOW_NODES = [
  { title: "Creator funds", sub: "Deposit into escrow PDA", amount: "5 COOK", dot: ORANGE, bg: "rgba(246,160,107,0.08)", border: "rgba(246,160,107,0.28)" },
  { title: "Bounty funded", sub: "Status becomes active", amount: "Locked", dot: ORANGE, bg: "#141110", border: "rgba(245,234,216,0.12)" },
  { title: "Builder submits", sub: "Reference stored on-chain", amount: "", dot: "rgba(245,234,216,0.5)", bg: "#141110", border: "rgba(245,234,216,0.12)" },
  { title: "Creator approves", sub: "Only the creator can", amount: "✓", dot: SAGE, bg: "#141110", border: "rgba(245,234,216,0.12)" },
  { title: "Contributor paid", sub: "Escrow released", amount: "5 COOK", dot: SAGE, bg: "rgba(174,191,146,0.08)", border: "rgba(174,191,146,0.3)" },
];
const HOW_CARDS = [
  { num: "01", title: "Post", body: "Create a task and choose your reward." },
  { num: "02", title: "Build", body: "Community members complete the task." },
  { num: "03", title: "Earn", body: "Approve the work and pay the contributor on-chain." },
];
const WHY_CARDS = [
  { title: "Fast", body: "Rapid transaction confirmation, so approving work feels immediate." },
  { title: "Cheap", body: "Low-cost execution makes small community rewards practical." },
  { title: "On-chain", body: "Every funding and payout is verifiable on CookieScan." },
];
const LEADER_AVATARS = ["#c67139", "#7a8a5e", "#8c491a", "#645c50", "#b2622d", "#56633f"];
const DOC_SECTIONS = [
  { title: "What is Cookie Bounties?", body: "A community bounty board where people post tasks, lock COOK as the reward, and contributors get paid automatically when their work is approved." },
  { title: "How to create a bounty", body: "Write the task, set the reward, pick a deadline and category, then sign one transaction that creates the bounty and funds the escrow together." },
  { title: "How to submit work", body: "Open an active bounty before its deadline, add a link to your work and a short note. Only the reference is stored on-chain." },
  { title: "How payment works", body: "Only the bounty creator can approve. Approval releases the escrow to the winning contributor in the same transaction — the reward cannot be paid twice." },
  { title: "Why Cookie Chain", body: "SVM-compatible infrastructure with fast confirmation and low fees, which is what makes 2 COOK bounties practical at all." },
  { title: "How to get COOK", body: "Bridge COOK to Cookie Chain through the Hyperlane route. COOK uses 9 decimals and also pays network fees." },
];
const ESCROW_DIAGRAM = [
  { title: "Creator", sub: "Signs create + fund", amount: "5 COOK", color: ORANGE, bg: "rgba(246,160,107,0.08)", border: "rgba(246,160,107,0.3)" },
  { title: "Bounty escrow", sub: "Program-derived account", amount: "Locked", color: "#f5ead8", bg: "#141110", border: "rgba(245,234,216,0.14)" },
  { title: "Contributor", sub: "On approval only", amount: "5 COOK", color: SAGE, bg: "rgba(174,191,146,0.08)", border: "rgba(174,191,146,0.3)" },
];
const LIFECYCLE = ["Draft", "Funded", "Active", "Submissions", "Approved", "Paid", "Expired → Refunded", "Cancelled → Refunded"];
const NAV_DEFS: Array<[string, Screen]> = [
  ["Bounties", "bounties"],
  ["Activity", "activity"],
  ["Leaderboard", "leaderboard"],
  ["My Work", "my-work"],
  ["Dashboard", "my-bounties"],
  ["Docs", "docs"],
];
const MOBILE_DEFS: Array<[string, Screen]> = [
  ["Home", "home"],
  ["Bounties", "bounties"],
  ["Activity", "activity"],
  ["My Work", "my-work"],
];

const btnPrimary: CSSProperties = {
  background: "#c67139",
  color: "#141110",
  border: 0,
  borderRadius: 999,
  fontFamily: cap,
  cursor: "pointer",
};
const cardSurface: CSSProperties = {
  background: "#1a1615",
  border: "1px solid rgba(245,234,216,0.1)",
  borderRadius: 20,
  padding: 20,
};
const kicker: CSSProperties = {
  fontSize: 11.5,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  fontWeight: 800,
  color: "rgba(245,234,216,0.45)",
};

export function CookieBountiesApp({
  initialBounties,
  initialActivity = [],
  initialScreen = "home",
}: {
  initialBounties: Bounty[];
  initialActivity?: ActivityItem[];
  initialScreen?: Screen;
}) {
  const bounties = initialBounties.length > 0 ? initialBounties : [];
  const activity = initialActivity;

  const [s, setS] = useState<State>({
    screen: initialScreen,
    modal: null,
    connected: false,
    hasNightly: false,
    wrongNetwork: false,
    address: "",
    balance: 0,
    bountyId: bounties[0]?.id ?? "mem-01",
    reviewSubIndex: 0,
    copied: false,
    toast: null,
    filter: "All",
    sort: "Newest",
    step: 1,
    width: 1200,
    form: { title: "", description: "", reward: "5", deadline: "48 hours", customDeadline: "", category: "Design" },
    submission: { url: "", note: "" },
    txKind: null,
    txIndex: 0,
    networkMode: null,
    txSig: null,
    dashScope: "mine",
  });

  const patch = (u: Partial<State>) => setS((prev) => ({ ...prev, ...u }));
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The connected Nightly wallet, used to sign on-chain transactions.
  const walletRef = useRef<NightlyWallet | null>(null);
  const chainOn = isChainConfigured(); // RPC + deployed program → real transactions
  const rpcOn = isRpcConfigured(); // RPC alone → real connect + live balance
  const router = useRouter();

  // Reconcile chain → Neon, then re-pull the server data so the board reflects new on-chain state.
  const syncAndRefresh = async () => {
    if (chainOn) {
      try {
        await fetch("/api/indexer/sync", { method: "POST" });
      } catch {
        // Non-fatal — the periodic tick will retry.
      }
    }
    router.refresh();
  };

  useEffect(() => {
    const onResize = () => patch({ width: window.innerWidth });
    window.addEventListener("resize", onResize);
    onResize();
    const w = window as unknown as { nightly?: { solana?: unknown } };
    const p = w.nightly && ((w.nightly as { solana?: unknown }).solana || w.nightly);
    patch({ hasNightly: !!p });
    return () => {
      window.removeEventListener("resize", onResize);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Keep the board fresh automatically: every 20s reconcile chain → Neon (when on-chain) and
  // re-pull the server data. Client state (screen, wallet, modal) is preserved across refresh.
  useEffect(() => {
    const id = setInterval(() => {
      if (chainOn) {
        fetch("/api/indexer/sync", { method: "POST" })
          .catch(() => {})
          .finally(() => router.refresh());
      } else {
        router.refresh();
      }
    }, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    patch({ toast: msg });
    toastTimer.current = setTimeout(() => patch({ toast: null }), 2200);
  };
  const go = (screen: Screen) => patch({ screen, modal: null });

  const connect = async () => {
    // No Nightly extension → prompt to install it (Nightly is required).
    if (!isNightlyInstalled()) {
      patch({ modal: "network", networkMode: "missing" });
      return;
    }
    // Show a connecting modal while the Nightly extension opens on the desktop and the person
    // approves; read the live COOK balance from Cookie Chain once connected.
    patch({ modal: "connecting" });
    try {
      const { address, wallet } = await connectNightly();
      walletRef.current = wallet;
      // No forced changeNetwork: the user selects Cookie Chain (a custom SVM network) in Nightly.
      // Forcing it here just pops a confusing "→ Unknown" prompt. If they're on the wrong network,
      // signing fails with a clear "switch to Cookie Chain" message instead.
      let balance = 0;
      if (rpcOn) {
        try {
          balance = Number(await fetchCookBalance(wallet.publicKey)) / 1e9;
        } catch {
          // Balance read can fail if the RPC is unreachable; leave it at 0.
        }
      }
      patch({ connected: true, address, modal: null, balance });
      flash("Nightly connected");
    } catch (e) {
      patch({ modal: null });
      const msg = (e as Error)?.message || "";
      if (/reject|cancel|denied|user/i.test(msg)) {
        flash("Connection cancelled in Nightly");
      } else {
        console.error("[cookie connect]", e);
        flash(msg ? `Connect failed: ${msg.slice(0, 80)}` : "Connect failed — is Nightly on Cookie Chain?");
      }
    }
  };
  const installNightly = () => {
    if (typeof window !== "undefined") window.open(NIGHTLY_URL, "_blank", "noopener,noreferrer");
  };
  const disconnect = () => {
    void disconnectNightly();
    walletRef.current = null;
    patch({ connected: false, modal: null });
    flash("Wallet disconnected");
  };

  /** Drive the transaction modal from the real on-chain phases (PRD §47–§49). */
  const phaseIndex: Record<TxPhase, number> = {
    preparing: 0,
    signing: 1,
    broadcasting: 2,
    confirming: 3,
    done: 4,
  };

  /** Run a real on-chain action, driving the transaction modal from its phases. */
  const runChainAction = async (
    kind: TxKind,
    doTx: (onPhase: (p: TxPhase) => void) => Promise<string>,
    onDone?: (sig: string) => void,
  ) => {
    patch({ modal: "tx", txKind: kind, txIndex: 0 });
    try {
      const sig = await doTx((p) => patch({ txIndex: phaseIndex[p] }));
      patch({ txIndex: 4, txSig: sig });
      onDone?.(sig);
      // Pull the new on-chain state onto the board (best-effort; the periodic tick also covers it).
      void syncAndRefresh();
    } catch (e) {
      console.error("[cookie tx]", e);
      patch({ modal: null });
      flash(mapChainError(e));
    }
  };

  // On-chain actions require the deployed program; this message shows until it's configured.
  const needsChain = (verb: string) => flash(`Connect Nightly on Cookie Chain to ${verb}.`);

  // ── Derived values ──
  const narrow = s.width < 1080;
  const b = bounties.find((x) => x.id === s.bountyId) || bounties[0];
  const st = b ? STATUS[b.status] : STATUS.ACTIVE;
  const amt = parseFloat(s.form.reward) || 0;
  const shortAddress = s.address ? `${s.address.slice(0, 3)}…${s.address.slice(-3)}` : "";
  const balanceLabel = fmt(s.balance) + " COOK";

  // Real aggregations over the (Neon-backed) board — nothing hardcoded.
  const stats = getGlobalStats(bounties);
  const leaderboard = getLeaderboard(bounties);
  const myWork = getMyWork(bounties, s.address);
  const walletSummary = getWalletStats(bounties, s.address);

  const chipOn = (on: boolean) => ({
    background: on ? "rgba(246,160,107,0.16)" : "rgba(245,234,216,0.05)",
    border: `1px solid ${on ? "rgba(246,160,107,0.6)" : "rgba(245,234,216,0.14)"}`,
    color: on ? ORANGE : "rgba(245,234,216,0.75)",
  });

  const toCard = (x: Bounty): BountyCardView => ({
    id: x.id,
    category: x.category,
    title: x.title,
    reward: fmt(x.reward) + " COOK",
    ends: endsLabel(x.hours),
    subs: subsLabel(x.subs),
    creator: x.creator,
    status: STATUS[x.status].label,
    statusColor: STATUS[x.status].color,
    onOpen: () => patch({ screen: "detail", bountyId: x.id, modal: null }),
  });

  let list = bounties.filter((x) => s.filter === "All" || x.category === s.filter);
  if (s.sort === "Highest Reward") list = [...list].sort((a, c) => c.reward - a.reward);
  else if (s.sort === "Ending Soon") list = [...list].sort((a, c) => a.hours - c.hours);
  else if (s.sort === "Most Submissions") list = [...list].sort((a, c) => c.subs - a.subs);
  else list = [...list].sort((a, c) => c.sort - a.sort); // Newest: larger createdAt first

  const payTarget = (b?.submissions[s.reviewSubIndex] || b?.submissions[0] || { contributor: "7xQ…91A" }).contributor;

  const openWallet = () => patch({ modal: s.connected ? "wallet" : null, copied: false });
  const openGetCook = () => flash("Opens the Hyperlane Cookie Chain bridge");
  const viewOnScan = () => {
    if (s.txSig) {
      if (typeof window !== "undefined") window.open(getExplorerTxUrl(s.txSig), "_blank", "noopener,noreferrer");
      return;
    }
    flash("Opens CookieScan with the transaction signature");
  };
  const closeModal = () => patch({ modal: null });
  const openSubmit = () =>
    patch({ modal: s.connected ? "submit" : "network", networkMode: s.connected ? null : "missing" });

  const nextStep = () => {
    if (s.step < 5) {
      patch({ step: s.step + 1 });
      return;
    }
    if (!s.connected) {
      patch({ modal: "network", networkMode: "missing" });
      return;
    }
    if (amt > s.balance) {
      flash("Your wallet doesn't have enough COOK");
      return;
    }
    patch({ modal: "fund" });
  };

  const confirmFund = async () => {
    const wallet = walletRef.current;
    // Real path: upload metadata, create + fund the escrow on-chain, drive the modal from the
    // actual transaction phases, then refetch the live balance. State only changes on confirmation.
    if (chainOn && wallet) {
      // Resolve the deadline (custom date/time, or a preset offset from now).
      const nowSec = Math.floor(Date.now() / 1000);
      const deadlineTs =
        s.form.deadline === "Custom" && s.form.customDeadline
          ? Math.floor(new Date(s.form.customDeadline).getTime() / 1000)
          : nowSec + deadlineToSeconds(s.form.deadline);
      if (!deadlineTs || deadlineTs <= nowSec + 60) {
        flash("Pick a deadline at least a minute in the future.");
        return;
      }
      patch({ modal: "tx", txKind: "fund", txIndex: 0 });
      try {
        let descriptionUri = "";
        try {
          const res = await fetch("/api/metadata", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "bounty",
              data: {
                title: s.form.title || "Untitled bounty",
                description: s.form.description || "",
                requirements: [],
                submitInstructions: "",
                category: s.form.category,
              },
            }),
          });
          if (res.ok) descriptionUri = (await res.json()).uri;
        } catch {
          // Metadata upload is best-effort; the on-chain bounty can carry an empty URI.
        }

        const result = await createAndFundBounty(
          wallet,
          {
            bountyId: BigInt(Date.now()),
            title: s.form.title || "Untitled bounty",
            descriptionUri,
            category: s.form.category,
            rewardAmount: parseCook(s.form.reward || "0"),
            deadline: deadlineTs,
          },
          (p) => patch({ txIndex: phaseIndex[p] }),
        );

        patch({ txIndex: 4, txSig: result.signature });

        try {
          const bal = Number(await fetchCookBalance(wallet.publicKey)) / 1e9;
          patch({ balance: bal });
        } catch {
          // Non-fatal — the transaction still confirmed.
        }
        // The board + activity feed are refreshed from on-chain state by the reconcile below.
        void syncAndRefresh();
      } catch (e) {
        patch({ modal: null });
        flash(mapChainError(e));
      }
      return;
    }

    // Not yet on-chain (program not deployed / wallet not connected): no fake confirmation.
    patch({ modal: null });
    needsChain("fund this bounty");
  };
  const confirmApprove = async () => {
    const wallet = walletRef.current;
    const sub = b?.submissions[s.reviewSubIndex];
    // Real path: release the escrow to the winning contributor on Cookie Chain.
    if (chainOn && wallet && b?.pubkey && sub?.pubkey && sub?.contributorAddress) {
      await runChainAction(
        "pay",
        (onPhase) =>
          approveSubmission(
            wallet,
            new PublicKey(b.pubkey!),
            new PublicKey(sub.pubkey!),
            new PublicKey(sub.contributorAddress!),
            onPhase,
          ),
      );
      return;
    }
    patch({ modal: null });
    needsChain("release the reward");
  };

  const confirmSubmit = async () => {
    if (!s.submission.url) {
      flash("Add a link to your work first");
      return;
    }
    const wallet = walletRef.current;
    // Real path: store the work metadata off-chain, then record the submission on Cookie Chain.
    if (chainOn && wallet && b?.pubkey) {
      let uri = s.submission.url;
      try {
        const res = await fetch("/api/metadata", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "submission",
            data: { description: s.submission.note, links: [s.submission.url], attachments: [] },
          }),
        });
        if (res.ok) uri = (await res.json()).uri;
      } catch {
        // Best-effort — fall back to the raw URL as the on-chain reference.
      }
      const bountyPubkey = b.pubkey;
      await runChainAction(
        "submit",
        (onPhase) => submitWork(wallet, new PublicKey(bountyPubkey), uri, onPhase).then((r) => r.signature),
      );
      return;
    }
    patch({ modal: null });
    needsChain("submit work");
  };

  const confirmCancel = async () => {
    const wallet = walletRef.current;
    if (!(chainOn && wallet && b?.pubkey)) return;
    const bountyPubkey = b.pubkey;
    await runChainAction(
      "cancel",
      (onPhase) => cancelBounty(wallet, new PublicKey(bountyPubkey), onPhase),
    );
  };

  const confirmRefund = async () => {
    const wallet = walletRef.current;
    if (!(chainOn && wallet && b?.pubkey)) return;
    const bountyPubkey = b.pubkey;
    await runChainAction(
      "refund",
      (onPhase) => refundBounty(wallet, new PublicKey(bountyPubkey), onPhase),
    );
  };
  const copyAddress = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(s.address);
    patch({ copied: true });
    setTimeout(() => patch({ copied: false }), 1600);
  };

  const txKind: TxKind = s.txKind ?? "fund";
  const txSteps = TX_STEPS[txKind].map((label, i) => {
    const done = i < s.txIndex;
    const active = i === s.txIndex;
    return {
      label,
      mark: done ? "✓" : "",
      ring: done ? SAGE : active ? ORANGE : "rgba(245,234,216,0.2)",
      fill: done ? SAGE : active ? "rgba(246,160,107,0.35)" : "transparent",
      color: done ? "rgba(245,234,216,0.75)" : active ? "#f5ead8" : "rgba(245,234,216,0.38)",
      weight: active ? 700 : 500,
    };
  });
  const txDone = s.txIndex >= txSteps.length - 1;
  const txTitle = TX_TITLES[txKind];
  const txResultTitle =
    txKind === "pay" ? "Payment complete"
    : txKind === "submit" ? "Work submitted"
    : txKind === "cancel" ? "Bounty cancelled"
    : txKind === "refund" ? "Refund complete"
    : "Bounty funded";
  const txResultDetail =
    txKind === "pay" ? `${b ? fmt(b.reward) : ""} COOK → ${payTarget}`
    : txKind === "submit" ? "Your work is on-chain, awaiting review"
    : txKind === "cancel" ? `${b ? fmt(b.reward) : ""} COOK returned to you`
    : txKind === "refund" ? `${b ? fmt(b.reward) : ""} COOK refunded`
    : `${fmt(amt)} COOK secured in escrow`;
  const txContinueLabel =
    txKind === "pay" ? "See the payout" : txKind === "submit" ? "Go to My Work" : txKind === "cancel" || txKind === "refund" ? "Done" : "Continue";
  const txContinue = () => {
    if (txKind === "pay") patch({ modal: "completed" });
    else if (txKind === "submit") patch({ modal: "submitted" });
    else if (txKind === "fund") patch({ modal: "success" });
    else patch({ modal: null, screen: "my-bounties" });
  };

  const shareTargets = ["Copy link", "X", "Telegram", "Discord"].map((l) => ({
    label: l,
    act: () => flash(l === "Copy link" ? "Link copied" : "Opens a " + l + " share"),
  }));

  // ══════════════════════════════════════════════════════════════════
  // Render helpers
  // ══════════════════════════════════════════════════════════════════

  const renderTopBar = () => (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(20,17,16,0.86)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(245,234,216,0.1)",
      }}
    >
      <div style={{ maxWidth: 1220, margin: "0 auto", padding: "14px 22px", display: "flex", alignItems: "center", gap: 26 }}>
        <button
          onClick={() => go("home")}
          style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: 0, padding: 0, cursor: "pointer", color: "#f5ead8" }}
        >
          <span style={{ width: 30, height: 30, borderRadius: 999, background: "#c67139", display: "grid", placeItems: "center", flex: "none" }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: "#141110", boxShadow: "6px -4px 0 -4px #141110, -5px 5px 0 -4.5px #141110" }} />
          </span>
          <span style={{ fontFamily: cap, fontSize: 17, letterSpacing: "0.01em" }}>Cookie Bounties</span>
        </button>

        {!narrow && (
          <nav style={{ display: "flex", gap: 4, marginLeft: 8, flex: "none" }}>
            {NAV_DEFS.map(([label, key]) => (
              <button
                key={key}
                className="cb-navpill"
                onClick={() => go(key)}
                style={{
                  background: s.screen === key ? "rgba(246,160,107,0.16)" : "transparent",
                  color: s.screen === key ? ORANGE : "rgba(245,234,216,0.7)",
                  border: 0,
                  borderRadius: 999,
                  padding: "8px 15px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flex: "none",
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        <div style={{ flex: 1 }} />

        {s.connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
            <button
              className="cb-outline"
              onClick={openGetCook}
              style={{ background: "transparent", border: "1px solid rgba(245,234,216,0.18)", color: "#f5ead8", borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}
            >
              Get COOK
            </button>
            <button
              onClick={openWallet}
              style={{ display: "flex", alignItems: "center", gap: 10, background: "#1f1a18", border: "1px solid rgba(245,234,216,0.14)", borderRadius: 999, padding: "6px 8px 6px 14px", cursor: "pointer", color: "#f5ead8", whiteSpace: "nowrap", flex: "none" }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{balanceLabel}</span>
              <span style={{ background: "#2a2321", borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: 700, color: "#f6a06b", fontVariantNumeric: "tabular-nums" }}>{shortAddress}</span>
            </button>
          </div>
        ) : (
          <button
            className="cb-primary"
            onClick={connect}
            style={{ ...btnPrimary, padding: "10px 18px", fontSize: 14, whiteSpace: "nowrap", flex: "none" }}
          >
            Connect Nightly
          </button>
        )}
      </div>
    </div>
  );

  const renderHome = () => (
    <div>
      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "56px 22px 20px", display: "grid", gap: 44, gridTemplateColumns: narrow ? "1fr" : "minmax(0,1.15fr) minmax(0,0.85fr)", alignItems: "start" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(174,191,146,0.12)", border: "1px solid rgba(174,191,146,0.3)", color: "#c8d6ae", borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "#aebf92", animation: "cbPulse 1.8s ease-in-out infinite" }} />
            Live on Cookie Chain
          </div>
          <h1 style={{ fontSize: narrow ? 44 : 62, margin: "20px 0 0", lineHeight: 0.98 }}>
            Build something.
            <br />
            <span style={{ color: "#f6a06b" }}>Get paid on-chain.</span>
          </h1>
          <p style={{ margin: "20px 0 0", fontSize: 18, maxWidth: "30em", color: "rgba(245,234,216,0.72)" }}>
            Community-powered tasks funded and settled on Cookie Chain. The reward is locked in escrow before anyone starts working.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
            <button className="cb-primary" onClick={() => go("create")} style={{ ...btnPrimary, padding: "14px 26px", fontSize: 16 }}>Create a Bounty</button>
            <button className="cb-soft" onClick={() => go("bounties")} style={{ background: "transparent", color: "#f5ead8", border: "1px solid rgba(245,234,216,0.24)", borderRadius: 999, padding: "14px 26px", fontFamily: cap, fontSize: 16, cursor: "pointer" }}>Explore Bounties</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 26, marginTop: 38, paddingTop: 26, borderTop: "1px solid rgba(245,234,216,0.1)" }}>
            {[
              { value: String(stats.activeBounties), label: "Active bounties" },
              { value: fmt(stats.cookInEscrow), label: "COOK in escrow" },
              { value: String(stats.completed), label: "Completed" },
              { value: fmt(stats.cookPaid), label: "COOK paid" },
            ].map((stat) => (
              <div key={stat.label}>
                <div style={{ fontFamily: cap, fontSize: 26, color: "#f5ead8", fontVariantNumeric: "tabular-nums" }}>{stat.value}</div>
                <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(245,234,216,0.5)", fontWeight: 700, marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 28, padding: "26px 24px", position: "relative", overflow: "hidden" }}>
          <div style={{ ...kicker, fontWeight: 700, color: "rgba(245,234,216,0.45)" }}>How a bounty settles</div>
          <div style={{ position: "relative", marginTop: 18 }}>
            <div style={{ position: "absolute", left: "50%", top: 26, bottom: 26, width: 2, background: "linear-gradient(#c67139,rgba(174,191,146,0.6))", transform: "translateX(-50%)", opacity: 0.35 }} />
            <div style={{ position: "absolute", left: "50%", top: 26, transform: "translateX(-50%)", width: 22, height: 22, borderRadius: 999, background: "#f6a06b", color: "#141110", fontSize: 10, fontWeight: 800, display: "grid", placeItems: "center", animation: "cbFlow 3.4s cubic-bezier(.6,0,.4,1) infinite" }}>5</div>
            <div style={{ position: "relative", display: "grid", gap: 14 }}>
              {FLOW_NODES.map((node) => (
                <div key={node.title} style={{ display: "flex", alignItems: "center", gap: 14, background: node.bg, border: `1px solid ${node.border}`, borderRadius: 16, padding: "13px 16px" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: node.dot, flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{node.title}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.55)" }}>{node.sub}</div>
                  </div>
                  <div style={{ fontFamily: cap, fontSize: 15, color: node.dot, fontVariantNumeric: "tabular-nums" }}>{node.amount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "34px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
          <h3 style={{ fontSize: 19 }}>Happening now</h3>
          <button onClick={() => go("activity")} style={{ background: "none", border: 0, color: "#f6a06b", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>Open activity feed →</button>
        </div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          {activity.slice(0, 3).map((item, i) => {
            const st2 = activityStyle(item.kind);
            return (
              <div key={i} style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 16, padding: "16px 18px", animation: "cbIn 420ms ease both" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: st2.color }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: st2.color }} />
                  {item.kind}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 9 }}>{item.title}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
                  <span style={{ fontFamily: cap, fontSize: 15, color: "#f6a06b" }}>{item.amount}</span>
                  <span style={{ fontSize: 12, color: "rgba(245,234,216,0.5)", fontVariantNumeric: "tabular-nums" }}>{item.ago}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "62px 22px 0" }}>
        <h2 style={{ fontSize: 34 }}>How it works</h2>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", marginTop: 22 }}>
          {HOW_CARDS.map((card) => (
            <div key={card.num} className="cb-lift-4" style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 22, padding: "26px 24px 28px" }}>
              <div style={{ fontFamily: cap, fontSize: 40, color: "rgba(246,160,107,0.5)", lineHeight: 1 }}>{card.num}</div>
              <h4 style={{ fontSize: 22, marginTop: 12 }}>{card.title}</h4>
              <p style={{ marginTop: 8, color: "rgba(245,234,216,0.68)", fontSize: 15 }}>{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "62px 22px 0" }}>
        <div style={{ background: "linear-gradient(135deg,#241c18,#191514)", border: "1px solid rgba(246,160,107,0.28)", borderRadius: 28, padding: "40px 36px", display: "grid", gap: 28, gridTemplateColumns: narrow ? "1fr" : "minmax(0,1.3fr) minmax(0,0.7fr)", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: 32, color: "#f6a06b" }}>Your reward is already there</h2>
            <p style={{ marginTop: 12, fontSize: 17, color: "rgba(245,234,216,0.78)", maxWidth: "34em" }}>
              Creators fund bounties before contributors start working. The reward isn&apos;t a promise — it&apos;s secured on-chain by the Cookie Bounties program until the bounty is completed, cancelled or refunded.
            </p>
            <button onClick={() => go("docs")} style={{ marginTop: 18, background: "none", border: 0, color: "#f6a06b", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: 0 }}>Read how escrow works →</button>
          </div>
          <div style={{ background: "#141110", border: "1px solid rgba(245,234,216,0.12)", borderRadius: 20, padding: 22, textAlign: "center" }}>
            <div style={kicker}>Locked in escrow</div>
            <div style={{ fontFamily: cap, fontSize: 44, color: "#f6a06b", marginTop: 8 }}>5 COOK</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, background: "rgba(174,191,146,0.14)", color: "#c8d6ae", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>✓ Funded</div>
            <div style={{ marginTop: 14, fontSize: 12.5, color: "rgba(245,234,216,0.5)", wordBreak: "break-all" }}>Program-derived escrow account</div>
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "62px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h2 style={{ fontSize: 34 }}>Find something to build</h2>
          <button onClick={() => go("bounties")} style={{ background: "none", border: 0, color: "#f6a06b", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: 0 }}>All bounties →</button>
        </div>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", marginTop: 22 }}>
          {list.slice(0, 3).map((x) => (
            <BountyCard key={x.id} view={toCard(x)} />
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "62px 22px 0" }}>
        <h2 style={{ fontSize: 34, maxWidth: "14em" }}>Built for fast community payments</h2>
        <p style={{ marginTop: 12, maxWidth: "44em", fontSize: 16.5, color: "rgba(245,234,216,0.7)" }}>
          Cookie Bounties uses Cookie Chain&apos;s SVM-compatible infrastructure for fast, low-cost on-chain bounty funding and payouts.
        </p>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", marginTop: 24 }}>
          {WHY_CARDS.map((c) => (
            <div key={c.title} style={{ border: "1px solid rgba(245,234,216,0.1)", borderRadius: 20, padding: 24, background: "#1a1615" }}>
              <h4 style={{ fontSize: 20, color: "#aebf92" }}>{c.title}</h4>
              <p style={{ marginTop: 8, fontSize: 14.5, color: "rgba(245,234,216,0.66)" }}>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "62px 22px 80px" }}>
        <div style={{ border: "1px solid rgba(245,234,216,0.12)", borderRadius: 28, padding: "48px 36px", textAlign: "center", background: "#1a1615" }}>
          <h2 style={{ fontSize: 36 }}>Got something worth building?</h2>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 22 }}>
            <button className="cb-primary" onClick={() => go("create")} style={{ ...btnPrimary, padding: "14px 26px", fontSize: 16 }}>Create a Bounty</button>
            <button className="cb-soft" onClick={() => go("activity")} style={{ background: "transparent", color: "#f5ead8", border: "1px solid rgba(245,234,216,0.24)", borderRadius: 999, padding: "14px 26px", fontFamily: cap, fontSize: 16, cursor: "pointer" }}>Explore the Community</button>
          </div>
        </div>
      </section>
    </div>
  );

  const renderBounties = () => (
    <section style={{ maxWidth: 1220, margin: "0 auto", padding: "44px 22px 80px" }}>
      <h1 style={{ fontSize: 40 }}>Explore bounties</h1>
      <p style={{ marginTop: 10, fontSize: 17, color: "rgba(245,234,216,0.65)" }}>Find something worth building.</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 26 }}>
        {CATS.map((c) => {
          const on = chipOn(s.filter === c);
          return (
            <button key={c} className="cb-border-warm" onClick={() => patch({ filter: c })} style={{ ...on, borderRadius: 999, padding: "8px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{c}</button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 16, paddingBottom: 18, borderBottom: "1px solid rgba(245,234,216,0.1)" }}>
        <span style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Sort</span>
        {SORTS.map((x) => (
          <button key={x} onClick={() => patch({ sort: x })} style={{ background: "none", border: 0, padding: "4px 2px", marginRight: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: s.sort === x ? ORANGE : "rgba(245,234,216,0.6)", borderBottom: `2px solid ${s.sort === x ? ORANGE : "transparent"}` }}>{x}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "rgba(245,234,216,0.5)" }}>{list.length + (list.length === 1 ? " bounty" : " bounties")}</span>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", marginTop: 22 }}>
        {list.map((x) => (
          <BountyCard key={x.id} view={toCard(x)} />
        ))}
      </div>

      {list.length === 0 && (
        <div style={{ textAlign: "center", padding: "72px 20px", border: "1px dashed rgba(245,234,216,0.16)", borderRadius: 24, marginTop: 22 }}>
          <h3 style={{ fontSize: 24 }}>Nothing here yet.</h3>
          <p style={{ marginTop: 8, color: "rgba(245,234,216,0.6)" }}>Be the first person to create a bounty in this category.</p>
          <button className="cb-primary" onClick={() => go("create")} style={{ ...btnPrimary, marginTop: 18, padding: "12px 22px", fontSize: 15 }}>Create Bounty</button>
        </div>
      )}
    </section>
  );

  const renderDetail = () => {
    if (!b) return null;
    // The connected wallet created this bounty → creator view (review, not submit).
    const isMine = chainOn && !!b.creatorAddress && s.address === b.creatorAddress;
    const deadlineTs = b.deadlineTs ?? Math.floor(Date.now() / 1000) + b.hours * 3600;
    return (
      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "28px 22px 90px" }}>
        <button onClick={() => go("bounties")} style={{ background: "none", border: 0, color: "rgba(245,234,216,0.6)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>← All bounties</button>
        <div style={{ display: "grid", gap: 26, gridTemplateColumns: narrow ? "1fr" : "minmax(0,65fr) minmax(0,35fr)", marginTop: 18, alignItems: "start" }}>
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <span style={{ background: "rgba(245,234,216,0.08)", borderRadius: 999, padding: "5px 13px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(245,234,216,0.75)" }}>{b.category}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "5px 13px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: st.color, background: st.bg }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: st.color }} />
                {st.label}
              </span>
            </div>
            <h1 style={{ fontSize: narrow ? 30 : 40, marginTop: 14, textWrap: "pretty" }}>{b.title}</h1>

            <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 22, padding: 26, marginTop: 22 }}>
              <h5 style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,234,216,0.45)", fontFamily: "'Figtree',sans-serif", fontWeight: 800 }}>Description</h5>
              <p style={{ marginTop: 10, fontSize: 16, color: "rgba(245,234,216,0.82)" }}>{b.description}</p>

              <h5 style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,234,216,0.45)", fontFamily: "'Figtree',sans-serif", fontWeight: 800, marginTop: 24 }}>Requirements</h5>
              <div style={{ display: "grid", gap: 9, marginTop: 10 }}>
                {b.requirements.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", fontSize: 15, color: "rgba(245,234,216,0.82)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#c67139", marginTop: 8, flex: "none" }} />
                    <span>{r}</span>
                  </div>
                ))}
              </div>

              <h5 style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,234,216,0.45)", fontFamily: "'Figtree',sans-serif", fontWeight: 800, marginTop: 24 }}>How to submit</h5>
              <p style={{ marginTop: 10, fontSize: 15, color: "rgba(245,234,216,0.75)" }}>{b.submitInstructions}</p>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 32 }}>
              <h3 style={{ fontSize: 22 }}>Submissions</h3>
              <span style={{ fontSize: 13, color: "rgba(245,234,216,0.5)" }}>{subsLabel(b.subs)}</span>
            </div>
            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {b.submissions.map((sub, i) => (
                <div key={i} style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 18, padding: "16px 18px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ width: 34, height: 34, borderRadius: 999, background: ["#c67139", "#7a8a5e", "#8c491a"][i % 3], flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{sub.contributor}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.5)" }}>{sub.when}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: sub.status === "Rejected" ? RED : AMBER }}>{sub.status}</span>
                </div>
              ))}
            </div>
            {b.submissions.length === 0 && (
              <div style={{ border: "1px dashed rgba(245,234,216,0.16)", borderRadius: 18, padding: 34, textAlign: "center", marginTop: 14, color: "rgba(245,234,216,0.6)" }}>No one has submitted work yet.</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 14, position: narrow ? "static" : "sticky", top: 86 }}>
            <div style={{ background: "linear-gradient(160deg,#241c18,#1a1615)", border: "1px solid rgba(246,160,107,0.32)", borderRadius: 24, padding: 24 }}>
              <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.5)" }}>Reward</div>
              <div style={{ fontFamily: cap, fontSize: 46, color: "#f6a06b", lineHeight: 1, marginTop: 6 }}>{fmt(b.reward)} COOK</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12, background: "rgba(174,191,146,0.14)", color: "#c8d6ae", borderRadius: 999, padding: "6px 13px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>✓ Funded in escrow</div>
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(245,234,216,0.12)" }}>
                <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Ends in</div>
                <Countdown deadlineTs={deadlineTs} style={{ fontFamily: cap, fontSize: 24, marginTop: 4, display: "block", fontVariantNumeric: "tabular-nums" }} />
              </div>
              {isMine ? (
                <button className="cb-primary" onClick={() => patch({ screen: "review", bountyId: b.id, reviewSubIndex: 0 })} style={{ ...btnPrimary, width: "100%", marginTop: 18, padding: 14, fontSize: 16 }}>Review Submissions ({b.subs})</button>
              ) : (
                <button className="cb-primary" onClick={openSubmit} style={{ ...btnPrimary, width: "100%", marginTop: 18, padding: 14, fontSize: 16 }}>Submit Work</button>
              )}
            </div>

            <div style={cardSurface}>
              <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Created by</div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 999, background: "#c67139" }} />
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{b.creator}</div>
                  <button onClick={openWallet} style={{ background: "none", border: 0, padding: 0, color: "#f6a06b", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>View wallet</button>
                </div>
              </div>
              <div style={{ height: 1, background: "rgba(245,234,216,0.1)", margin: "16px 0" }} />
              <button className="cb-outline" onClick={viewOnScan} style={{ width: "100%", background: "transparent", border: "1px solid rgba(245,234,216,0.18)", color: "#f5ead8", borderRadius: 999, padding: 11, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>View funding transaction</button>
              <div style={{ marginTop: 12, fontSize: 11.5, color: "rgba(245,234,216,0.4)", wordBreak: "break-all", fontVariantNumeric: "tabular-nums" }}>{b.txSig}</div>
            </div>

            {isMine && b.pubkey && b.status === "ACTIVE" && (
              <div style={cardSurface}>
                <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Creator controls</div>
                {Math.floor(Date.now() / 1000) < deadlineTs ? (
                  <button className="cb-danger" onClick={confirmCancel} style={{ width: "100%", marginTop: 12, background: "transparent", border: "1px solid rgba(212,115,94,0.4)", color: "#e8a08d", borderRadius: 999, padding: 11, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Cancel &amp; refund escrow</button>
                ) : (
                  <button className="cb-outline" onClick={confirmRefund} style={{ width: "100%", marginTop: 12, background: "transparent", border: "1px solid rgba(245,234,216,0.18)", color: "#f5ead8", borderRadius: 999, padding: 11, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Refund expired bounty (send escrow back)</button>
                )}
                <div style={{ marginTop: 8, fontSize: 11.5, color: "rgba(245,234,216,0.45)" }}>
                  If no work is approved by the deadline, refund returns the escrow to you.
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {shareTargets.map((t) => (
                <button key={t.label} className="cb-outline" onClick={t.act} style={{ flex: 1, minWidth: 70, background: "transparent", border: "1px solid rgba(245,234,216,0.14)", color: "rgba(245,234,216,0.75)", borderRadius: 999, padding: "9px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.label}</button>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderCreate = () => {
    const rewardPresets = ["1", "2", "5", "10"];
    const deadlines = ["24 hours", "48 hours", "7 days", "Custom"];
    const deadlineLabel =
      s.form.deadline === "Custom" && s.form.customDeadline
        ? new Date(s.form.customDeadline).toLocaleString()
        : s.form.deadline;
    const reviewRows = [
      { label: "Reward", value: fmt(amt) + " COOK", color: ORANGE },
      { label: "Deadline", value: deadlineLabel, color: "#f5ead8" },
      { label: "Category", value: s.form.category, color: "#f5ead8" },
      { label: "Funding", value: fmt(amt) + " COOK", color: ORANGE },
    ];
    return (
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "44px 22px 90px" }}>
        <div style={{ display: "flex", gap: 7, marginBottom: 26 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: i <= s.step ? ORANGE : "rgba(245,234,216,0.14)" }} />
          ))}
        </div>
        <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Step {s.step} of 5</div>

        {s.step === 1 && (
          <div style={{ animation: "cbPop 240ms ease both" }}>
            <h1 style={{ fontSize: 36, marginTop: 10 }}>What do you need?</h1>
            <div style={{ marginTop: 26 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(245,234,216,0.5)", marginBottom: 8 }}>Title</label>
              <input className="cb-input" value={s.form.title} onChange={(e) => patch({ form: { ...s.form, title: e.target.value } })} placeholder="Create a Cookie Chain meme" style={{ width: "100%", background: "#1a1615", border: "1px solid rgba(245,234,216,0.16)", color: "#f5ead8", borderRadius: 999, padding: "14px 20px", fontSize: 16, fontFamily: "'Figtree',sans-serif" }} />
            </div>
            <div style={{ marginTop: 20 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(245,234,216,0.5)", marginBottom: 8 }}>Description</label>
              <textarea className="cb-input" rows={5} value={s.form.description} onChange={(e) => patch({ form: { ...s.form, description: e.target.value } })} placeholder="Create a high-quality meme promoting Cookie Chain that can be posted on X." style={{ width: "100%", background: "#1a1615", border: "1px solid rgba(245,234,216,0.16)", color: "#f5ead8", borderRadius: 20, padding: "14px 18px", fontSize: 15.5, fontFamily: "'Figtree',sans-serif", resize: "vertical" }} />
            </div>
          </div>
        )}

        {s.step === 2 && (
          <div style={{ animation: "cbPop 240ms ease both" }}>
            <h1 style={{ fontSize: 36, marginTop: 10 }}>How much is it worth?</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 26, background: "#1a1615", border: "1px solid rgba(246,160,107,0.4)", borderRadius: 24, padding: "22px 24px" }}>
              <input value={s.form.reward} onChange={(e) => patch({ form: { ...s.form, reward: e.target.value.replace(/[^0-9.]/g, "") } })} inputMode="decimal" style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, color: "#f6a06b", fontFamily: cap, fontSize: 44, outline: "none" }} />
              <span style={{ fontFamily: cap, fontSize: 24, color: "rgba(245,234,216,0.6)" }}>COOK</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {rewardPresets.map((v) => (
                <button key={v} className="cb-outline" onClick={() => patch({ form: { ...s.form, reward: v } })} style={{ background: "rgba(245,234,216,0.07)", border: "1px solid rgba(245,234,216,0.14)", color: "#f5ead8", borderRadius: 999, padding: "8px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{v} COOK</button>
              ))}
            </div>
            <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 20, padding: 20, marginTop: 22, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}><span style={{ color: "rgba(245,234,216,0.6)" }}>Your balance</span><span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{balanceLabel}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}><span style={{ color: "rgba(245,234,216,0.6)" }}>Locked in escrow</span><span style={{ fontWeight: 700, color: "#f6a06b", fontVariantNumeric: "tabular-nums" }}>−{s.form.reward} COOK</span></div>
              <div style={{ height: 1, background: "rgba(245,234,216,0.1)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15.5 }}><span style={{ color: "rgba(245,234,216,0.6)" }}>After funding</span><span style={{ fontFamily: cap, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{fmt(Math.max(0, s.balance - amt))} COOK</span></div>
            </div>
            {amt > s.balance && (
              <div style={{ marginTop: 14, background: "rgba(212,115,94,0.12)", border: "1px solid rgba(212,115,94,0.45)", color: "#e8a08d", borderRadius: 16, padding: "14px 18px", fontSize: 14 }}>Your wallet doesn&apos;t have enough COOK to fund this bounty.</div>
            )}
          </div>
        )}

        {s.step === 3 && (
          <div style={{ animation: "cbPop 240ms ease both" }}>
            <h1 style={{ fontSize: 36, marginTop: 10 }}>When should it end?</h1>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 26 }}>
              {deadlines.map((d) => {
                const on = s.form.deadline === d;
                return (
                  <button key={d} className="cb-border-warm" onClick={() => patch({ form: { ...s.form, deadline: d } })} style={{ background: on ? "rgba(246,160,107,0.12)" : "#1a1615", border: `1px solid ${on ? "rgba(246,160,107,0.6)" : "rgba(245,234,216,0.12)"}`, color: "#f5ead8", borderRadius: 20, padding: 20, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontFamily: cap, fontSize: 22, color: on ? ORANGE : "#f5ead8" }}>{d}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.5)", marginTop: 4 }}>{d === "48 hours" ? "Recommended" : d === "Custom" ? "Pick a date and time" : "Refundable after expiry"}</div>
                  </button>
                );
              })}
            </div>
            {s.form.deadline === "Custom" && (
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(245,234,216,0.5)", marginBottom: 8 }}>Deadline date &amp; time</label>
                <input
                  className="cb-input"
                  type="datetime-local"
                  value={s.form.customDeadline}
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={(e) => patch({ form: { ...s.form, customDeadline: e.target.value } })}
                  style={{ width: "100%", maxWidth: 320, background: "#1a1615", border: "1px solid rgba(245,234,216,0.16)", color: "#f5ead8", borderRadius: 16, padding: "12px 16px", fontSize: 15, fontFamily: "'Figtree',sans-serif", colorScheme: "dark" }}
                />
                {s.form.customDeadline && (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: "rgba(245,234,216,0.5)" }}>
                    Ends {new Date(s.form.customDeadline).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {s.step === 4 && (
          <div style={{ animation: "cbPop 240ms ease both" }}>
            <h1 style={{ fontSize: 36, marginTop: 10 }}>Pick a category</h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 26 }}>
              {CATS.slice(1).concat(["Other"]).map((c) => {
                const on = chipOn(s.form.category === c);
                return (
                  <button key={c} className="cb-border-warm" onClick={() => patch({ form: { ...s.form, category: c } })} style={{ ...on, borderRadius: 999, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{c}</button>
                );
              })}
            </div>
          </div>
        )}

        {s.step === 5 && (
          <div style={{ animation: "cbPop 240ms ease both" }}>
            <h1 style={{ fontSize: 36, marginTop: 10 }}>Review &amp; fund</h1>
            <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.12)", borderRadius: 24, padding: 26, marginTop: 22 }}>
              <h3 style={{ fontSize: 26, textWrap: "pretty" }}>{s.form.title || "Create a Cookie Chain meme"}</h3>
              <p style={{ marginTop: 10, color: "rgba(245,234,216,0.7)", fontSize: 15 }}>{s.form.description || "Create a high-quality meme promoting Cookie Chain that can be posted on X."}</p>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(245,234,216,0.1)" }}>
                {reviewRows.map((r) => (
                  <div key={r.label}>
                    <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>{r.label}</div>
                    <div style={{ fontFamily: cap, fontSize: 20, marginTop: 4, color: r.color }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "rgba(246,160,107,0.08)", border: "1px solid rgba(246,160,107,0.3)", borderRadius: 20, padding: "18px 20px", marginTop: 16, fontSize: 14, color: "rgba(245,234,216,0.8)" }}>
              <strong style={{ color: "#f6a06b" }}>You are funding escrow.</strong> {fmt(amt)} COOK will be locked in this bounty until it is completed, cancelled, or refunded after the deadline.
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 30, alignItems: "center" }}>
          {s.step > 1 && (
            <button className="cb-soft" onClick={() => patch({ step: Math.max(1, s.step - 1) })} style={{ background: "transparent", border: "1px solid rgba(245,234,216,0.2)", color: "#f5ead8", borderRadius: 999, padding: "13px 24px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Back</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="cb-primary" onClick={nextStep} style={{ ...btnPrimary, padding: "14px 28px", fontSize: 16 }}>{s.step === 5 ? "Fund & Publish" : "Continue"}</button>
        </div>
      </section>
    );
  };

  const renderMyBounties = () => {
    // A bounty is "mine" if its on-chain creator matches my wallet, or (demo) its display creator
    // matches my shortened address.
    const mine = s.connected
      ? bounties.filter((x) => (x.creatorAddress ? x.creatorAddress === s.address : x.creator === shortAddress))
      : [];
    const shown = s.dashScope === "mine" ? mine : bounties;

    // Stats are always for my wallet's bounties, regardless of the list toggle.
    const myStats = [
      { value: String(mine.filter((x) => x.status === "ACTIVE").length), label: "Active", color: "#f5ead8" },
      { value: String(mine.reduce((n, x) => n + x.subs, 0)), label: "Submissions", color: "#f5ead8" },
      { value: String(mine.filter((x) => x.status === "COMPLETED" || x.status === "PAID").length), label: "Completed", color: SAGE },
      { value: fmt(mine.reduce((n, x) => n + x.reward, 0)), label: "COOK funded", color: ORANGE },
    ];

    const scopeBtn = (scope: "mine" | "all", label: string) => {
      const on = s.dashScope === scope;
      return (
        <button
          onClick={() => patch({ dashScope: scope })}
          className="cb-border-warm"
          style={{
            background: on ? "rgba(246,160,107,0.16)" : "transparent",
            color: on ? ORANGE : "rgba(245,234,216,0.7)",
            border: `1px solid ${on ? "rgba(246,160,107,0.6)" : "rgba(245,234,216,0.16)"}`,
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      );
    };

    return (
      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "44px 22px 90px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ fontSize: 40 }}>My bounties</h1>
          <div style={{ display: "flex", gap: 8 }}>
            {scopeBtn("mine", `Created by me${mine.length ? ` (${mine.length})` : ""}`)}
            {scopeBtn("all", "All bounties")}
          </div>
        </div>
        {s.connected && (
          <p style={{ marginTop: 8, fontSize: 13.5, color: "rgba(245,234,216,0.5)", fontVariantNumeric: "tabular-nums" }}>
            {shortAddress}
          </p>
        )}

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 24 }}>
          {myStats.map((stat) => (
            <div key={stat.label} style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ fontFamily: cap, fontSize: 30, color: stat.color, fontVariantNumeric: "tabular-nums" }}>{stat.value}</div>
              <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.5)", marginTop: 4 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {shown.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 20px", border: "1px dashed rgba(245,234,216,0.16)", borderRadius: 24, marginTop: 26 }}>
            {!s.connected && s.dashScope === "mine" ? (
              <>
                <h3 style={{ fontSize: 22 }}>Connect your wallet</h3>
                <p style={{ marginTop: 8, color: "rgba(245,234,216,0.6)" }}>Connect Nightly to see the bounties you&apos;ve created.</p>
                <button className="cb-primary" onClick={connect} style={{ ...btnPrimary, marginTop: 18, padding: "12px 22px", fontSize: 15 }}>Connect Nightly</button>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 22 }}>No bounties yet</h3>
                <p style={{ marginTop: 8, color: "rgba(245,234,216,0.6)" }}>You haven&apos;t created any bounties yet.</p>
                <button className="cb-primary" onClick={() => go("create")} style={{ ...btnPrimary, marginTop: 18, padding: "12px 22px", fontSize: 15 }}>Create a Bounty</button>
              </>
            )}
          </div>
        ) : (
          <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 22, marginTop: 26, overflow: "hidden" }}>
            {shown.map((x) => {
              const needsReview = x.status === "REVIEWING";
              const status = STATUS[x.status];
              return (
                <div key={x.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "18px 22px", borderBottom: "1px solid rgba(245,234,216,0.08)" }}>
                  <div style={{ flex: 2, minWidth: 180 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, textWrap: "pretty" }}>{x.title}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.5)", marginTop: 3 }}>{x.category} · {subsLabel(x.subs)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 90, fontFamily: cap, fontSize: 20, color: "#f6a06b" }}>{fmt(x.reward)} COOK</div>
                  <div style={{ flex: 1, minWidth: 90, fontSize: 13.5, color: "rgba(245,234,216,0.6)", fontVariantNumeric: "tabular-nums" }}>{endsLabel(x.hours).replace("Ends in ", "")}</div>
                  <div style={{ flex: 1, minWidth: 110 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: status.color }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: status.color }} />
                      {status.label}
                    </span>
                  </div>
                  <button
                    className="cb-border-warm"
                    onClick={() => patch({ screen: needsReview ? "review" : "detail", bountyId: x.id, reviewSubIndex: 0 })}
                    style={{ background: needsReview ? "#c67139" : "transparent", color: needsReview ? "#141110" : "#f5ead8", border: `1px solid ${needsReview ? "#c67139" : "rgba(245,234,216,0.2)"}`, borderRadius: 999, padding: "9px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                  >
                    {needsReview ? "Review" : "Open"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderReview = () => {
    if (!b) return null;
    return (
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "32px 22px 90px" }}>
        <button onClick={() => go("my-bounties")} style={{ background: "none", border: 0, color: "rgba(245,234,216,0.6)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>← My bounties</button>
        <h1 style={{ fontSize: 38, marginTop: 14 }}>Review submissions</h1>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 12 }}>
          <span style={{ fontSize: 16, color: "rgba(245,234,216,0.7)" }}>{b.title}</span>
          <span style={{ fontFamily: cap, fontSize: 18, color: "#f6a06b" }}>{fmt(b.reward)} COOK</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(174,191,146,0.14)", color: "#c8d6ae", borderRadius: 999, padding: "5px 13px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>✓ In escrow</span>
        </div>

        <div style={{ display: "grid", gap: 16, marginTop: 26 }}>
          {b.submissions.map((sub, i) => (
            <div key={i} style={{ background: "#1a1615", border: `1px solid ${sub.status === "Rejected" ? "rgba(245,234,216,0.07)" : "rgba(245,234,216,0.12)"}`, borderRadius: 22, padding: "22px 24px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <span style={{ width: 36, height: 36, borderRadius: 999, background: ["#c67139", "#7a8a5e", "#8c491a"][i % 3] }} />
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{sub.contributor}</div>
                  <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.5)" }}>Submission {sub.num} · {sub.when}</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: sub.status === "Rejected" ? RED : AMBER }}>{sub.status}</span>
              </div>
              <p style={{ marginTop: 14, fontSize: 15, color: "rgba(245,234,216,0.8)" }}>{sub.note}</p>
              <div style={{ marginTop: 12, fontSize: 13, color: "#f6a06b", wordBreak: "break-all" }}>{sub.url}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
                <button className="cb-soft" onClick={() => flash("Opens " + sub.url)} style={{ background: "transparent", border: "1px solid rgba(245,234,216,0.2)", color: "#f5ead8", borderRadius: 999, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Open work</button>
                <div style={{ flex: 1 }} />
                <button className="cb-danger" onClick={() => flash("Submission " + sub.num + " rejected — escrow unchanged")} style={{ background: "transparent", border: "1px solid rgba(212,115,94,0.45)", color: "#e8a08d", borderRadius: 999, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Reject</button>
                <button className="cb-approve" onClick={() => patch({ modal: "approve", reviewSubIndex: i })} style={{ background: "#aebf92", color: "#141110", border: 0, borderRadius: 999, padding: "10px 24px", fontFamily: cap, fontSize: 14.5, cursor: "pointer" }}>Approve &amp; Pay</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderMyWork = () => {
    const workStats = [
      { value: String(myWork.stats.submitted), label: "Submitted", color: "#f5ead8" },
      { value: String(myWork.stats.inReview), label: "In review", color: AMBER },
      { value: String(myWork.stats.completed), label: "Completed", color: SAGE },
      { value: fmt(myWork.stats.earned), label: "COOK earned", color: ORANGE },
    ];
    const statusColor = (status: string) => (status === "Paid" ? ORANGE : status === "Rejected" ? RED : AMBER);
    return (
      <section style={{ maxWidth: 1220, margin: "0 auto", padding: "44px 22px 90px" }}>
        <h1 style={{ fontSize: 40 }}>My work</h1>
        {s.connected && <p style={{ marginTop: 8, fontSize: 13.5, color: "rgba(245,234,216,0.5)", fontVariantNumeric: "tabular-nums" }}>{shortAddress}</p>}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 24 }}>
          {workStats.map((stat) => (
            <div key={stat.label} style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ fontFamily: cap, fontSize: 30, color: stat.color, fontVariantNumeric: "tabular-nums" }}>{stat.value}</div>
              <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.5)", marginTop: 4 }}>{stat.label}</div>
            </div>
          ))}
        </div>
        {myWork.items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 20px", border: "1px dashed rgba(245,234,216,0.16)", borderRadius: 24, marginTop: 26 }}>
            {!s.connected ? (
              <>
                <h3 style={{ fontSize: 22 }}>Connect your wallet</h3>
                <p style={{ marginTop: 8, color: "rgba(245,234,216,0.6)" }}>Connect Nightly to see the work you&apos;ve submitted.</p>
                <button className="cb-primary" onClick={connect} style={{ ...btnPrimary, marginTop: 18, padding: "12px 22px", fontSize: 15 }}>Connect Nightly</button>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 22 }}>No submissions yet</h3>
                <p style={{ marginTop: 8, color: "rgba(245,234,216,0.6)" }}>Find a bounty and start building.</p>
                <button className="cb-primary" onClick={() => go("bounties")} style={{ ...btnPrimary, marginTop: 18, padding: "12px 22px", fontSize: 15 }}>Explore Bounties</button>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", marginTop: 26 }}>
            {myWork.items.map((w, i) => {
              const wc = statusColor(w.status);
              return (
                <div key={i} style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: wc }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: wc }} />
                    {w.status}
                  </span>
                  <div style={{ fontSize: 16, fontWeight: 700, textWrap: "pretty" }}>{w.title}</div>
                  <div style={{ fontFamily: cap, fontSize: 26, color: "#f6a06b" }}>{w.reward}</div>
                  <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.5)" }}>{w.when} · by {w.creator}</div>
                  <button className="cb-outline" onClick={() => patch({ screen: "detail", bountyId: w.bountyId })} style={{ marginTop: 4, background: "transparent", border: "1px solid rgba(245,234,216,0.18)", color: "#f5ead8", borderRadius: 999, padding: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>View</button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderActivity = () => (
    <section style={{ maxWidth: 820, margin: "0 auto", padding: "44px 22px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: "#aebf92", animation: "cbPulse 1.6s ease-in-out infinite" }} />
        <h1 style={{ fontSize: 38 }}>Live on Cookie Chain</h1>
      </div>
      <p style={{ marginTop: 10, color: "rgba(245,234,216,0.65)", fontSize: 16.5 }}>Every funding, submission and payout as the community makes it.</p>
      {activity.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 20px", border: "1px dashed rgba(245,234,216,0.16)", borderRadius: 24, marginTop: 26, color: "rgba(245,234,216,0.6)" }}>
          <h3 style={{ fontSize: 22 }}>No activity yet</h3>
          <p style={{ marginTop: 8 }}>Funding, submissions and payouts will show up here as they happen on Cookie Chain.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 26 }}>
          {activity.map((a, i) => {
            const st2 = activityStyle(a.kind);
            return (
              <div key={i} className="cb-row-warm" style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 20, padding: "18px 20px", display: "flex", gap: 16, alignItems: "flex-start", animation: "cbIn 380ms ease both" }}>
                <span style={{ width: 38, height: 38, borderRadius: 999, background: st2.tint, display: "grid", placeItems: "center", flex: "none" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: st2.color }} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: st2.color }}>{a.kind}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 5, textWrap: "pretty" }}>{a.title}</div>
                  <div style={{ fontSize: 13.5, color: "rgba(245,234,216,0.6)", marginTop: 4 }}>{a.detail}</div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div style={{ fontFamily: cap, fontSize: 17, color: "#f6a06b" }}>{a.amount}</div>
                  <div style={{ fontSize: 12, color: "rgba(245,234,216,0.45)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{a.ago}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderLeaderboard = () => (
    <section style={{ maxWidth: 900, margin: "0 auto", padding: "44px 22px 90px" }}>
      <h1 style={{ fontSize: 40 }}>Cookie builders</h1>
      <p style={{ marginTop: 10, color: "rgba(245,234,216,0.65)", fontSize: 16.5 }}>The people actually building.</p>
      {leaderboard.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 20px", border: "1px dashed rgba(245,234,216,0.16)", borderRadius: 24, marginTop: 26, color: "rgba(245,234,216,0.6)" }}>
          <h3 style={{ fontSize: 22 }}>No completed bounties yet</h3>
          <p style={{ marginTop: 8 }}>The leaderboard fills in as contributors get paid.</p>
        </div>
      ) : (
        <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 22, marginTop: 26, overflow: "hidden" }}>
          {leaderboard.map((l, i) => (
            <div key={l.addressFull} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "16px 22px", borderBottom: "1px solid rgba(245,234,216,0.08)" }}>
              <span style={{ fontFamily: cap, fontSize: 20, color: i < 3 ? ORANGE : "rgba(245,234,216,0.4)", width: 34, fontVariantNumeric: "tabular-nums" }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ width: 34, height: 34, borderRadius: 999, background: LEADER_AVATARS[i % LEADER_AVATARS.length], flex: "none" }} />
              <div style={{ flex: 1, minWidth: 120, fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{l.address}</div>
              <div style={{ fontSize: 13.5, color: "rgba(245,234,216,0.6)", minWidth: 110 }}>{l.completed} completed</div>
              <div style={{ fontFamily: cap, fontSize: 19, color: "#f6a06b", minWidth: 100, textAlign: "right" }}>{fmt(l.earned)} COOK</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const renderDocs = () => (
    <section style={{ maxWidth: 980, margin: "0 auto", padding: "44px 22px 90px" }}>
      <h1 style={{ fontSize: 40 }}>Docs</h1>
      <p style={{ marginTop: 10, color: "rgba(245,234,216,0.65)", fontSize: 16.5 }}>What Cookie Bounties is, and exactly what the chain guarantees.</p>

      <div style={{ background: "#1a1615", border: "1px solid rgba(246,160,107,0.28)", borderRadius: 24, padding: 28, marginTop: 26 }}>
        <h3 style={{ fontSize: 24 }}>How escrow works</h3>
        <div style={{ display: "grid", gap: 12, marginTop: 18, maxWidth: 420 }}>
          {ESCROW_DIAGRAM.map((d) => (
            <div key={d.title} style={{ border: `1px solid ${d.border}`, background: d.bg, borderRadius: 18, padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{d.title}</div>
                <div style={{ fontSize: 12.5, color: "rgba(245,234,216,0.55)" }}>{d.sub}</div>
              </div>
              <div style={{ fontFamily: cap, fontSize: 17, color: d.color }}>{d.amount}</div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 16, fontSize: 14, color: "rgba(245,234,216,0.6)" }}>Funds are held by the Cookie Bounties program until the bounty is resolved.</p>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", marginTop: 20 }}>
        {DOC_SECTIONS.map((d) => (
          <div key={d.title} style={cardSurface}>
            <h4 style={{ fontSize: 19 }}>{d.title}</h4>
            <p style={{ marginTop: 8, fontSize: 14.5, color: "rgba(245,234,216,0.68)" }}>{d.body}</p>
          </div>
        ))}
      </div>

      <div style={{ background: "#1a1615", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 22, padding: 24, marginTop: 20 }}>
        <h4 style={{ fontSize: 19 }}>Bounty lifecycle</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 14 }}>
          {LIFECYCLE.map((l, i) => (
            <span key={l} style={{ border: `1px solid ${i === 5 ? "rgba(246,160,107,0.5)" : "rgba(245,234,216,0.16)"}`, color: i < 6 ? (i === 5 ? ORANGE : "#f5ead8") : "rgba(245,234,216,0.55)", background: i === 5 ? "rgba(246,160,107,0.1)" : "transparent", borderRadius: 999, padding: "7px 15px", fontSize: 12, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }}>{l}</span>
          ))}
        </div>
        <p style={{ marginTop: 14, fontSize: 14, color: "rgba(245,234,216,0.6)" }}>The program rejects any transition outside this machine — no double payment, no unauthorized approval, no refund after payout.</p>
      </div>
    </section>
  );

  const renderMobileTabs = () => (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 45, background: "rgba(20,17,16,0.94)", backdropFilter: "blur(14px)", borderTop: "1px solid rgba(245,234,216,0.12)", display: "flex", alignItems: "center", padding: "8px 8px calc(8px + env(safe-area-inset-bottom))" }}>
      {MOBILE_DEFS.map(([label, key]) => (
        <button key={key} onClick={() => go(key)} style={{ flex: 1, background: "none", border: 0, padding: "8px 2px", cursor: "pointer", color: s.screen === key ? ORANGE : "rgba(245,234,216,0.55)", fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", display: "grid", gap: 5, justifyItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: s.screen === key ? ORANGE : "rgba(245,234,216,0.3)" }} />
          {label}
        </button>
      ))}
      <button className="cb-primary" onClick={() => go("create")} style={{ ...btnPrimary, flex: "none", marginLeft: 6, width: 46, height: 46, borderRadius: 999, fontSize: 24, lineHeight: 1 }}>+</button>
    </div>
  );

  const renderScreen = () => {
    switch (s.screen) {
      case "home":
        return renderHome();
      case "bounties":
        return renderBounties();
      case "detail":
        return renderDetail();
      case "create":
        return renderCreate();
      case "my-bounties":
        return renderMyBounties();
      case "review":
        return renderReview();
      case "my-work":
        return renderMyWork();
      case "activity":
        return renderActivity();
      case "leaderboard":
        return renderLeaderboard();
      case "docs":
        return renderDocs();
      default:
        return null;
    }
  };

  // ── Modals ──
  const modalWidth = s.modal === "wallet" || s.modal === "submit" ? 480 : 440;
  const fundRows = [
    { label: "Into", value: "Cookie Bounties escrow", color: "#f5ead8" },
    { label: "Your wallet", value: fmt(s.balance) + " COOK", color: "#f5ead8" },
    { label: "After funding", value: fmt(Math.max(0, s.balance - amt)) + " COOK", color: "#f5ead8" },
    { label: "Network fee", value: "estimated at signing", color: "rgba(245,234,216,0.6)" },
  ];
  const payoutTrail = [
    { label: "From", value: "Bounty escrow", color: "#f5ead8", border: "rgba(245,234,216,0.12)" },
    { label: "Paid to", value: payTarget, color: SAGE, border: "rgba(174,191,146,0.35)" },
    { label: "Status", value: "PAID", color: ORANGE, border: "rgba(246,160,107,0.35)" },
  ];

  const renderModal = () => {
    if (!s.modal) return null;
    const dialog: CSSProperties = {
      width: "100%",
      maxWidth: modalWidth,
      background: "#1a1615",
      border: "1px solid rgba(245,234,216,0.14)",
      borderRadius: 26,
      padding: 28,
      animation: "cbPop 220ms ease both",
      maxHeight: "92vh",
      overflow: "auto",
    };
    const overlayStyle: CSSProperties = {
      position: "fixed",
      inset: 0,
      zIndex: 60,
      background: "rgba(10,8,8,0.72)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      overflow: "auto",
    };

    // Connecting is independent of any selected bounty — show it while Nightly opens.
    if (s.modal === "connecting") {
      return (
        <div onClick={closeModal} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...dialog, maxWidth: 420 }}>
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 56, height: 56, margin: "0 auto", borderRadius: 999, border: "3px solid rgba(245,234,216,0.15)", borderTopColor: "#f6a06b", animation: "cbSpin 0.8s linear infinite" }} />
              <h3 style={{ fontSize: 24, marginTop: 18 }}>Connecting…</h3>
              <p style={{ marginTop: 10, color: "rgba(245,234,216,0.7)", fontSize: 15 }}>Approve the connection in your Nightly wallet to continue.</p>
              <button onClick={closeModal} style={{ marginTop: 18, background: "none", border: 0, color: "rgba(245,234,216,0.55)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 8 }}>Cancel</button>
            </div>
          </div>
        </div>
      );
    }

    if (!b) return null;
    return (
      <div onClick={closeModal} style={overlayStyle}>
        <div onClick={(e) => e.stopPropagation()} style={dialog}>
          {s.modal === "fund" && (
            <div>
              <h3 style={{ fontSize: 26 }}>Fund bounty</h3>
              <p style={{ marginTop: 8, fontSize: 14.5, color: "rgba(245,234,216,0.62)" }}>You are depositing into the Cookie Bounties escrow — a program-derived account. No backend wallet ever holds your COOK.</p>
              <div style={{ textAlign: "center", background: "#141110", border: "1px solid rgba(246,160,107,0.35)", borderRadius: 22, padding: 24, marginTop: 20 }}>
                <div style={kicker}>Depositing</div>
                <div style={{ fontFamily: cap, fontSize: 46, color: "#f6a06b", marginTop: 6 }}>{fmt(amt)} COOK</div>
              </div>
              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                {fundRows.map((r) => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14.5 }}>
                    <span style={{ color: "rgba(245,234,216,0.6)" }}>{r.label}</span>
                    <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.color }}>{r.value}</span>
                  </div>
                ))}
              </div>
              <button className="cb-primary" onClick={confirmFund} style={{ ...btnPrimary, width: "100%", marginTop: 22, padding: 15, fontSize: 16 }}>Confirm in Nightly</button>
              <button onClick={closeModal} style={{ width: "100%", marginTop: 10, background: "none", border: 0, color: "rgba(245,234,216,0.55)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 8 }}>Cancel</button>
            </div>
          )}

          {s.modal === "approve" && (
            <div>
              <h3 style={{ fontSize: 26 }}>Release reward?</h3>
              <p style={{ marginTop: 8, fontSize: 14.5, color: "rgba(245,234,216,0.62)" }}>You are releasing escrow. This action completes the bounty and cannot be reversed.</p>
              <div style={{ textAlign: "center", background: "#141110", border: "1px solid rgba(174,191,146,0.4)", borderRadius: 22, padding: 24, marginTop: 20 }}>
                <div style={{ fontFamily: cap, fontSize: 46, color: "#f6a06b" }}>{fmt(b.reward)} COOK</div>
                <div style={{ fontSize: 13.5, color: "rgba(245,234,216,0.55)", marginTop: 8 }}>to</div>
                <div style={{ fontFamily: cap, fontSize: 22, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{payTarget}</div>
              </div>
              <button className="cb-approve" onClick={confirmApprove} style={{ width: "100%", marginTop: 22, background: "#aebf92", color: "#141110", border: 0, borderRadius: 999, padding: 15, fontFamily: cap, fontSize: 16, cursor: "pointer" }}>Approve &amp; Pay</button>
              <button onClick={closeModal} style={{ width: "100%", marginTop: 10, background: "none", border: 0, color: "rgba(245,234,216,0.55)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 8 }}>Cancel</button>
            </div>
          )}

          {s.modal === "tx" && (
            <div>
              <h3 style={{ fontSize: 24 }}>{txTitle}</h3>
              <div style={{ display: "grid", gap: 2, marginTop: 22 }}>
                {txSteps.map((step, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 999, border: `2px solid ${step.ring}`, background: step.fill, display: "grid", placeItems: "center", flex: "none", color: "#141110", fontSize: 12, fontWeight: 800 }}>{step.mark}</span>
                    <span style={{ fontSize: 15, fontWeight: step.weight, color: step.color }}>{step.label}</span>
                  </div>
                ))}
              </div>
              {txDone && (
                <>
                  <div style={{ marginTop: 18, background: "#141110", border: "1px solid rgba(174,191,146,0.4)", borderRadius: 20, padding: 20, textAlign: "center" }}>
                    <div style={{ fontFamily: cap, fontSize: 24, color: "#aebf92" }}>{txResultTitle}</div>
                    <div style={{ fontSize: 14, color: "rgba(245,234,216,0.65)", marginTop: 6 }}>{txResultDetail}</div>
                    <button className="cb-outline" onClick={viewOnScan} style={{ marginTop: 14, background: "transparent", border: "1px solid rgba(245,234,216,0.2)", color: "#f5ead8", borderRadius: 999, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>View on CookieScan</button>
                  </div>
                  <button className="cb-primary" onClick={txContinue} style={{ ...btnPrimary, width: "100%", marginTop: 14, padding: 14, fontSize: 15.5 }}>{txContinueLabel}</button>
                </>
              )}
            </div>
          )}

          {s.modal === "success" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 62, height: 62, borderRadius: 999, background: "rgba(174,191,146,0.18)", color: "#aebf92", display: "grid", placeItems: "center", margin: "0 auto", fontSize: 28, animation: "cbGlow 1.8s ease-out infinite" }}>✓</div>
              <h3 style={{ fontSize: 30, marginTop: 16 }}>Bounty live</h3>
              <p style={{ marginTop: 10, color: "rgba(245,234,216,0.7)", fontSize: 15.5 }}>Your {fmt(amt)} COOK reward is secured in escrow and your bounty is visible to the Cookie Chain community.</p>
              <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
                <button className="cb-primary" onClick={() => patch({ screen: "detail", bountyId: "mem-01", modal: null })} style={{ ...btnPrimary, flex: 1, minWidth: 130, padding: 13, fontSize: 15 }}>View Bounty</button>
                <button className="cb-outline" onClick={() => patch({ modal: "share" })} style={{ flex: 1, minWidth: 130, background: "transparent", border: "1px solid rgba(245,234,216,0.2)", color: "#f5ead8", borderRadius: 999, padding: 13, fontFamily: cap, fontSize: 15, cursor: "pointer" }}>Share Bounty</button>
              </div>
            </div>
          )}

          {s.modal === "submit" && (
            <div>
              <h3 style={{ fontSize: 26 }}>Submit your work</h3>
              <p style={{ marginTop: 8, fontSize: 14.5, color: "rgba(245,234,216,0.62)" }}>{b.title} · {fmt(b.reward)} COOK</p>
              <div style={{ marginTop: 20 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(245,234,216,0.5)", marginBottom: 8 }}>Work URL</label>
                <input className="cb-input" value={s.submission.url} onChange={(e) => patch({ submission: { ...s.submission, url: e.target.value } })} placeholder="https://..." style={{ width: "100%", background: "#141110", border: "1px solid rgba(245,234,216,0.16)", color: "#f5ead8", borderRadius: 999, padding: "13px 18px", fontSize: 15, fontFamily: "'Figtree',sans-serif" }} />
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(245,234,216,0.5)", marginBottom: 8 }}>Tell the creator about your submission</label>
                <textarea className="cb-input" rows={4} value={s.submission.note} onChange={(e) => patch({ submission: { ...s.submission, note: e.target.value } })} placeholder="I created three variations..." style={{ width: "100%", background: "#141110", border: "1px solid rgba(245,234,216,0.16)", color: "#f5ead8", borderRadius: 20, padding: "13px 18px", fontSize: 15, fontFamily: "'Figtree',sans-serif", resize: "vertical" }} />
              </div>
              <div style={{ marginTop: 14, fontSize: 13, color: "rgba(245,234,216,0.5)" }}>Files live off-chain — only the reference and your wallet are recorded on Cookie Chain.</div>
              <button className="cb-primary" onClick={confirmSubmit} style={{ ...btnPrimary, width: "100%", marginTop: 20, padding: 15, fontSize: 16 }}>Submit Work</button>
            </div>
          )}

          {s.modal === "submitted" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 62, height: 62, borderRadius: 999, background: "rgba(174,191,146,0.18)", color: "#aebf92", display: "grid", placeItems: "center", margin: "0 auto", fontSize: 28 }}>✓</div>
              <h3 style={{ fontSize: 28, marginTop: 16 }}>Submission received</h3>
              <p style={{ marginTop: 10, color: "rgba(245,234,216,0.7)", fontSize: 15.5 }}>Your work has been submitted to {b.title}.</p>
              <div style={{ display: "flex", justifyContent: "center", gap: 26, marginTop: 20 }}>
                <div>
                  <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Reward</div>
                  <div style={{ fontFamily: cap, fontSize: 22, color: "#f6a06b", marginTop: 4 }}>{fmt(b.reward)} COOK</div>
                </div>
                <div>
                  <div style={{ fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)" }}>Status</div>
                  <div style={{ fontFamily: cap, fontSize: 22, color: "#e2b04a", marginTop: 4 }}>Awaiting review</div>
                </div>
              </div>
              <button className="cb-primary" onClick={() => go("my-work")} style={{ ...btnPrimary, width: "100%", marginTop: 22, padding: 14, fontSize: 15.5 }}>Go to My Work</button>
            </div>
          )}

          {s.modal === "completed" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 800, color: "#aebf92" }}>Bounty completed</div>
              <div style={{ fontFamily: cap, fontSize: 56, color: "#f6a06b", marginTop: 10, animation: "cbPop 420ms ease both" }}>{fmt(b.reward)} COOK</div>
              <div style={{ display: "grid", gap: 8, marginTop: 18, justifyItems: "center" }}>
                {payoutTrail.map((p) => (
                  <div key={p.label} style={{ width: "100%", background: "#141110", border: `1px solid ${p.border}`, borderRadius: 16, padding: "12px 16px", display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "rgba(245,234,216,0.6)" }}>{p.label}</span>
                    <span style={{ fontWeight: 700, color: p.color, fontVariantNumeric: "tabular-nums" }}>{p.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
                <button className="cb-primary" onClick={() => go("activity")} style={{ ...btnPrimary, flex: 1, minWidth: 130, padding: 13, fontSize: 15 }}>View Activity</button>
                <button className="cb-outline" onClick={() => patch({ screen: "create", step: 1, modal: null })} style={{ flex: 1, minWidth: 130, background: "transparent", border: "1px solid rgba(245,234,216,0.2)", color: "#f5ead8", borderRadius: 999, padding: 13, fontFamily: cap, fontSize: 15, cursor: "pointer" }}>Create Another</button>
              </div>
            </div>
          )}

          {s.modal === "wallet" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 46, height: 46, borderRadius: 999, background: "#c67139" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: cap, fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{shortAddress}</div>
                  <div style={{ fontSize: 12, color: "rgba(245,234,216,0.45)", wordBreak: "break-all", fontVariantNumeric: "tabular-nums" }}>{s.address}</div>
                </div>
                <button className="cb-outline" onClick={copyAddress} style={{ background: "transparent", border: "1px solid rgba(245,234,216,0.18)", color: "#f5ead8", borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flex: "none" }}>{s.copied ? "Copied" : "Copy"}</button>
              </div>
              <div style={{ background: "#141110", border: "1px solid rgba(246,160,107,0.3)", borderRadius: 20, padding: 20, marginTop: 18, textAlign: "center" }}>
                <div style={kicker}>COOK balance</div>
                <div style={{ fontFamily: cap, fontSize: 38, color: "#f6a06b", marginTop: 4 }}>{balanceLabel}</div>
                <button className="cb-outline" onClick={openGetCook} style={{ marginTop: 12, background: "transparent", border: "1px solid rgba(245,234,216,0.2)", color: "#f5ead8", borderRadius: 999, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Get COOK — Hyperlane bridge</button>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", marginTop: 16 }}>
                {[
                  { value: String(walletSummary.completed), label: "Completed", color: "#f5ead8" },
                  { value: `${fmt(walletSummary.earned)} COOK`, label: "Earned", color: SAGE },
                  { value: `${fmt(walletSummary.funded)} COOK`, label: "Funded", color: ORANGE },
                ].map((stat) => (
                  <div key={stat.label} style={{ background: "#141110", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 16, padding: 14 }}>
                    <div style={{ fontFamily: cap, fontSize: 20, color: stat.color }}>{stat.value}</div>
                    <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 800, color: "rgba(245,234,216,0.45)", marginTop: 3 }}>{stat.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, fontSize: 13, color: "rgba(245,234,216,0.55)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: s.wrongNetwork ? AMBER : SAGE }} />
                {s.wrongNetwork ? "Wrong network — switch to Cookie Chain" : "Connected to Cookie Chain"}
              </div>
              <button className="cb-danger" onClick={disconnect} style={{ width: "100%", marginTop: 16, background: "transparent", border: "1px solid rgba(212,115,94,0.4)", color: "#e8a08d", borderRadius: 999, padding: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Disconnect</button>
            </div>
          )}

          {s.modal === "network" && (
            <div>
              {s.networkMode === "missing" ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(246,160,107,0.16)", display: "grid", placeItems: "center", flex: "none", fontSize: 20 }}>🌙</span>
                    <h3 style={{ fontSize: 24 }}>Connect Nightly</h3>
                  </div>
                  <p style={{ marginTop: 12, fontSize: 15, color: "rgba(245,234,216,0.72)" }}>
                    Cookie Bounties runs on Cookie Chain and connects through the Nightly wallet. Install Nightly, then come back and connect to create, fund and complete bounties.
                  </p>
                  <a href={NIGHTLY_URL} target="_blank" rel="noopener noreferrer" style={{ display: "block", background: "#141110", border: "1px solid rgba(245,234,216,0.12)", borderRadius: 16, padding: "14px 16px", marginTop: 16, fontSize: 13, color: "rgba(245,234,216,0.72)", textDecoration: "none" }}>
                    nightly.app — get the wallet for Cookie Chain →
                  </a>
                  <button className="cb-primary" onClick={installNightly} style={{ ...btnPrimary, width: "100%", marginTop: 18, padding: 14, fontSize: 15.5 }}>Install Nightly</button>
                </>
              ) : (
                <>
                  <h3 style={{ fontSize: 24, color: "#e2b04a" }}>Wrong network</h3>
                  <p style={{ marginTop: 10, fontSize: 15, color: "rgba(245,234,216,0.72)" }}>
                    Cookie Bounties runs on Cookie Chain. Switch your wallet to Cookie Chain to continue — if Nightly doesn&apos;t switch automatically, add the network below and select it.
                  </p>
                  <div style={{ background: "#141110", border: "1px solid rgba(245,234,216,0.12)", borderRadius: 16, padding: "14px 16px", marginTop: 16, fontSize: 13, color: "rgba(245,234,216,0.6)", wordBreak: "break-all" }}>RPC · https://rpc.cookiescan.io</div>
                  <button className="cb-primary" onClick={() => { patch({ wrongNetwork: false, modal: null }); flash("Switched to Cookie Chain"); }} style={{ ...btnPrimary, width: "100%", marginTop: 18, padding: 14, fontSize: 15.5 }}>Switch network</button>
                </>
              )}
              <button onClick={closeModal} style={{ width: "100%", marginTop: 10, background: "none", border: 0, color: "rgba(245,234,216,0.55)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 8 }}>Not now</button>
            </div>
          )}

          {s.modal === "share" && (
            <div>
              <h3 style={{ fontSize: 24 }}>Share bounty</h3>
              <div style={{ background: "#141110", border: "1px solid rgba(245,234,216,0.14)", borderRadius: 16, padding: "14px 16px", marginTop: 16, fontSize: 13.5, color: "#f6a06b", wordBreak: "break-all" }}>cookiebounties.xyz/bounties/{b.id}</div>
              <p style={{ marginTop: 14, fontSize: 14.5, color: "rgba(245,234,216,0.7)", background: "#141110", border: "1px solid rgba(245,234,216,0.1)", borderRadius: 16, padding: "14px 16px" }}>
                Just posted a {fmt(b.reward)} COOK bounty on Cookie Chain. Looking for someone to {b.title.toLowerCase()}. Complete the task → get paid on-chain.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                {shareTargets.map((t) => (
                  <button key={t.label} className="cb-outline" onClick={t.act} style={{ flex: 1, minWidth: 70, background: "transparent", border: "1px solid rgba(245,234,216,0.16)", color: "#f5ead8", borderRadius: 999, padding: 11, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#141110", color: "#f5ead8", fontFamily: "'Figtree',system-ui,sans-serif", fontSize: 15, lineHeight: 1.55, paddingBottom: narrow ? 88 : 0 }}>
      {renderTopBar()}
      {renderScreen()}
      {narrow && renderMobileTabs()}
      {renderModal()}
      {s.toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", zIndex: 70, background: "#241c18", border: "1px solid rgba(246,160,107,0.4)", color: "#f5ead8", borderRadius: 999, padding: "12px 22px", fontSize: 14, fontWeight: 600, animation: "cbPop 200ms ease both", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>{s.toast}</div>
      )}
    </div>
  );
}
