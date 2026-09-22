import type { CSSProperties } from "react";

/** The presentational view of a bounty as it appears on the home and explore grids. */
export interface BountyCardView {
  id: string;
  category: string;
  title: string;
  /** Pre-formatted, e.g. "2 COOK". */
  reward: string;
  /** Pre-formatted, e.g. "Ends in 1d 14h". */
  ends: string;
  /** Pre-formatted, e.g. "12 submissions". */
  subs: string;
  creator: string;
  /** Status label, e.g. "Active". */
  status: string;
  statusColor: string;
  onOpen: () => void;
}

const cap = "'Caprasimo',serif";

/** A single bounty card. Lifts and warms its border on hover (see `.cb-lift`). */
export function BountyCard({ view }: { view: BountyCardView }) {
  const card: CSSProperties = {
    background: "#1a1615",
    border: "1px solid rgba(245,234,216,0.1)",
    borderRadius: 20,
    padding: 20,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };
  return (
    <div className="cb-lift" onClick={view.onOpen} style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span
          style={{
            background: "rgba(245,234,216,0.08)",
            borderRadius: 999,
            padding: "4px 11px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(245,234,216,0.72)",
          }}
        >
          {view.category}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: view.statusColor,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: view.statusColor }} />
          {view.status}
        </span>
      </div>
      <h4 style={{ fontSize: 19, textWrap: "pretty" }}>{view.title}</h4>
      <div style={{ fontFamily: cap, fontSize: 32, color: "#f6a06b", lineHeight: 1 }}>{view.reward}</div>
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 12.5,
          color: "rgba(245,234,216,0.55)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{view.ends}</span>
        <span>{view.subs}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingTop: 12,
          borderTop: "1px solid rgba(245,234,216,0.09)",
        }}
      >
        <span style={{ fontSize: 12.5, color: "rgba(245,234,216,0.5)" }}>by {view.creator}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f6a06b" }}>View bounty →</span>
      </div>
    </div>
  );
}
