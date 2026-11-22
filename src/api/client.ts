// Typed fetch wrapper + token store + shared polling cache.
// - Token lives in localStorage "mc.token" and is sent as `Authorization: Bearer`.
// - A 401 clears the token and notifies subscribers, so the shell re-renders the token form.
// - useApi(path, interval) shares one fetch/poll per path across all mounted components.

import { useEffect, useSyncExternalStore } from "react";
import type {
  AgentsResponse, CronJobsResponse, CronRunsResponse, DashboardSummary, KanbanResponse,
  MemoryResponse, OfficeStateResponse, OpenClawAgentsResponse, SessionsResponse, SkillsResponse, ToolsResponse,
  UsageLimits, UsageSummary,
} from "./types";

const TOKEN_KEY = "mc.token";

// ---------- token store ----------
type Listener = () => void;
const tokenListeners = new Set<Listener>();
let tokenCache: string | null = readToken();

function readToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return tokenCache;
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: keep it in memory only */
  }
  tokenCache = token;
  if (!token) cache.clear();
  tokenListeners.forEach((l) => l());
}
export function useToken(): string | null {
  return useSyncExternalStore(
    (l) => { tokenListeners.add(l); return () => tokenListeners.delete(l); },
    getToken,
  );
}

// ---------- fetch ----------
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiGet<T>(path: string, opts: { token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const token = opts.token ?? getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : { Accept: "application/json" },
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    connection.set(false);
    throw new ApiError(0, `Network error: ${(e as Error).message}`);
  }
  connection.set(true);
  if (res.status === 401) {
    // Only clear the stored token when it was the one used (not a candidate being validated).
    if (!opts.token) setToken(null);
    throw new ApiError(401, "Unauthorized: token missing or rejected");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch { /* not JSON */ }
    throw new ApiError(res.status, `HTTP ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

// Typed endpoint paths.
export const endpoints = {
  agents: "/api/agents",
  tools: "/api/agents/tools",
  office: "/api/office/state",
  openclaw: "/api/openclaw/agents",
  summary: "/api/dashboard/summary",
  kanban: "/api/kanban/tasks",
  cronJobs: "/api/cron/jobs",
  cronRuns: "/api/cron/runs?limit=1000",
  sessions: "/api/activity/sessions?limit=1000",
  usage: "/api/usage/summary?days=30",
  usageLimits: "/api/usage/limits",
  memory: (p: string): MemoryPath => `/api/memory/${encodeURIComponent(p)}`,
  skills: (p: string): SkillsPath => `/api/skills/${encodeURIComponent(p)}`,
} as const;

export interface EndpointTypes {
  "/api/agents": AgentsResponse;
  "/api/agents/tools": ToolsResponse;
  "/api/office/state": OfficeStateResponse;
  "/api/openclaw/agents": OpenClawAgentsResponse;
  "/api/dashboard/summary": DashboardSummary;
  "/api/kanban/tasks": KanbanResponse;
  "/api/cron/jobs": CronJobsResponse;
  "/api/cron/runs?limit=1000": CronRunsResponse;
  "/api/activity/sessions?limit=1000": SessionsResponse;
  "/api/usage/summary?days=30": UsageSummary;
  "/api/usage/limits": UsageLimits;
}
export type MemoryPath = `/api/memory/${string}`;
export type SkillsPath = `/api/skills/${string}`;
type PathData<P extends string> = P extends keyof EndpointTypes ? EndpointTypes[P]
  : P extends MemoryPath ? MemoryResponse
  : P extends SkillsPath ? SkillsResponse
  : unknown;

// ---------- connection + freshness (global, for top bar / footer) ----------
interface ConnState { reachable: boolean | null; lastSuccess: number | null; fetching: number }
let conn: ConnState = { reachable: null, lastSuccess: null, fetching: 0 };
const connListeners = new Set<Listener>();
const connection = {
  set(reachable: boolean) {
    if (conn.reachable !== reachable) { conn = { ...conn, reachable }; connListeners.forEach((l) => l()); }
  },
  patch(p: Partial<ConnState>) { conn = { ...conn, ...p }; connListeners.forEach((l) => l()); },
};
export function useConnection(): ConnState {
  return useSyncExternalStore((l) => { connListeners.add(l); return () => connListeners.delete(l); }, () => conn);
}

// ---------- shared polling cache ----------
export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;       // true only until the first response (success or error)
  fetching: boolean;      // any request in flight
  updatedAt: number | null;
}

interface Entry {
  state: ApiState<unknown>;
  listeners: Set<Listener>;
  intervals: Map<symbol, number>;
  timer: number | null;
  inflight: AbortController | null;
}
const cache = new Map<string, Entry>();
const EMPTY: ApiState<unknown> = { data: undefined, error: null, loading: true, fetching: false, updatedAt: null };

function entry(path: string): Entry {
  let e = cache.get(path);
  if (!e) {
    e = { state: EMPTY, listeners: new Set(), intervals: new Map(), timer: null, inflight: null };
    cache.set(path, e);
  }
  return e;
}

function emit(e: Entry, patch: Partial<ApiState<unknown>>) {
  e.state = { ...e.state, ...patch };
  e.listeners.forEach((l) => l());
}

export async function refetch(path: string) {
  const e = entry(path);
  if (e.inflight || !getToken()) return;
  const ctrl = new AbortController();
  e.inflight = ctrl;
  emit(e, { fetching: true });
  connection.patch({ fetching: conn.fetching + 1 });
  try {
    const data = await apiGet<unknown>(path, { signal: ctrl.signal });
    const now = Date.now();
    emit(e, { data, error: null, loading: false, fetching: false, updatedAt: now });
    connection.patch({ lastSuccess: now });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      emit(e, { error: err as ApiError, loading: false, fetching: false });
    }
  } finally {
    e.inflight = null;
    connection.patch({ fetching: Math.max(0, conn.fetching - 1) });
  }
}

export function refetchAll() {
  cache.forEach((e, path) => { if (e.listeners.size) void refetch(path); });
}

function reschedule(path: string, e: Entry) {
  if (e.timer !== null) { window.clearInterval(e.timer); e.timer = null; }
  if (!e.intervals.size) return;
  const ms = Math.min(...e.intervals.values());
  e.timer = window.setInterval(() => { if (!document.hidden) void refetch(path); }, ms);
}

/** Subscribe to a GET endpoint. All components using the same path share one request/poll. */
export function useApi<P extends string>(path: P | null, intervalMs = 30_000): ApiState<PathData<P>> {
  const state = useSyncExternalStore(
    (l) => {
      if (!path) return () => {};
      const e = entry(path);
      e.listeners.add(l);
      return () => e.listeners.delete(l);
    },
    () => (path ? entry(path).state : EMPTY),
  );

  useEffect(() => {
    if (!path) return;
    const e = entry(path);
    const id = Symbol(path);
    e.intervals.set(id, intervalMs);
    reschedule(path, e);
    const stale = !e.state.updatedAt || Date.now() - e.state.updatedAt > intervalMs / 2;
    if (stale) void refetch(path);
    const onVisible = () => { if (!document.hidden) void refetch(path); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      e.intervals.delete(id);
      reschedule(path, e);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, intervalMs]);

  return state as ApiState<PathData<P>>;
}

/** Unauthenticated health check (for the API connection dot and outage banner). */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch("/health", { headers: { Accept: "application/json" } });
    const ok = res.ok && (await res.json())?.status === "ok";
    connection.set(ok);
    return ok;
  } catch {
    connection.set(false);
    return false;
  }
}
