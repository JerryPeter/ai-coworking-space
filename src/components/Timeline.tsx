// Timeline item (spec 5.6).
import { MessageSquare, Server, SquareCheck, Timer } from "lucide-react";
import type { ActivityEvent, EventType } from "../lib/events";
import { setParams } from "../lib/router";
import { color, identity } from "../theme/agents";
import { RelTime } from "./ui/States";
import { StatusBadge } from "./ui/StatusBadge";

const TAGS: Record<EventType, { label: string; Icon: typeof Timer }> = {
  session: { label: "Session", Icon: MessageSquare },
  cron: { label: "Cron", Icon: Timer },
  task: { label: "Task", Icon: SquareCheck },
  system: { label: "System", Icon: Server },
};

export function TimelineItem({ ev, now, fresh }: { ev: ActivityEvent; now: number; fresh?: boolean }) {
  const id = identity(ev.profile);
  const isSystem = ev.type === "system";
  const Tag = TAGS[ev.type];
  const clickable = !!ev.open;
  const open = () => {
    if (!ev.open) return;
    setParams({ agent: ev.open.agent ?? null, tab: ev.open.tab ?? null, job: ev.open.job ?? null });
  };
  const content = (
    <>
      <span
        className={`tl-dot${id.kind === "tool" ? " square" : ""}${isSystem ? " hollow" : ""}`}
        style={isSystem ? undefined : { background: color(ev.profile) }}
      />
      <div style={{ minWidth: 0 }}>
        <div className="tl-line1">
          <span className="tl-who" style={{ color: isSystem ? "var(--text-secondary)" : color(ev.profile) }}>{isSystem ? "System" : id.shortName}</span>
          <span className="tl-tag"><Tag.Icon size={12} />{Tag.label}</span>
          <span className="tl-time"><RelTime t={ev.time} now={now} /></span>
        </div>
        <div className="tl-desc clamp-2" title={ev.description}>{ev.description}</div>
        {(ev.outcome === "failed" || ev.outcome === "running" || ev.meta) && (
          <div className="tl-meta">
            {ev.outcome === "failed" && <StatusBadge status="failed" />}
            {ev.outcome === "running" && <StatusBadge status="running" />}
            {ev.meta && <span className="truncate">{ev.meta}</span>}
          </div>
        )}
      </div>
    </>
  );
  return clickable ? (
    <button type="button" className={`tl-item clickable${fresh ? " tl-new" : ""}`} onClick={open}>{content}</button>
  ) : (
    <div className={`tl-item${fresh ? " tl-new" : ""}`}>{content}</div>
  );
}
