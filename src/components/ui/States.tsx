// Loading / error / empty building blocks (spec 6 intro, 8, 9).
import { Check, Copy, TriangleExclamationPoint } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ApiError } from "../../api/client";
import { absolute, relative, type TimeInput } from "../../lib/time";

export function Skeleton({ w, h, r, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ display: "block", width: w ?? "100%", height: h ?? 14, borderRadius: r, ...style }} />;
}

export function ErrorPanel({ what, error, onRetry }: { what: string; error: ApiError | Error | null; onRetry?: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <TriangleExclamationPoint size={18} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="semibold">Couldn't load {what}</div>
        <pre>{error?.message ?? "Unknown error"}</pre>
        {onRetry && <button className="btn btn-secondary" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon, title, body, cli, foot, circle = false, children,
}: { icon?: ReactNode; title: string; body?: ReactNode; cli?: string; foot?: ReactNode; circle?: boolean; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className={`empty-icon${circle ? " circle" : ""}`}>{icon}</div>}
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {cli && <CliHint cmd={cli} />}
      {children}
      {foot && <div className="empty-foot">{foot}</div>}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn sm"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard API unavailable (non-secure context): fall back to a hidden textarea.
          const ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } finally { ta.remove(); }
        }
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function CliHint({ cmd }: { cmd: string }) {
  return (
    <div className="cli-hint">
      <span style={{ flex: 1 }}>{cmd}</span>
      <CopyButton text={cmd} />
    </div>
  );
}

/** Relative time with the absolute timestamp in a tooltip. */
export function RelTime({ t, now, fallback = "Not Available" }: { t: TimeInput; now?: number; fallback?: string }) {
  if (t == null || t === "") return <span className="muted">{fallback}</span>;
  const rel = relative(t, now);
  return <time className="tabular" title={absolute(t)}>{rel}</time>;
}

export const NA = () => <span className="muted">Not Available</span>;

/** Renders inline `code` spans inside plain text. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2
          ? <code key={i} className="inline-code">{p.slice(1, -1)}</code>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}
