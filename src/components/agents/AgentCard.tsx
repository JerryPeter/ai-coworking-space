// Agent card (spec 5.2), Claude tool card variant, and the compact team-strip card (6.1).
import { ChevronRight, Clock, Moon } from "lucide-react";
import { endpoints, useApi } from "../../api/client";
import type { OpenClawAgent, Tool } from "../../api/types";
import { officeBadge, toolBadge } from "../../lib/derive";
import { navigate, setParams, useRoute } from "../../lib/router";
import type { TeamMember } from "../../lib/team";
import { CLAUDE, CLAUDE_ID } from "../../theme/agents";
import { PixelAvatar } from "../ui/PixelAvatar";
import { RelTime } from "../ui/States";
import { StatusBadge, StatusText, type BadgeStatus } from "../ui/StatusBadge";

const openAgent = (id: string) => setParams({ agent: id, tab: null });

function activate(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
}

function Stat({ v, l, title }: { v: number | string | null | undefined; l: string; title?: string }) {
  const na = v == null;
  return (
    <div className="agent-stat" title={title}>
      <div className={`v${na ? " na" : ""}`}>{na ? "Not Available" : v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export function AgentCard({ m, now }: { m: TeamMember; now: number }) {
  const { params } = useRoute();
  const skills = useApi(endpoints.skills(m.id), 300_000);
  const state = m.office?.state;
  const hasSessions = (m.sessionTotal ?? 0) > 0;
  const selected = params.get("agent") === m.id;
  return (
    <div role="button" tabIndex={0} className={`agent-card${selected ? " selected" : ""}`}
      style={{ ["--agent-c" as string]: `var(${m.ident.cssVar})` }}
      onClick={() => openAgent(m.id)} onKeyDown={(e) => activate(e, () => openAgent(m.id))}
      aria-label={`${m.ident.displayName}, ${state ?? "unknown"}. Open details`}>
      <div className="agent-head">
        <PixelAvatar id={m.id} size={56} offline={state === "offline"} />
        <div className="agent-namebox">
          <div className="agent-name truncate" title={m.ident.displayName}>{m.ident.displayName}</div>
          <div className="sm secondary">{m.ident.role}</div>
          <div className="mono-12 muted">{m.id}</div>
        </div>
        <StatusBadge status={officeBadge(state)} title={m.office?.state_reason} />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {m.model ? <span className="meta-chip" title="Model of this agent's most recent session">{m.model}</span> : <span className="meta-chip muted">model: Not Available</span>}
        <span className="xs muted">{m.model ? "latest session" : "no sessions"}</span>
      </div>
      <div className="agent-stats">
        <Stat v={m.sessionTotal} l="Sessions" />
        <Stat v={m.today ? `${m.today.n}${m.today.exact ? "" : "+"}` : null} l="Today" />
        <Stat v={skills.data?.count ?? (skills.loading ? "…" : null)} l="Skills" />
      </div>
      <div className="agent-foot">
        {hasSessions || m.lastActive ? (
          <><Clock size={14} /> <span>Last active <RelTime t={m.lastActive} now={now} /></span></>
        ) : (
          <><Moon size={14} /> <span className="muted">No sessions yet</span></>
        )}
        <ChevronRight size={16} className="chev" />
      </div>
    </div>
  );
}

export function ToolCard({ tool, loading, now }: { tool: Tool | undefined; loading: boolean; now: number }) {
  const { params } = useRoute();
  const selected = params.get("agent") === CLAUDE_ID;
  void now;
  return (
    <div role="button" tabIndex={0} className={`agent-card${selected ? " selected" : ""}`}
      style={{ ["--agent-c" as string]: `var(${CLAUDE.cssVar})` }}
      onClick={() => openAgent(CLAUDE_ID)} onKeyDown={(e) => activate(e, () => openAgent(CLAUDE_ID))}
      aria-label="Claude Code CLI tool. Open details">
      <div className="agent-head">
        <PixelAvatar id={CLAUDE_ID} size={56} offline={tool?.state === "idle"} />
        <div className="agent-namebox">
          <div className="agent-name">Claude Code CLI <span className="tool-tag">TOOL</span></div>
          <div className="sm secondary">{CLAUDE.role}</div>
          <div className="mono-12 muted">claude -p</div>
        </div>
        {tool ? <StatusBadge status={toolBadge(tool.state)} title={tool.detail ?? undefined} /> : loading ? null : <StatusBadge status="unknown" />}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="meta-chip muted" title="The API does not report the CLI version">version: Not Available</span>
        <span className="xs muted">auth: Not Available</span>
      </div>
      <div className="agent-stats">
        <Stat v={tool ? tool.process_count : null} l="Live processes" />
        <Stat v={tool && tool.pids.length ? tool.pids.slice(0, 2).join(", ") + (tool.pids.length > 2 ? "…" : "") : tool ? "—" : null} l="PIDs" />
        <Stat v={null} l="Invoked by" title="The API does not report which agent started the process" />
      </div>
      <div className="agent-foot">
        <span className="truncate" title={tool?.detail ?? undefined}>{tool?.detail ?? "No runs recorded"}</span>
        <ChevronRight size={16} className="chev" />
      </div>
    </div>
  );
}

// OpenClaw team card (plan 2.3): reduced field set, read-only, not clickable (no drawer yet).
// Hermes-only fields are shown as an explicit "Not Available".
const GW_BADGE = { running: "online", stopped: "offline", unknown: "unknown" } as const;

export function OpenClawCard({ a, now }: { a: OpenClawAgent; now: number }) {
  return (
    <div className="agent-card" style={{ ["--agent-c" as string]: "var(--border-strong)", cursor: "default" }}
      aria-label={`${a.display_name} (OpenClaw), gateway ${a.gateway_status}`}>
      <div className="agent-head">
        <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 10, display: "grid", placeItems: "center",
          fontSize: 30, background: "var(--bg-inset)" }}>{a.emoji ?? "?"}</div>
        <div className="agent-namebox">
          <div className="agent-name truncate" title={a.display_name}>{a.display_name} <span className="tool-tag">OPENCLAW</span></div>
          <div className="sm secondary">{a.theme ?? "Not Available"}</div>
          <div className="mono-12 muted">{a.name}</div>
        </div>
        <StatusBadge status={GW_BADGE[a.gateway_status] ?? "unknown"} label={`Gateway ${a.gateway_status}`}
          title="Shared OpenClaw gateway (state_leases + /proc); all team agents share it" />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {a.model ? <span className="meta-chip" title="Configured model">{a.model}</span> : <span className="meta-chip muted">model: Not Available</span>}
        <span className="xs muted">{a.model_inherited ? "(default)" : "configured"}</span>
        {a.is_running
          ? <StatusBadge status="running" label="Running" />
          : <StatusBadge status="not_running" title="Phase 1: live-run detection is disabled until validated" />}
      </div>
      <div className="agent-stats">
        <Stat v={a.session_count} l="Sessions" />
        <Stat v={null} l="Skills" title="OpenClaw does not expose a skill count" />
        <Stat v={null} l="Memory" title="Not read from OpenClaw" />
      </div>
      <div className="agent-stats">
        <Stat v={null} l="Cron jobs" title="Not read from OpenClaw in phase 1" />
        <Stat v={null} l="Session leases" title="OpenClaw has no per-agent session lease" />
        <Stat v={a.can_delegate_to.length ? a.can_delegate_to.length : "—"} l="Delegates to" title={a.can_delegate_to.join(", ") || "none"} />
      </div>
      <div className="agent-foot">
        <Clock size={14} /> <span>Last run <RelTime t={a.last_run_at} now={now} fallback="Never" /></span>
      </div>
    </div>
  );
}

// OpenClaw has no office state: derive only from real fields (error, shared gateway status).
function openclawMiniStatus(a: OpenClawAgent | undefined): { status: BadgeStatus; label: string; title?: string } {
  if (!a) return { status: "unknown", label: "Unknown" };
  if (a.error) return { status: "failed", label: "Error", title: a.error };
  if (a.gateway_status === "running") return { status: "online", label: "Online", title: "OpenClaw gateway running" };
  return { status: "offline", label: "Offline", title: `OpenClaw gateway ${a.gateway_status}` };
}

function OpenClawMiniCard({ m, now }: { m: TeamMember; now: number }) {
  const a = m.openclaw;
  const st = openclawMiniStatus(a);
  const glyph = a?.emoji || m.ident.displayName.charAt(0).toUpperCase() || "?";
  return (
    // No AgentDrawer for OpenClaw: clicking goes to the Agents view, which has the OpenClaw section.
    <button type="button" className="mini-card oc" style={{ ["--agent-c" as string]: `var(${m.ident.cssVar})` }}
      onClick={() => navigate("agents")} aria-label={`${m.ident.displayName} (OpenClaw), ${st.label}. Open Agents`}>
      <span className="mini-oc-badge badge-openclaw" title="OpenClaw agent">OC</span>
      <span className="mini-oc-avatar" aria-hidden="true">{glyph}</span>
      <div className="who">
        <span className="name truncate">{m.ident.displayName}</span>
        <StatusText status={st.status} label={st.label} title={st.title} />
      </div>
      <span className="xs muted" style={{ alignSelf: "flex-end", whiteSpace: "nowrap" }}>
        {m.lastActive ? <RelTime t={m.lastActive} now={now} /> : "Never run"}
      </span>
    </button>
  );
}

export function MiniCard({ m, now }: { m: TeamMember; now: number }) {
  if (m.framework === "openclaw" || m.id.startsWith("openclaw:")) return <OpenClawMiniCard m={m} now={now} />;
  const state = m.office?.state;
  return (
    <button type="button" className="mini-card" style={{ ["--agent-c" as string]: `var(${m.ident.cssVar})` }} onClick={() => openAgent(m.id)}>
      <PixelAvatar id={m.id} size={32} offline={state === "offline"} />
      <div className="who">
        <span className="name truncate">{m.ident.displayName}</span>
        <StatusText status={officeBadge(state)} title={m.office?.state_reason} />
      </div>
      <span className="xs muted" style={{ alignSelf: "flex-start", whiteSpace: "nowrap" }}>
        {m.lastActive ? <RelTime t={m.lastActive} now={now} /> : "No sessions"}
      </span>
    </button>
  );
}

export function MiniToolCard({ tool }: { tool: Tool | undefined }) {
  const b = toolBadge(tool?.state);
  return (
    <button type="button" className="mini-card" style={{ ["--agent-c" as string]: `var(${CLAUDE.cssVar})` }} onClick={() => openAgent(CLAUDE_ID)}>
      <PixelAvatar id={CLAUDE_ID} size={32} offline={tool?.state === "idle"} />
      <div className="who">
        <span className="name truncate">Claude Code CLI</span>
        <StatusText status={b} title={tool?.detail ?? undefined} />
      </div>
      <span className="xs muted" style={{ alignSelf: "flex-start", whiteSpace: "nowrap" }}>
        {tool ? `${tool.process_count} proc` : "—"}
      </span>
    </button>
  );
}
