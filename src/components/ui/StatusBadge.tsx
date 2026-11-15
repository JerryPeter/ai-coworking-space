// Status badge (spec 5.3): color + icon + text, never color alone.
import {
  CircleCheck, CircleQuestionMark, CircleX, Eye, Loader, Moon, PlugZap, PowerOff, Square,
} from "lucide-react";
import type { ComponentType } from "react";

export type BadgeStatus =
  | "working" | "idle" | "reviewing" | "offline" | "unknown"
  | "online" | "connected" | "running" | "not_running" | "success" | "failed" | "scheduled";

interface Def { token: string; label: string; Icon?: ComponentType<{ size?: number; className?: string }>; dot?: "pulse" | "plain"; spin?: boolean; tip?: string }

const DEFS: Record<BadgeStatus, Def> = {
  working:     { token: "status-working",   label: "Working",   dot: "pulse" },
  idle:        { token: "status-idle",      label: "Idle",      Icon: Moon },
  reviewing:   { token: "status-reviewing", label: "Reviewing", Icon: Eye },
  offline:     { token: "status-offline",   label: "Offline",   Icon: PowerOff },
  unknown:     { token: "status-unknown",   label: "Unknown",   Icon: CircleQuestionMark,
                 tip: "No heartbeat or session data to determine state" },
  online:      { token: "status-online",    label: "Online",    Icon: PlugZap },
  connected:   { token: "status-online",    label: "Connected", Icon: PlugZap },
  running:     { token: "outcome-running",  label: "Running",   Icon: Loader, spin: true },
  not_running: { token: "status-unknown",   label: "Not running", Icon: Square },
  success:     { token: "outcome-success",  label: "Success",   Icon: CircleCheck },
  failed:      { token: "outcome-failed",   label: "Failed",    Icon: CircleX },
  scheduled:   { token: "outcome-scheduled", label: "Scheduled", dot: "plain" },
};

export function statusColor(s: BadgeStatus): string {
  return `var(--${DEFS[s].token})`;
}

export function StatusBadge({
  status, label, compact = false, title,
}: { status: BadgeStatus; label?: string; compact?: boolean; title?: string }) {
  const d = DEFS[status];
  const text = label ?? d.label;
  const solid = `var(--${d.token})`;
  const bg = status === "scheduled" ? "transparent" : `var(--${d.token}-subtle)`;
  const tip = title ?? d.tip ?? text;
  const lead = d.dot ? (
    <span className={`badge-dot${d.dot === "pulse" ? " pulse" : ""}`} aria-hidden="true" />
  ) : d.Icon ? (
    <d.Icon size={12} className={d.spin ? "spin-1s" : undefined} />
  ) : null;

  if (compact) {
    return (
      <span className="badge compact" style={{ color: solid }} title={tip}>
        {d.dot ? lead : <span className="badge-dot" aria-hidden="true" />}
        <span className="sr-only">{text}</span>
      </span>
    );
  }
  return (
    <span className="badge" style={{ color: solid, background: bg }} title={tip}>
      {lead}
      {text}
    </span>
  );
}

/** Compact text variant used in the team strip: icon/dot + label, no pill background. */
export function StatusText({ status, label, title }: { status: BadgeStatus; label?: string; title?: string }) {
  const d = DEFS[status];
  return (
    <span className="badge compact" style={{ color: `var(--${d.token})` }} title={title ?? d.tip ?? label ?? d.label}>
      {d.dot ? <span className={`badge-dot${d.dot === "pulse" ? " pulse" : ""}`} /> : d.Icon ? <d.Icon size={12} className={d.spin ? "spin-1s" : undefined} /> : null}
      {label ?? d.label}
    </span>
  );
}
