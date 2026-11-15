// Time formatting per spec conventions: local time, 24h. Relative for < 24h, absolute otherwise.
import { useEffect, useState } from "react";

export type TimeInput = string | number | Date | null | undefined;

/** Accepts ISO strings, epoch seconds or epoch ms. */
export function toDate(v: TimeInput): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const abs = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export function absolute(v: TimeInput): string {
  const d = toDate(v);
  return d ? abs.format(d).replace(/,(?= \d\d:)/, ",") : "Not Available";
}
export function clock(v: TimeInput): string {
  const d = toDate(v);
  return d ? hm.format(d) : "—";
}

export function relative(v: TimeInput, now = Date.now()): string {
  const d = toDate(v);
  if (!d) return "Not Available";
  const diff = now - d.getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  if (s >= 86400) return absolute(d);
  let txt: string;
  if (s < 45) txt = `${Math.max(1, Math.round(s))}s`;
  else if (s < 3600) txt = `${Math.round(s / 60)}m`;
  else {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    txt = m && h < 6 ? `${h}h ${m}m` : `${h}h`;
  }
  return future ? `in ${txt}` : `${txt} ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 10_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
