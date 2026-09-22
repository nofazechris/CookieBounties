"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * A live, ticking countdown to a unix-second deadline. Self-contained (its own 1s interval) so it
 * doesn't re-render the whole app. Shows "Expired" once the deadline passes.
 */
export function Countdown({ deadlineTs, style }: { deadlineTs: number; style?: CSSProperties }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const rem = deadlineTs - now;
  if (rem <= 0) return <span style={style}>Expired</span>;

  const d = Math.floor(rem / 86400);
  const h = Math.floor((rem % 86400) / 3600);
  const m = Math.floor((rem % 3600) / 60);
  const s = rem % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s` : h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;

  return <span style={style}>{text}</span>;
}
