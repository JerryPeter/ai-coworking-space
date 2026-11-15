// Agent detail drawer (spec 5.10). Opened anywhere via ?agent=<profile> (Dashboard, Agents,
// Office, Activity). Mounted once in App so every view shares it.
import { Box, Brain } from "lucide-react";
import { endpoints, useApi } from "../../api/client";
import type { Session } from "../../api/types";
import { officeBadge, sessionDescription, sessionStart, toolBadge } from "../../lib/derive";
import { href, setParams, useRoute } from "../../lib/router";
import { useTeam, type TeamMember } from "../../lib/team";
import { absolute, duration, toDate, useNow } from "../../lib/time";
import { CLAUDE_ID, identity } from "../../theme/agents";
import { CronRows } from "../CronList";
import { MemoryBlock, splitEntries } from "../MemoryBlock";
import { Drawer } from "../ui/Drawer";
import { PixelAvatar } from "../ui/PixelAvatar";
import { CopyButton, EmptyState, RelTime, Skeleton } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";

const TABS = [
  { id: "overview", label: "Overview" }, { id: "sessions", label: "Sessions" }, { id: "cron", label: "Cron" },
  { id: "skills", label: "Skills" }, { id: "memory", label: "Memory" },
];

function Cell({ v, l }: { v: React.ReactNode; l: string }) {
  const na = v == null;
  return <div className="stat-cell"><div className={`v${na ? " na" : ""}`}>{na ? "Not Available" : v}</div><div className="l">{l}</div></div>;
}

export function AgentDrawerHost() {
  const { params } = useRoute();
  const id = params.get("agent");
  if (!id) return null;
  return <AgentDrawerInner id={id} tab={params.get("tab") ?? "overview"} />;
}

function AgentDrawerInner({ id, tab }: { id: string; tab: string }) {
  const team = useTeam(id ? 5_000 : 30_000);
  const now = useNow(10_000);
  const close = () => setParams({ agent: null, tab: null });

  if (id === CLAUDE_ID) {
    const t = team.tool;
    return (
      <Drawer open onClose={close} title="Claude Code CLI" subtitle="Coding tool"
        avatar={<PixelAvatar id={CLAUDE_ID} size={32} />}>
        <div className="section">
          <div className="row">
            {t ? <StatusBadge status={toolBadge(t.state)} /> : <StatusBadge status="unknown" />}
            <span className="tool-tag">TOOL</span>
          </div>
          <dl className="kv">
            <dt>State (API)</dt><dd className="mono-12">{t?.state ?? "Not Available"}</dd>
            <dt>Live processes</dt><dd className="tabular">{t?.process_count ?? "Not Available"}</dd>
            <dt>PIDs</dt><dd className="mono-12">{t?.pids.length ? t.pids.join(", ") : "—"}</dd>
            <dt>Detail</dt><dd>{t?.detail ?? "Not Available"}</dd>
            <dt>Version</dt><dd className="muted">Not Available</dd>
            <dt>Authentication</dt><dd className="muted">Not Available</dd>
            <dt>Invoked by</dt><dd className="muted">Not Available</dd>
            <dt>Source</dt><dd className="mono-12 muted">{team.tools.data?.source ?? "—"}</dd>
          </dl>
          <p className="xs muted">The API detects live <code className="inline-code">claude -p</code> processes only. "Running" means at least one is alive right now.</p>
        </div>
        <a className="btn btn-secondary" style={{ alignSelf: "flex-start" }} href={href("office", { focus: CLAUDE_ID })}><Box size={14} /> Open in 3D Office</a>
      </Drawer>
    );
  }

  const m = team.members.find((x) => x.id === id);
  const ident = identity(id);
  if (!m) {
    return (
      <Drawer open onClose={close} title={ident.displayName} subtitle={id}>
        {team.loading ? <Skeleton h={200} /> : <EmptyState title="Profile not found" body={`The API doesn't list a profile named ${id}.`} />}
      </Drawer>
    );
  }

  return (
    <Drawer open onClose={close} title={ident.displayName} subtitle={`${ident.role} · ${id}`}
      avatar={<PixelAvatar id={id} size={32} offline={m.office?.state === "offline"} />}
      tabs={TABS} tab={tab} onTab={(t) => setParams({ tab: t === "overview" ? null : t }, true)}>
      {tab === "overview" && <Overview m={m} now={now} />}
      {tab === "sessions" && <Sessions m={m} />}
      {tab === "cron" && (
        <div className="card" style={{ overflow: "hidden" }}>
          {m.jobs.length ? <CronRows jobs={m.jobs} now={now} />
            : <EmptyState title={`${ident.displayName} has no cron jobs.`} body={<>Create one with <code className="inline-code">hermes -p {id} cron</code>.</>} />}
        </div>
      )}
      {tab === "skills" && <SkillsTab id={id} />}
      {tab === "memory" && <MemoryTab id={id} />}
    </Drawer>
  );
}

function Overview({ m, now }: { m: TeamMember; now: number }) {
  const skills = useApi(endpoints.skills(m.id), 300_000);
  const mem = useApi(endpoints.memory(m.id), 300_000);
  const o = m.office;
  const task = o?.current_task;
  return (
    <>
      <div className="section">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <StatusBadge status={officeBadge(o?.state)} title={o?.state_reason} />
          <span className="sm secondary">{o?.state_reason ?? "State not available"}</span>
        </div>
        <dl className="kv">
          <dt>Profile name (API)</dt><dd>{m.agent?.display_name ?? "Not Available"}</dd>
          <dt>Model</dt><dd>{m.model ? <><span className="mono-12">{m.model}</span> <span className="xs muted">(latest session)</span></> : <span className="muted">Not Available</span>}</dd>
          <dt>Provider</dt><dd className="muted">Not Available</dd>
          <dt>Current task</dt><dd>{task ? <>#{String(task.id)} {task.title ?? ""}</> : <span className="muted">Not Available</span>}</dd>
          <dt>Last activity</dt><dd>{o?.last_activity ? <>{o.last_activity} · </> : null}{o?.last_activity_at || m.lastActive ? <RelTime t={o?.last_activity_at ?? m.lastActive} now={now} /> : <span className="muted">Not Available</span>}</dd>
          <dt>Gateway</dt><dd>{m.agent ? <>{m.agent.status}{m.agent.gateway_pid ? <span className="mono-12 muted"> · pid {m.agent.gateway_pid}</span> : null}</> : <span className="muted">Not Available</span>}</dd>
          <dt>Live session leases</dt><dd className="tabular">{o?.session_leases.available ? `${o.session_leases.live_count ?? 0} of ${o.session_leases.total ?? 0}` : "Not Available"}</dd>
          <dt>Profile path</dt><dd className="row" style={{ gap: 4 }}><span className="mono-12">{m.agent?.home ?? "Not Available"}</span>{m.agent?.home && <CopyButton text={m.agent.home} label="Copy path" />}</dd>
        </dl>
      </div>
      <div className="section">
        <div className="eyebrow">Stats</div>
        <div className="stat-grid">
          <Cell v={m.sessionTotal} l="Total sessions" />
          <Cell v={m.today ? `${m.today.n}${m.today.exact ? "" : "+"}` : null} l="Sessions today" />
          <Cell v={m.jobs.length} l="Cron jobs" />
          <Cell v={<span style={{ color: m.failingJobs ? "var(--outcome-failed)" : undefined }}>{m.failingJobs}</span>} l="Failing crons" />
          <Cell v={skills.data?.count} l="Skills" />
          <Cell v={mem.data ? (mem.data.memory.exists ? `${(mem.data.memory.size_bytes ?? 0).toLocaleString()} B` : "Missing") : null} l="MEMORY.md size" />
        </div>
      </div>
      <div className="row">
        <a className="btn btn-secondary" href={href("office", { focus: m.id })}><Box size={14} /> Open in 3D Office</a>
        <a className="btn btn-secondary" href={href("memory", { profile: m.id })}><Brain size={14} /> Open memory</a>
      </div>
    </>
  );
}

function Sessions({ m }: { m: TeamMember }) {
  if (!m.sessions.length) {
    return (
      <div className="empty">
        <div style={{ position: "relative" }}>
          <PixelAvatar id={m.id} size={64} tile={false} grayscale={0.5} />
          <span className="muted" style={{ position: "absolute", right: -14, top: 6, fontSize: 8 }}>z</span>
          <span className="muted" style={{ position: "absolute", right: -22, top: -4, fontSize: 10 }}>z</span>
          <span className="muted" style={{ position: "absolute", right: -32, top: -16, fontSize: 12 }}>z</span>
        </div>
        <div className="empty-title">No sessions yet</div>
        <div className="empty-body">{m.ident.displayName} hasn't run a session on this machine. Sessions appear here after the first <code className="inline-code">hermes -p {m.id} chat</code>.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="xs muted" style={{ marginBottom: 8 }}>Last {Math.min(20, m.sessions.length)} of {m.sessionTotal ?? m.sessions.length} sessions</div>
      {m.sessions.slice(0, 20).map((s: Session) => {
        const st = sessionStart(s), en = toDate(s.ended_at_iso);
        return (
          <div key={s.id} className="list-row">
            <span className="tabular" style={{ width: 118, flexShrink: 0 }}>{absolute(st)}</span>
            <span className="xs muted tabular" style={{ width: 56, flexShrink: 0 }}>{en && st ? duration(en.getTime() - st.getTime()) : "open"}</span>
            <span className="truncate" style={{ flex: 1 }} title={sessionDescription(s)}>{sessionDescription(s)}</span>
            <span className="xs muted tabular" title="Messages">{s.message_count ?? "—"} msg</span>
          </div>
        );
      })}
    </div>
  );
}

export function SkillsTab({ id }: { id: string }) {
  const r = useApi(endpoints.skills(id), 300_000);
  if (r.loading) return <Skeleton h={120} />;
  if (r.error) return <p className="sm" style={{ color: "var(--outcome-failed)" }}>{r.error.message}</p>;
  const skills = r.data?.skills ?? [];
  if (!skills.length) return <EmptyState title="No skills installed for this profile." foot={r.data?.source} />;
  const groups = new Map<string, typeof skills>();
  skills.forEach((s) => { const k = s.category ?? "uncategorized"; groups.set(k, [...(groups.get(k) ?? []), s]); });
  return (
    <>
      {[...groups.entries()].map(([cat, list]) => (
        <div key={cat} className="skill-group">
          <div className="eyebrow">{cat} · {list.length}</div>
          <div className="chips">{list.map((s) => <span key={s.dir} className="chip" title={s.description ?? undefined}>{s.name}</span>)}</div>
        </div>
      ))}
    </>
  );
}

function MemoryTab({ id }: { id: string }) {
  const r = useApi(endpoints.memory(id), 300_000);
  if (r.loading) return <Skeleton h={160} />;
  const mem = r.data?.memory;
  return (
    <>
      {!mem?.exists ? (
        <EmptyState title={`No MEMORY.md for ${identity(id).displayName}`} body={<>Expected at <code className="inline-code">{mem?.source}</code>.</>} />
      ) : mem.content == null ? (
        <p className="sm" style={{ color: "var(--outcome-failed)" }}>{mem.error ?? "Content not returned"}</p>
      ) : (
        <>
          {mem.identical_to_default && <StatusBadge status="reviewing" label="Cloned from default profile" />}
          <MemoryBlock path={mem.source} content={mem.content} entries maxEntries={3} sizeBytes={mem.size_bytes} />
          <span className="xs muted">Showing {Math.min(3, splitEntries(mem.content).length)} of {splitEntries(mem.content).length} entries.</span>
        </>
      )}
      <a className="btn btn-secondary" style={{ alignSelf: "flex-start" }} href={href("memory", { profile: id })}><Brain size={14} /> Open in Memory view</a>
    </>
  );
}

