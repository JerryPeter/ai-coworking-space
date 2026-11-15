// Activity events built from real API records: sessions (state.db) and cron runs (executions.db).
// There is no kanban/system event feed in the API yet, so those types simply have no events.
import type { CronJob, CronRun, Session } from "../api/types";
import { runOutcome, runTime, sessionDescription, sessionStart, type Outcome } from "./derive";

export type EventType = "session" | "cron" | "task" | "system";

export interface ActivityEvent {
  key: string;
  profile: string;
  type: EventType;
  time: Date;
  description: string;
  outcome?: Outcome;
  meta?: string;
  open?: { agent?: string; tab?: string; job?: string };
}

export function buildEvents(sessions: Session[] | undefined, runs: CronRun[] | undefined, jobs: CronJob[] | undefined): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const jobName = (r: CronRun) => jobs?.find((j) => j.id === r.job_id && j.profile === r.profile)?.name ?? `job ${r.job_id}`;
  sessions?.forEach((s) => {
    const t = sessionStart(s);
    if (!t) return;
    const bits = [s.model, s.tool_call_count != null ? `${s.tool_call_count} tool calls` : null, s.ended_at == null ? "open" : null].filter(Boolean);
    out.push({
      key: `s:${s.profile}:${s.id}`, profile: s.profile, type: "session", time: t,
      description: sessionDescription(s), meta: bits.join(" · "),
      open: { agent: s.profile, tab: "sessions" },
    });
  });
  runs?.forEach((r) => {
    const t = runTime(r);
    if (!t) return;
    const oc = runOutcome(r);
    out.push({
      key: `r:${r.profile}:${r.id}`, profile: r.profile, type: "cron", time: t,
      description: `Cron run: ${jobName(r)}${r.error ? ` — ${r.error}` : ""}`,
      outcome: oc, meta: r.delivery_outcome ? `delivery: ${r.delivery_outcome}` : undefined,
      open: { job: `${r.profile}:${r.job_id}` },
    });
  });
  out.sort((a, b) => b.time.getTime() - a.time.getTime());
  return out;
}
