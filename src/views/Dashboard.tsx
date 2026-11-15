// Dashboard (spec 6.1): alerts → team strip → stat tiles → recent activity + cron jobs.
import {
  ChevronDown, ChevronUp, Globe, MessageSquare, SquareKanban, Timer, TriangleExclamationPoint,
} from "lucide-react";
import { useMemo, useState } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { CronJob } from "../api/types";
import { MiniCard, MiniToolCard } from "../components/agents/AgentCard";
import { CronRows } from "../components/CronList";
import { TimelineItem } from "../components/Timeline";
import { EmptyState, ErrorPanel, RelTime, Skeleton } from "../components/ui/States";
import { cronHealth, hourlySessions, sessionsToday } from "../lib/derive";
import { buildEvents } from "../lib/events";
import { href, setParams } from "../lib/router";
import { useTeam } from "../lib/team";
import { clock, useNow } from "../lib/time";
import { color, identity } from "../theme/agents";

const ALERTS_KEY = "mc.alerts.collapsed";
const FEED_ITEMS = 5;

export default function Dashboard() {
  const team = useTeam();
  const summary = useApi(endpoints.summary, 30_000);
  const runs = useApi(endpoints.cronRuns, 30_000);
  const now = useNow(10_000);
  const jobs = team.jobs.data?.jobs;
  const health = cronHealth(jobs);

  const events = useMemo(
    () => buildEvents(team.sessions.data?.sessions, runs.data?.runs, jobs),
    [team.sessions.data, runs.data, jobs],
  );

  return (
    <div className="stack">
      <Alerts failing={health?.failing ?? []} gatewayDown={!!team.agents.data && team.agents.data.agents.every((a) => a.status === "stopped")} now={now} />

      {/* Team status strip */}
      <section className="section" aria-label="Team status">
        <div className="eyebrow">Team status</div>
        {team.error && !team.members.length ? (
          <ErrorPanel what="team status" error={team.error} onRetry={() => { void refetch(endpoints.agents); void refetch(endpoints.office); }} />
        ) : (
          <div className="team-strip">
            {team.loading && !team.members.length
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} h={64} r={12} style={{ flex: 1, minWidth: 200 }} />)
              : team.members.map((m) => <MiniCard key={m.id} m={m} now={now} />)}
            <div className="team-divider"><span className="eyebrow">Tools</span></div>
            <MiniToolCard tool={team.tool} />
          </div>
        )}
      </section>

      {/* Stat tiles */}
      <section className="tiles" aria-label="Key numbers">
        <SessionsTile team={team} summary24h={summary.data?.activity.sessions_24h} />
        <CronTile health={health} loading={team.jobs.loading} error={team.jobs.error?.message} />
        <GatewayTile team={team} />
        <TasksTile summary={summary} />
      </section>

      <section className="dash-cols">
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <span className="card-title">Recent activity</span>
            <span className="xs muted">latest {FEED_ITEMS}</span>
            <a href={href("activity")} className="sm" style={{ marginLeft: "auto" }}>View all →</a>
          </div>
          <div className="card-body" style={{ maxHeight: 560, overflowY: "auto" }}>
            {team.sessions.loading ? <Skeleton h={200} /> : team.sessions.error ? (
              <ErrorPanel what="activity" error={team.sessions.error} onRetry={() => refetch(endpoints.sessions)} />
            ) : events.length === 0 ? (
              <EmptyState title="No activity recorded yet." />
            ) : (
              <div className="timeline">{events.slice(0, FEED_ITEMS).map((e) => <TimelineItem key={e.key} ev={e} now={now} />)}</div>
            )}
          </div>
        </div>
        <div className="card" style={{ overflow: "hidden", alignSelf: "start" }}>
          <div className="card-head">
            <span className="card-title">Cron jobs</span>
            {jobs && <span className="count-pill">{jobs.length}</span>}
            <a href={href("calendar")} className="sm" style={{ marginLeft: "auto" }}>Calendar →</a>
          </div>
          {team.jobs.loading ? <div className="card-body"><Skeleton h={96} /></div> : team.jobs.error ? (
            <div className="card-body"><ErrorPanel what="cron jobs" error={team.jobs.error} onRetry={() => refetch(endpoints.cronJobs)} /></div>
          ) : <CronRows jobs={jobs ?? []} runs={runs.data?.runs} now={now} />}
        </div>
      </section>
    </div>
  );
}

function Alerts({ failing, gatewayDown, now }: { failing: CronJob[]; gatewayDown: boolean; now: number }) {
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem(ALERTS_KEY) === "1");
  const [showAll, setShowAll] = useState(false);
  const count = failing.length + (gatewayDown ? 1 : 0);
  if (!count) return null; // zero space when there are no problems
  const toggle = () => { const v = !collapsed; setCollapsed(v); sessionStorage.setItem(ALERTS_KEY, v ? "1" : "0"); };

  if (collapsed) {
    return (
      <div className="alert-row" role="status">
        <TriangleExclamationPoint size={20} />
        <div className="alert-main alert-summary semibold">{count} active alert{count > 1 ? "s" : ""}</div>
        <button className="btn btn-secondary" onClick={toggle}><ChevronDown size={14} /> Expand</button>
      </div>
    );
  }
  const visible = showAll ? failing : failing.slice(0, gatewayDown ? 2 : 3);
  return (
    <section className="alerts" aria-label="Active alerts" role="alert">
      {gatewayDown && (
        <div className="alert-row">
          <TriangleExclamationPoint size={20} />
          <div className="alert-main">
            <div className="alert-title">Gateway unreachable</div>
            <div className="alert-detail">Every profile's gateway.lock points at a process that is no longer alive.</div>
          </div>
        </div>
      )}
      {visible.map((j) => {
        const id = identity(j.profile);
        const streak = j.failure_streak ?? 0;
        const key = `${j.profile}:${j.id}`;
        return (
          <div key={key} className="alert-row">
            <TriangleExclamationPoint size={20} />
            <div className="alert-main">
              <div className="alert-title truncate">Cron job failing: {j.name}</div>
              <div className="alert-detail">
                <span className="dot" style={{ background: color(j.profile) }} />
                <span>{id.displayName}</span>
                {streak > 0 && <span>· {streak} consecutive failure{streak > 1 ? "s" : ""}</span>}
                {j.last_run_at && <span>· last attempt {clock(j.last_run_at)} (<RelTime t={j.last_run_at} now={now} />)</span>}
                {j.next_run_at && <span>· next {clock(j.next_run_at)}</span>}
              </div>
              {j.last_error && <div className="mono-12 secondary clamp-2" style={{ marginTop: 4 }} title={j.last_error}>{j.last_error}</div>}
            </div>
            <div className="alert-actions">
              <a className="btn btn-secondary" href={href("calendar", { agents: j.profile })}>View in Calendar</a>
              <button className="btn btn-secondary" onClick={() => setParams({ job: key })}>View run log</button>
            </div>
          </div>
        );
      })}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {failing.length > visible.length && <button className="btn btn-text" onClick={() => setShowAll(true)}>Show {failing.length - visible.length} more</button>}
        <button className="btn btn-text" onClick={toggle}><ChevronUp size={14} /> Collapse</button>
      </div>
    </section>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 240, h = 32, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - (v / max) * (h - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="tile-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="var(--accent-secondary)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--accent-secondary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2} fill="var(--accent-secondary)" />
      {values.map((v, i) => (
        <rect key={i} x={(i / values.length) * w} y={0} width={w / values.length} height={h} fill="transparent">
          <title>{`${23 - i === 0 ? "This hour" : `${23 - i}h ago`}: ${v} session${v === 1 ? "" : "s"}`}</title>
        </rect>
      ))}
    </svg>
  );
}

function Num({ v }: { v: number | string }) {
  return <span key={String(v)} className="value-in">{v}</span>;
}

function SessionsTile({ team, summary24h }: { team: ReturnType<typeof useTeam>; summary24h: number | null | undefined }) {
  const today = sessionsToday(team.sessions.data);
  const hourly = hourlySessions(team.sessions.data);
  return (
    <a className="card tile" href={href("activity", { type: "session" })} style={{ paddingBottom: 40 }}>
      <div className="tile-label-row">Sessions today <MessageSquare size={16} /></div>
      {team.sessions.loading ? <Skeleton w={64} h={28} /> : today == null ? (
        <div className="tile-num muted" title={team.sessions.error?.message}>—</div>
      ) : (
        <div className="tile-num"><Num v={`${today.n}${today.exact ? "" : "+"}`} /></div>
      )}
      <div className="tile-ctx">{summary24h != null ? `${summary24h} in the last 24h` : team.sessions.error ? "Source unavailable" : " "}</div>
      {hourly && <Sparkline values={hourly} />}
    </a>
  );
}

function CronTile({ health, loading, error }: { health: ReturnType<typeof cronHealth>; loading: boolean; error?: string }) {
  const failing = health?.failing ?? [];
  const alert = failing.length > 0;
  const who = [...new Set(failing.map((j) => identity(j.profile).shortName))].join(", ");
  return (
    <a className={`card tile${alert ? " alert" : ""}`} href={href("calendar")}>
      <div className="tile-label-row">Cron health <Timer size={16} /></div>
      {loading ? <Skeleton w={64} h={28} /> : !health ? (
        <><div className="tile-num muted">—</div><div className="tile-ctx" title={error}>Source unavailable</div></>
      ) : (
        <>
          <div className="tile-num"><Num v={health.healthy} /><span className="unit">/ {health.total} healthy</span></div>
          {alert ? (
            <div className="tile-ctx alert"><TriangleExclamationPoint size={12} /> {failing.length} failing · {who}</div>
          ) : (
            <div className="tile-ctx">{health.total ? "All jobs' last run succeeded" : "No cron jobs configured"}</div>
          )}
        </>
      )}
    </a>
  );
}

function GatewayTile({ team }: { team: ReturnType<typeof useTeam> }) {
  const list = team.agents.data?.agents;
  const running = list?.filter((a) => a.status === "running") ?? [];
  const status = !list ? null : running.length ? "online" : list.every((a) => a.status === "stopped") ? "offline" : "unknown";
  const pids = [...new Set(running.map((a) => a.gateway_pid).filter(Boolean))];
  return (
    <div className="card tile">
      <div className="tile-label-row">Gateway <Globe size={16} /></div>
      {team.agents.loading ? <Skeleton w={96} h={28} /> : !status ? (
        <><div className="tile-num muted">—</div><div className="tile-ctx" title={team.agents.error?.message}>Source unavailable</div></>
      ) : (
        <>
          <div className="tile-word" style={{ color: status === "online" ? "var(--status-online)" : status === "offline" ? "var(--status-offline)" : "var(--status-unknown)" }}>
            {status === "online" ? "Online" : status === "offline" ? "Offline" : "Unknown"}
          </div>
          <div className="tile-ctx">{running.length}/{list!.length} profiles verified{pids.length ? ` · pid ${pids.join(", ")}` : ""}</div>
          <div className="tile-ctx muted" title="The API doesn't report gateway start time">Uptime: Not Available</div>
        </>
      )}
    </div>
  );
}

function TasksTile({ summary }: { summary: ReturnType<typeof useApi<typeof endpoints.summary>> }) {
  const k = summary.data?.kanban;
  const open = k?.by_status ? Object.entries(k.by_status).filter(([s]) => s !== "done" && s !== "archived").reduce((a, [, n]) => a + n, 0) : null;
  const blocked = k?.by_status?.blocked ?? 0;
  return (
    <a className="card tile" href={href("tasks")}>
      <div className="tile-label-row">Open tasks <SquareKanban size={16} /></div>
      {summary.loading ? <Skeleton w={64} h={28} /> : !k?.available || open == null ? (
        <><div className="tile-num muted">—</div><div className="tile-ctx" title={k?.error ?? summary.error?.message}>Source unavailable</div></>
      ) : (
        <>
          <div className="tile-num"><Num v={open} /></div>
          <div className="tile-ctx">{k.total === 0 ? "No tasks in kanban.db" : `${blocked} blocked`}</div>
        </>
      )}
    </a>
  );
}
