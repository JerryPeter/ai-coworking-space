// Cron job rows (Dashboard + agent drawer) and the cron job / run-log drawer.
import { CircleCheck, CircleX, Clock, Loader } from "lucide-react";
import { endpoints, useApi } from "../api/client";
import type { CronJob, CronRun } from "../api/types";
import { humanSchedule, jobOutcome, runOutcome, runTime, type Outcome } from "../lib/derive";
import { href, setParams, useRoute } from "../lib/router";
import { absolute, duration, toDate, useNow } from "../lib/time";
import { color, identity } from "../theme/agents";
import { Drawer } from "./ui/Drawer";
import { EmptyState, RelTime } from "./ui/States";
import { StatusBadge } from "./ui/StatusBadge";

export function OutcomeIcon({ o, size = 16 }: { o: Outcome; size?: number }) {
  if (o === "failed") return <CircleX size={size} style={{ color: "var(--outcome-failed)" }} aria-label="Failed" />;
  if (o === "running") return <Loader size={size} className="spin-1s" style={{ color: "var(--outcome-running)" }} aria-label="Running" />;
  if (o === "success") return <CircleCheck size={size} style={{ color: "var(--outcome-success)" }} aria-label="Success" />;
  return <Clock size={size} style={{ color: "var(--outcome-scheduled)" }} aria-label="Scheduled, no runs yet" />;
}

const ORDER: Record<Outcome, number> = { failed: 0, running: 1, success: 2, scheduled: 3 };

export function sortJobs(jobs: CronJob[], runs?: CronRun[]): CronJob[] {
  return [...jobs].sort((a, b) => {
    const d = ORDER[jobOutcome(a, runs)] - ORDER[jobOutcome(b, runs)];
    if (d) return d;
    return (toDate(a.next_run_at)?.getTime() ?? Infinity) - (toDate(b.next_run_at)?.getTime() ?? Infinity);
  });
}

export function CronRows({ jobs, runs, now }: { jobs: CronJob[]; runs?: CronRun[]; now: number }) {
  if (!jobs.length) return <EmptyState title="No cron jobs configured." body={<>Create one with <code className="inline-code">hermes cron</code> from the CLI.</>} />;
  return (
    <div role="list">
      {sortJobs(jobs, runs).map((j) => {
        const o = jobOutcome(j, runs);
        return (
          <div key={`${j.profile}:${j.id}`} role="listitem" tabIndex={0} className={`cron-row${o === "failed" ? " failed" : ""}`}
            onClick={() => setParams({ job: `${j.profile}:${j.id}` })}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setParams({ job: `${j.profile}:${j.id}` }); } }}>
            <OutcomeIcon o={o} />
            <div style={{ minWidth: 0 }}>
              <div className="sm truncate" style={{ fontWeight: 500 }} title={j.name}>{j.name}</div>
              <div className="xs muted">{humanSchedule(j)}{!j.enabled ? " · disabled" : ""}</div>
            </div>
            <span className="row xs secondary" style={{ gap: 6 }}><span className="dot" style={{ background: color(j.profile) }} />{identity(j.profile).shortName}</span>
            <div className="times">
              <div className="secondary">last <RelTime t={j.last_run_at} now={now} fallback="never" /></div>
              <div className="muted">next <RelTime t={j.next_run_at} now={now} fallback="—" /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Drawer for one cron job: schedule, last error, run history (opened via ?job=profile:id). */
export function CronJobDrawerHost() {
  const { params } = useRoute();
  const key = params.get("job");
  const jobs = useApi(key ? endpoints.cronJobs : null, 30_000);
  const runs = useApi(key ? endpoints.cronRuns : null, 30_000);
  const now = useNow(10_000);
  if (!key) return null;
  const [profile, id] = key.split(":");
  const job = jobs.data?.jobs.find((j) => j.profile === profile && j.id === id);
  const jobRuns = (runs.data?.runs ?? []).filter((r) => r.profile === profile && r.job_id === id)
    .sort((a, b) => (runTime(b)?.getTime() ?? 0) - (runTime(a)?.getTime() ?? 0));
  const o = job ? jobOutcome(job, runs.data?.runs) : "scheduled";
  const failedRuns = jobRuns.filter((r) => runOutcome(r) === "failed").length;

  return (
    <Drawer open onClose={() => setParams({ job: null })} title={job?.name ?? "Cron job"}
      subtitle={<span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: color(profile) }} />{identity(profile).displayName} · <span className="mono-12">{id}</span></span>}>
      {!job && !jobs.loading && <EmptyState title="Job not found" body={`No job ${id} in ${profile}'s cron/jobs.json.`} />}
      {job && (
        <>
          <div className="section">
            <div className="row">
              <StatusBadge status={o === "scheduled" ? "scheduled" : o} />
              {(job.failure_streak ?? 0) > 0 && <span className="sm secondary">{job.failure_streak} consecutive failures</span>}
            </div>
            <dl className="kv">
              <dt>Schedule</dt><dd>{humanSchedule(job)} <span className="mono-12 muted">({job.schedule_display ?? "—"})</span></dd>
              <dt>Enabled</dt><dd>{job.enabled ? "Yes" : "No"}{job.paused_reason ? ` · paused: ${job.paused_reason}` : ""}</dd>
              <dt>Last run</dt><dd>{job.last_run_at ? `${absolute(job.last_run_at)} (` : "Never"}{job.last_run_at && <RelTime t={job.last_run_at} now={now} />}{job.last_run_at ? ")" : ""}</dd>
              <dt>Last status</dt><dd className="mono-12">{job.last_status ?? "Not Available"}</dd>
              <dt>Next run</dt><dd>{job.next_run_at ? absolute(job.next_run_at) : "Not Available"}</dd>
              <dt>Deliver to</dt><dd>{job.deliver ?? "Not Available"}</dd>
              <dt>Runs recorded</dt><dd className="tabular">{jobRuns.length} ({failedRuns} failed)</dd>
            </dl>
          </div>
          {job.last_error && (
            <div className="section">
              <div className="eyebrow">Last error</div>
              <div className="codeblock"><div className="codeblock-body plain-body" style={{ color: "var(--outcome-failed)" }}>{job.last_error}</div></div>
            </div>
          )}
          <div className="section">
            <div className="eyebrow">Run log</div>
            <p className="xs muted">Hermes doesn't store run output; executions.db keeps status and error only.</p>
            {jobRuns.length === 0 ? <p className="sm muted">No runs recorded for this job.</p> : (
              <div>
                {jobRuns.slice(0, 50).map((r) => {
                  const ro = runOutcome(r);
                  const st = toDate(r.started_at), fin = toDate(r.finished_at);
                  return (
                    <div key={r.id} className="list-row" style={{ alignItems: "flex-start" }}>
                      <OutcomeIcon o={ro} size={14} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <span className="tabular">{absolute(runTime(r))}</span>
                          <span className="xs muted tabular">{st && fin ? duration(fin.getTime() - st.getTime()) : ro === "running" ? "running" : "—"}</span>
                        </div>
                        {r.error && <div className="mono-12" style={{ color: "var(--outcome-failed)", wordBreak: "break-word" }}>{r.error}</div>}
                        {r.delivery_outcome && <div className="xs muted">delivery: {r.delivery_outcome}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {job.prompt && (
            <div className="section">
              <div className="eyebrow">Prompt</div>
              <div className="codeblock"><div className="codeblock-body plain-body" style={{ maxHeight: 280, overflow: "auto" }}>{job.prompt}</div></div>
            </div>
          )}
          <a className="btn btn-secondary" style={{ alignSelf: "flex-start" }} href={href("calendar", { agents: profile })}>View in Calendar</a>
        </>
      )}
    </Drawer>
  );
}
