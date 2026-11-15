// Agent card (spec 5.2), Claude tool card variant, and the compact team-strip card (6.1).
import { ChevronRight, Clock, Moon } from "lucide-react";
import { endpoints, useApi } from "../../api/client";
import type { Tool } from "../../api/types";
import { officeBadge, toolBadge } from "../../lib/derive";
import { setParams, useRoute } from "../../lib/router";
import type { TeamMember } from "../../lib/team";
import { CLAUDE, CLAUDE_ID } from "../../theme/agents";
import { PixelAvatar } from "../ui/PixelAvatar";
import { RelTime } from "../ui/States";
import { StatusBadge, StatusText } from "../ui/StatusBadge";

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

export function MiniCard({ m, now }: { m: TeamMember; now: number }) {
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
