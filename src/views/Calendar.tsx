// Calendar (spec 6.4). Month view (default) aggregates one chip per job per day, colored by the
// worst outcome that day (failed > running > success > scheduled). Future runs of interval jobs are
// projected from the job's next_run_at + interval (outline-only chips, labelled "scheduled").
import { CalendarX, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { CronJob, CronRun } from "../api/types";
import { OutcomeIcon } from "../components/CronList";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState, ErrorPanel, Skeleton } from "../components/ui/States";
import { runOutcome, runTime, type Outcome } from "../lib/derive";
import { setParams, useRoute } from "../lib/router";
import { clock, dayKey, startOfDay, toDate, useNow } from "../lib/time";
import { AGENTS, color, identity } from "../theme/agents";

type Mode = "month" | "week";
const MODE_KEY = "mc.calendar.mode";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RANK: Record<Outcome, number> = { failed: 0, running: 1, success: 2, scheduled: 3 };
const OC_VAR: Record<Outcome, string> = { failed: "--outcome-failed", running: "--outcome-running", success: "--outcome-success", scheduled: "--outcome-scheduled" };
const HOUR_PX = 48;

interface Occ { job: CronJob | undefined; jobId: string; profile: string; time: Date; end: Date | null; outcome: Outcome; run?: CronRun }

function mondayOf(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Projected future occurrences for interval jobs between from..to (honest: derived from schedule). */
function projections(jobs: CronJob[], from: Date, to: Date, now: number): Occ[] {
  const out: Occ[] = [];
  jobs.forEach((j) => {
    if (!j.enabled) return;
    const next = toDate(j.next_run_at);
    if (!next) return;
    const minutes = j.schedule?.kind === "interval" && typeof j.schedule.minutes === "number" ? j.schedule.minutes : null;
    let t = next.getTime();
    let guard = 0;
    while (t <= to.getTime() && guard++ < 3000) {
      if (t >= from.getTime() && t > now) out.push({ job: j, jobId: j.id, profile: j.profile, time: new Date(t), end: null, outcome: "scheduled" });
      if (!minutes) break; // non-interval schedules: only the known next run
      t += minutes * 60_000;
    }
  });
  return out;
}

export default function Calendar() {
  const jobsR = useApi(endpoints.cronJobs, 30_000);
  const runsR = useApi(endpoints.cronRuns, 30_000);
  const now = useNow(30_000);
  const { params } = useRoute();
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === "week" ? "week" : "month"));
  const setMode = (m: Mode) => { setModeState(m); localStorage.setItem(MODE_KEY, m); };
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const agentsFilter = (params.get("agents") ?? "").split(",").filter(Boolean);
  const dayParam = params.get("day");

  const jobs = useMemo(() => (jobsR.data?.jobs ?? []).filter((j) => !agentsFilter.length || agentsFilter.includes(j.profile)), [jobsR.data, agentsFilter.join(",")]);
  const runs = useMemo(() => (runsR.data?.runs ?? []).filter((r) => !agentsFilter.length || agentsFilter.includes(r.profile)), [runsR.data, agentsFilter.join(",")]);

  // Visible range
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mode === "month" ? mondayOf(monthStart) : mondayOf(anchor);
  const gridDays = mode === "month" ? 42 : 7;
  const gridEnd = addDays(gridStart, gridDays);

  const occs: Occ[] = useMemo(() => {
    const jobOf = (r: CronRun) => (jobsR.data?.jobs ?? []).find((j) => j.id === r.job_id && j.profile === r.profile);
    const real: Occ[] = runs.flatMap((r) => {
      const t = runTime(r);
      return t ? [{ job: jobOf(r), jobId: r.job_id, profile: r.profile, time: t, end: toDate(r.finished_at), outcome: runOutcome(r), run: r }] : [];
    });
    return [...real, ...projections(jobs, gridStart, gridEnd, now)];
  }, [runs, jobs, jobsR.data, gridStart.getTime(), gridEnd.getTime(), now]);

  const byDay = useMemo(() => {
    const m = new Map<string, Occ[]>();
    occs.forEach((o) => { const k = dayKey(o.time); m.set(k, [...(m.get(k) ?? []), o]); });
    return m;
  }, [occs]);

  const toggleAgent = (id: string) => {
    const s = new Set(agentsFilter);
    if (s.has(id)) s.delete(id); else s.add(id);
    setParams({ agents: [...s].join(",") || null }, true);
  };
  const step = (dir: number) => setAnchor((a) => mode === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, 7 * dir));
  const title = mode === "month"
    ? anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : `${gridStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(gridStart, 6).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  const loading = jobsR.loading || runsR.loading;
  const error = jobsR.error ?? runsR.error;
  const noJobs = !loading && !error && jobs.length === 0;

  return (
    <>
      <div className="cal-head">
        <button className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
        <button className="icon-btn" aria-label="Next" onClick={() => step(1)}><ChevronRight size={18} /></button>
        <span className="cal-title">{title}</span>
        <button className="btn btn-secondary" onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
        <div style={{ flex: 1 }} />
        <div className="segmented" role="group" aria-label="Calendar mode">
          <button aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
          <button aria-pressed={mode === "week"} onClick={() => setMode("week")}>Week</button>
        </div>
        <div className="chips" role="group" aria-label="Filter by agent">
          {AGENTS.map((a) => (
            <button key={a.id} className="chip" aria-pressed={agentsFilter.includes(a.id)} onClick={() => toggleAgent(a.id)}>
              <span className="dot" style={{ background: color(a.id) }} />{a.shortName}
            </button>
          ))}
        </div>
        <div className="legend" aria-label="Legend">
          {(["success", "failed", "running"] as Outcome[]).map((o) => (
            <span key={o}><span className="swatch" style={{ background: `var(${OC_VAR[o]})` }} />{o[0].toUpperCase() + o.slice(1)}</span>
          ))}
          <span><span className="swatch" style={{ border: "1px dashed var(--outcome-scheduled)" }} />Scheduled</span>
        </div>
      </div>

      {error ? <ErrorPanel what="cron data" error={error} onRetry={() => { void refetch(endpoints.cronJobs); void refetch(endpoints.cronRuns); }} />
        : loading ? <Skeleton h={560} r={12} />
        : mode === "month" ? (
          <div className="month">
            {WEEKDAYS.map((d) => <div key={d} className="month-wd">{d}</div>)}
            {Array.from({ length: gridDays }, (_, i) => {
              const d = addDays(gridStart, i);
              return <DayCell key={i} d={d} inMonth={d.getMonth() === anchor.getMonth()} occs={byDay.get(dayKey(d)) ?? []} now={now} />;
            })}
            {noJobs && <CalEmpty filtered={agentsFilter} />}
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <WeekView start={gridStart} occs={occs} now={now} />
            {noJobs && <CalEmpty filtered={agentsFilter} />}
          </div>
        )}
      {dayParam && <DayDrawer day={dayParam} occs={byDay.get(dayParam) ?? []} />}
    </>
  );
}

function CalEmpty({ filtered }: { filtered: string[] }) {
  return (
    <div className="cal-empty">
      <div className="card">
        <EmptyState icon={<CalendarX size={48} />} title="No scheduled jobs"
          body={filtered.length === 1
            ? `${identity(filtered[0]).displayName} has no cron jobs in this period.`
            : <>Cron jobs from all Hermes profiles appear here. Create one with <code className="inline-code">hermes cron</code>.</>} />
      </div>
    </div>
  );
}

interface Agg { key: string; job: CronJob | undefined; jobId: string; profile: string; worst: Outcome; n: number; counts: Record<Outcome, number> }
function aggregate(occs: Occ[]): Agg[] {
  const m = new Map<string, Agg>();
  occs.forEach((o) => {
    const k = `${o.profile}:${o.jobId}`;
    const a = m.get(k) ?? { key: k, job: o.job, jobId: o.jobId, profile: o.profile, worst: "scheduled" as Outcome, n: 0, counts: { failed: 0, running: 0, success: 0, scheduled: 0 } };
    a.n += 1; a.counts[o.outcome] += 1;
    if (RANK[o.outcome] < RANK[a.worst]) a.worst = o.outcome;
    m.set(k, a);
  });
  return [...m.values()].sort((a, b) => RANK[a.worst] - RANK[b.worst]);
}
function aggTip(a: Agg) {
  const parts = [`${a.n} run${a.n === 1 ? "" : "s"}`];
  (["success", "failed", "running", "scheduled"] as Outcome[]).forEach((o) => { if (a.counts[o]) parts.push(`${a.counts[o]} ${o}`); });
  const name = a.job?.name ?? `job ${a.jobId} (no longer in jobs.json)`;
  return `${name} (${identity(a.profile).shortName}): ${parts.join(" · ")}`;
}

function Chip({ a }: { a: Agg }) {
  const sched = a.worst === "scheduled";
  return (
    <button type="button" className={`evt${sched ? " sched" : ""}`} title={aggTip(a)}
      style={{ ["--oc" as string]: `var(${OC_VAR[a.worst]})`, ["--oc-subtle" as string]: `var(${OC_VAR[a.worst]}-subtle)` }}
      onClick={() => setParams({ job: a.key })}>
      <span className="dot" style={{ background: color(a.profile) }} />
      <span className="truncate">{a.job?.name ?? `job ${a.jobId}`}</span>
      {a.n > 1 && <span className="n">×{a.n}</span>}
    </button>
  );
}

function DayCell({ d, inMonth, occs, now }: { d: Date; inMonth: boolean; occs: Occ[]; now: number }) {
  const aggs = aggregate(occs);
  const fail = aggs.some((a) => a.counts.failed > 0);
  const today = dayKey(d) === dayKey(new Date(now));
  return (
    <div className={`day${inMonth ? "" : " out"}${fail ? " has-fail" : ""}${today ? " today" : ""}`}>
      <div className="day-top">
        <span className="day-num">{d.getDate()}</span>
        {fail && <span className="fail-dot" title="At least one failed run" />}
      </div>
      {aggs.slice(0, 3).map((a) => <Chip key={a.key} a={a} />)}
      {aggs.length > 3 && <button className="more-link" onClick={() => setParams({ day: dayKey(d) })}>+{aggs.length - 3} more</button>}
      {aggs.length > 0 && aggs.length <= 3 && <button className="sr-only" onClick={() => setParams({ day: dayKey(d) })}>Open day</button>}
    </div>
  );
}

function DayDrawer({ day, occs }: { day: string; occs: Occ[] }) {
  const d = new Date(`${day}T00:00:00`);
  const sorted = [...occs].sort((a, b) => a.time.getTime() - b.time.getTime());
  return (
    <Drawer open onClose={() => setParams({ day: null })} title={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} subtitle={`${occs.length} runs`}>
      {aggregate(occs).map((a) => (
        <div key={a.key} className="section">
          <button className="row btn-text btn" style={{ padding: 0 }} onClick={() => setParams({ day: null, job: a.key })}>
            <span className="dot" style={{ background: color(a.profile) }} />{a.job?.name ?? `job ${a.jobId}`}
          </button>
          <div className="xs muted">{aggTip(a)}</div>
          {sorted.filter((o) => `${o.profile}:${o.jobId}` === a.key).map((o, i) => (
            <div key={i} className="list-row"><OutcomeIcon o={o.outcome} size={14} /><span className="tabular">{clock(o.time)}</span><span className="xs muted truncate">{o.outcome === "scheduled" ? "scheduled (projected)" : o.run?.error ?? o.outcome}</span></div>
          ))}
        </div>
      ))}
      {!occs.length && <p className="sm muted">No runs this day.</p>}
    </Drawer>
  );
}

function WeekView({ start, occs, now }: { start: Date; occs: Occ[]; now: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX; }, []);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const nowD = new Date(now);
  return (
    <div className="week">
      <div className="week-hdr" />
      {days.map((d) => (
        <div key={d.toISOString()} className={`week-hdr${dayKey(d) === dayKey(nowD) ? " today" : ""}`}>
          {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
        </div>
      ))}
      <div className="week-body" ref={scroller}>
        <div className="week-gutter">{Array.from({ length: 24 }, (_, h) => <div key={h} className="week-hour">{h ? `${String(h).padStart(2, "0")}:00` : ""}</div>)}</div>
        {days.map((d) => {
          const list = occs.filter((o) => dayKey(o.time) === dayKey(d)).sort((a, b) => a.time.getTime() - b.time.getTime());
          // Lanes: one per job within the day, max 3 (then merge into lane 3).
          const lanes = new Map<string, number>();
          list.forEach((o) => { const k = `${o.profile}:${o.jobId}`; if (!lanes.has(k)) lanes.set(k, Math.min(lanes.size, 2)); });
          const nLanes = Math.max(1, Math.min(3, lanes.size));
          const isToday = dayKey(d) === dayKey(nowD);
          return (
            <div key={d.toISOString()} className="week-col" style={{ height: 24 * HOUR_PX }}>
              {list.map((o, i) => {
                const mins = o.time.getHours() * 60 + o.time.getMinutes();
                const dur = o.end ? (o.end.getTime() - o.time.getTime()) / 60_000 : 0;
                const lane = lanes.get(`${o.profile}:${o.jobId}`) ?? 0;
                const sched = o.outcome === "scheduled";
                return (
                  <button key={i} type="button" className={`week-block${sched ? " sched" : ""}`}
                    title={`${o.job?.name ?? `job ${o.jobId}`} · ${clock(o.time)} · ${o.outcome}${o.run?.error ? ` · ${o.run.error}` : ""}`}
                    onClick={() => setParams({ job: `${o.profile}:${o.jobId}` })}
                    style={{
                      top: (mins / 60) * HOUR_PX, height: Math.max(6, (dur / 60) * HOUR_PX),
                      left: `calc(${(lane / nLanes) * 100}% + 2px)`, width: `calc(${100 / nLanes}% - 4px)`,
                      ["--oc" as string]: `var(${OC_VAR[o.outcome]})`, ["--oc-subtle" as string]: `var(${OC_VAR[o.outcome]}-subtle)`,
                    }} />
                );
              })}
              {isToday && <div className="now-line" style={{ top: ((nowD.getHours() * 60 + nowD.getMinutes()) / 60) * HOUR_PX }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
