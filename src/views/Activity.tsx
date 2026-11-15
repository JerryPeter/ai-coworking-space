// Activity (spec 6.5): reverse-chronological audit trail of sessions + cron runs.
// Filters: agent chips (OR) AND type chips (OR), synced to the URL (?agents=..&type=..).
import { useEffect, useMemo, useRef, useState } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import { TimelineItem } from "../components/Timeline";
import { EmptyState, ErrorPanel, Skeleton } from "../components/ui/States";
import { buildEvents, type ActivityEvent, type EventType } from "../lib/events";
import { setParams, useRoute } from "../lib/router";
import { usePageSubtitle } from "../lib/subtitle";
import { dayKey, startOfDay, useNow } from "../lib/time";
import { ROSTER, color, identity } from "../theme/agents";

const PAGE = 50;
const TYPES: { id: EventType; label: string }[] = [
  { id: "session", label: "Session" }, { id: "cron", label: "Cron" }, { id: "task", label: "Task" }, { id: "system", label: "System" },
];

function dayLabel(d: Date, now: number) {
  const today = startOfDay(new Date(now)).getTime();
  const t = startOfDay(d).getTime();
  if (t === today) return "Today";
  if (t === today - 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function Activity() {
  const sessions = useApi(endpoints.sessions, 30_000);
  const runs = useApi(endpoints.cronRuns, 30_000);
  const jobs = useApi(endpoints.cronJobs, 30_000);
  const now = useNow(15_000);
  const { params } = useRoute();
  const agentSel = (params.get("agents") ?? "").split(",").filter(Boolean);
  const typeSel = (params.get("type") ?? "").split(",").filter(Boolean) as EventType[];
  const [pages, setPages] = useState(1);

  const all = useMemo(() => buildEvents(sessions.data?.sessions, runs.data?.runs, jobs.data?.jobs), [sessions.data, runs.data, jobs.data]);

  // New events while scrolled down are held back behind a pill so the list doesn't shift.
  const [baseline, setBaseline] = useState<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!all.length) return;
    if (!baseline) { setBaseline(new Set(all.map((e) => e.key))); return; }
    const added = all.filter((e) => !baseline.has(e.key));
    if (added.length && window.scrollY < 120) {
      setBaseline(new Set(all.map((e) => e.key)));
      setFresh(new Set(added.map((e) => e.key)));
    }
  }, [all]);
  const pending = baseline ? all.filter((e) => !baseline.has(e.key)) : [];
  const mergePending = () => {
    setBaseline(new Set(all.map((e) => e.key)));
    setFresh(new Set(pending.map((e) => e.key)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const visibleBase = baseline ? all.filter((e) => baseline.has(e.key)) : all;
  const filtered = visibleBase.filter((e) => (!agentSel.length || agentSel.includes(e.profile)) && (!typeSel.length || typeSel.includes(e.type)));
  const shown = filtered.slice(0, pages * PAGE);
  usePageSubtitle(sessions.data ? `· ${filtered.length} events` : null);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) setPages((p) => p + 1); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length]);

  const toggle = (key: "agents" | "type", list: string[], id: string) => {
    const s = new Set(list);
    if (s.has(id)) s.delete(id); else s.add(id);
    setPages(1);
    setParams({ [key]: [...s].join(",") || null }, true);
  };
  const anyFilter = agentSel.length > 0 || typeSel.length > 0;

  // Group by day
  const groups: { key: string; label: string; items: ActivityEvent[] }[] = [];
  shown.forEach((e) => {
    const k = dayKey(e.time);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.items.push(e); else groups.push({ key: k, label: dayLabel(e.time, now), items: [e] });
  });

  const truncated = sessions.data && sessions.data.total != null && sessions.data.count < sessions.data.total;
  const loading = sessions.loading || runs.loading;
  const error = sessions.error ?? runs.error;

  return (
    <>
      <div className="filterbar" role="toolbar" aria-label="Activity filters">
        <div className="chips" style={{ flexWrap: "nowrap" }}>
          <button className="chip" aria-pressed={!agentSel.length} onClick={() => { setPages(1); setParams({ agents: null }, true); }}>All</button>
          {ROSTER.map((a) => (
            <button key={a.id} className="chip" aria-pressed={agentSel.includes(a.id)} onClick={() => toggle("agents", agentSel, a.id)}>
              <span className={a.kind === "tool" ? "sq-dot" : "dot"} style={{ background: color(a.id) }} />{a.shortName}
            </button>
          ))}
          <span className="chip-divider" />
          {TYPES.map((t) => (
            <button key={t.id} className="chip" aria-pressed={typeSel.includes(t.id)} onClick={() => toggle("type", typeSel, t.id)}>{t.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span className="xs muted tabular" style={{ whiteSpace: "nowrap" }}>{filtered.length} events</span>
        {anyFilter && <button className="btn btn-text" onClick={() => { setPages(1); setParams({ agents: null, type: null }, true); }}>Clear filters</button>}
      </div>

      {pending.length > 0 && (
        <button className="btn btn-primary" onClick={mergePending}
          style={{ position: "fixed", top: "calc(var(--topbar-h) + 64px)", left: "50%", transform: "translateX(-50%)", zIndex: 15, borderRadius: 9999, color: "var(--text-inverse)", boxShadow: "var(--shadow-md)" }}>
          ↑ {pending.length} new event{pending.length > 1 ? "s" : ""}
        </button>
      )}

      <div className="activity-wrap">
        {error ? <ErrorPanel what="activity" error={error} onRetry={() => { void refetch(endpoints.sessions); void refetch(endpoints.cronRuns); }} />
          : loading ? <div className="stack" style={{ gap: 12 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={44} />)}</div>
          : all.length === 0 ? (
            <EmptyState title="No activity recorded yet." body="Sessions, cron runs and task changes from all profiles will appear here." />
          ) : filtered.length === 0 ? (
            <EmptyState title={emptyTitle(agentSel, typeSel)}
              body={typeSel.some((t) => t === "task" || t === "system") ? "The API has no kanban or system event feed yet; only sessions and cron runs are recorded." : undefined}>
              <button className="btn btn-secondary" onClick={() => setParams({ agents: null, type: null }, true)}>Clear filters</button>
            </EmptyState>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label}>
                  <div className="day-header">{g.label}</div>
                  <div className="timeline">{g.items.map((e) => <TimelineItem key={e.key} ev={e} now={now} fresh={fresh.has(e.key)} />)}</div>
                </section>
              ))}
              {shown.length < filtered.length ? (
                <div ref={sentinel} style={{ padding: "12px 0" }}>
                  <div className="stack" style={{ gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={36} />)}</div>
                  <button className="btn btn-text" onClick={() => setPages((p) => p + 1)}>Load more</button>
                </div>
              ) : (
                <p className="xs muted" style={{ padding: "16px 0 0 24px" }}>
                  {truncated ? `Showing the latest ${sessions.data!.count} of ${sessions.data!.total} sessions (API limit).` : "Beginning of recorded activity"}
                </p>
              )}
            </>
          )}
      </div>
    </>
  );
}

function emptyTitle(agents: string[], types: EventType[]) {
  const t = types.length === 1 ? `${types[0]} ` : "";
  const who = agents.length === 1 ? ` for ${identity(agents[0]).shortName}` : agents.length > 1 ? " for the selected agents" : "";
  return `No ${t}events${who} yet.`;
}
