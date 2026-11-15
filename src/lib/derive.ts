// Pure derivations from API responses. Nothing here invents data: every number is computed from
// fields the API returned, and "unknown" stays null so the UI can say "Not Available".
import type { CronJob, CronRun, OfficeState, Session, SessionsResponse, ToolState } from "../api/types";
import type { BadgeStatus } from "../components/ui/StatusBadge";
import { identity } from "../theme/agents";
import { startOfDay, toDate } from "./time";

export type Outcome = "success" | "failed" | "running" | "scheduled";

export function runOutcome(r: CronRun): Outcome {
  const s = (r.status || "").toLowerCase();
  if (["completed", "ok", "success", "succeeded"].includes(s)) return "success";
  if (s === "failed" || s === "error" || s.startsWith("blocked")) return "failed";
  if (["running", "claimed", "started"].includes(s) || !r.finished_at) return "running";
  return r.error ? "failed" : "success";
}

export function runTime(r: CronRun): Date | null {
  return toDate(r.started_at) ?? toDate(r.claimed_at) ?? toDate(r.scheduled_instant);
}

export function jobFailing(j: CronJob): boolean {
  if ((j.failure_streak ?? 0) > 0) return true;
  const s = (j.last_status ?? "").toLowerCase();
  return !!s && s !== "ok" && s !== "running";
}

export interface CronHealth { total: number; healthy: number; failing: CronJob[]; neverRun: number }
export function cronHealth(jobs: CronJob[] | undefined): CronHealth | null {
  if (!jobs) return null;
  const failing = jobs.filter(jobFailing);
  const neverRun = jobs.filter((j) => !j.last_status && !jobFailing(j)).length;
  return { total: jobs.length, healthy: jobs.filter((j) => (j.last_status ?? "").toLowerCase() === "ok" && !jobFailing(j)).length, failing, neverRun };
}

export function jobOutcome(j: CronJob, runs?: CronRun[]): Outcome {
  if (runs?.some((r) => r.job_id === j.id && r.profile === j.profile && runOutcome(r) === "running")) return "running";
  if (jobFailing(j)) return "failed";
  if ((j.last_status ?? "").toLowerCase() === "ok") return "success";
  return "scheduled";
}

/** Officially "every N min" style label; falls back to the API's display string. */
export function humanSchedule(j: CronJob): string {
  const s = j.schedule;
  if (s?.kind === "interval" && typeof s.minutes === "number") {
    const m = s.minutes;
    if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
    return `Every ${m} min`;
  }
  return j.schedule_display ?? (typeof s?.display === "string" ? s.display : "Not Available");
}

// ---------- agent / tool status vocabulary ----------
export function officeBadge(s: OfficeState | undefined | null): BadgeStatus {
  return s ?? "unknown";
}
export function toolBadge(s: ToolState | undefined | null): BadgeStatus {
  if (s === "working") return "running";
  if (s === "idle") return "not_running";
  return "unknown";
}

// ---------- sessions ----------
export function sessionsByProfile(r: SessionsResponse | undefined): Map<string, Session[]> {
  const m = new Map<string, Session[]>();
  r?.sessions.forEach((s) => {
    const list = m.get(s.profile) ?? [];
    list.push(s);
    m.set(s.profile, list);
  });
  return m;
}

export function sessionStart(s: Session): Date | null {
  return toDate(s.started_at_iso) ?? toDate(s.started_at);
}

/** Sessions started since local midnight. `exact` is false when the API list was truncated. */
export function sessionsToday(r: SessionsResponse | undefined, profile?: string): { n: number; exact: boolean } | null {
  if (!r) return null;
  const midnight = startOfDay(new Date()).getTime();
  const list = profile ? r.sessions.filter((s) => s.profile === profile) : r.sessions;
  const n = list.filter((s) => (sessionStart(s)?.getTime() ?? 0) >= midnight).length;
  const truncated = r.total != null && r.count < r.total;
  const oldest = r.sessions[r.sessions.length - 1];
  const exact = !truncated || (sessionStart(oldest)?.getTime() ?? 0) < midnight;
  return { n, exact };
}

export function profileSessionTotal(r: SessionsResponse | undefined, profile: string): number | null {
  const p = r?.profiles.find((x) => x.profile === profile);
  return p ? p.total : null;
}

/** Sessions per hour over the last 24h (24 buckets, oldest first). */
export function hourlySessions(r: SessionsResponse | undefined): number[] | null {
  if (!r) return null;
  const now = Date.now();
  const buckets = new Array(24).fill(0);
  r.sessions.forEach((s) => {
    const t = sessionStart(s)?.getTime();
    if (t == null) return;
    const ago = Math.floor((now - t) / 3_600_000);
    if (ago >= 0 && ago < 24) buckets[23 - ago] += 1;
  });
  return buckets;
}

export function sessionDescription(s: Session): string {
  if (s.title) return s.title;
  if (s.display_name) return s.display_name;
  const src = s.source ?? "unknown";
  const msgs = s.message_count != null ? `${s.message_count} messages` : "message count not available";
  const act = s.last_activity_description ? ` · ${s.last_activity_description}` : "";
  return `${src} session · ${msgs}${act}`;
}

export function shortName(profile: string): string {
  return identity(profile).shortName;
}
