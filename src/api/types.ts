// Response shapes of the Agent Control Center API (from api/routers/*, verified against live data).

export type GatewayStatus = "running" | "stopped" | "unknown";
export type OfficeState = "working" | "reviewing" | "idle" | "offline" | "unknown";
export type ToolState = "working" | "idle" | "standby" | "offline" | "unknown";

export interface Agent {
  name: string;
  display_name: string;
  description: string | null;
  home: string;
  status: GatewayStatus;
  detail: string | null;
  gateway_pid: number | null;
}
export interface AgentsResponse { agents: Agent[]; count: number; source: string }

export interface Tool {
  name: string;
  kind: "tool";
  state: ToolState;
  process_count: number;
  pids: number[];
  detail: string | null;
}
export interface ToolsResponse { tools: Tool[]; source: string }

export interface OfficeAgent {
  name: string;
  display_name: string;
  state: OfficeState;
  state_reason: string;
  state_source?: "kanban" | "session" | null;
  current_task: { id: string | number; title?: string | null; status?: string; [k: string]: unknown } | null;
  current_task_id: string | number | null;
  last_activity: string | null;
  last_activity_at: string | null;
  active_ago_min: number | null;
  gateway: GatewayStatus;
  session_leases: { available: boolean; live_count: number | null; total: number | null; error: string | null };
  desk_index: number | null;
  agent_color: string; // backend placeholder; the UI uses the design-spec colors instead
}
export interface OfficeStateResponse {
  agents: OfficeAgent[];
  counts: Record<OfficeState, number>;
  desk_count: number;
  claude_tool: { name: string; state: ToolState; process_count: number; detail: string | null };
  kanban: { available: boolean; total: number | null; error: string | null };
  generated_at: string;
  source: string;
}

export interface DashboardSummary {
  agents: { total: number; source: string };
  kanban: {
    total: number | null;
    by_status: Record<string, number> | null;
    available: boolean;
    error: string | null;
    source: string;
  };
  cron: {
    jobs: number | null;
    runs_total: number | null;
    failed_total: number | null;
    recent_failures: number | null;
    recent_failures_window_hours: number;
    failure_definition: string;
    unreadable_profiles: string[];
    source: string;
  };
  activity: { sessions_24h: number | null; definition: string; unreadable_profiles: string[]; source: string };
  generated_at: string;
}

export interface KanbanTask {
  id: string | number;
  title: string | null;
  assignee: string | null;
  status: string;
  priority: number | string | null;
  created_by: string | null;
  created_at: string | number | null;
  started_at: string | number | null;
  completed_at: string | number | null;
  tenant: string | null;
  consecutive_failures: number | null;
}
export interface KanbanColumn { status: string; label: string; count: number; tasks: KanbanTask[] }
export interface KanbanResponse {
  count: number | null;
  returned: number | null;
  truncated: boolean;
  columns: KanbanColumn[] | null;
  available: boolean;
  error: string | null;
  source: string;
}

export interface CronJob {
  profile: string;
  id: string;
  name: string;
  prompt: string | null;
  schedule: { kind: string; minutes?: number; expr?: string; display?: string; [k: string]: unknown } | null;
  schedule_display: string | null;
  enabled: boolean;
  state: string | null;
  paused_at: string | null;
  paused_reason: string | null;
  created_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_failure: { at: string; detail: string } | null;
  failure_streak: number | null;
  deliver: string | null;
  model: string | null;
  [k: string]: unknown;
}
export interface CronJobsResponse {
  jobs: CronJob[];
  count: number;
  profiles: { profile: string; jobs_file_present: boolean; count: number | null; error: string | null }[];
  source: string;
}

export interface CronRun {
  profile: string;
  id: string;
  job_id: string;
  source: string | null;
  status: string; // completed | failed | (running/claimed)
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  delivery_outcome: string | null;
  scheduled_instant: string | null;
}
export interface CronRunsResponse {
  runs: CronRun[];
  count: number | null;
  returned: number;
  limit_per_profile: number;
  profiles: { profile: string; available: boolean; total: number | null; error: string | null }[];
  source: string;
}

export interface Session {
  profile: string;
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  display_name: string | null;
  started_at: number | null;
  ended_at: number | null;
  end_reason: string | null;
  last_activity_at: number | null;
  last_activity_description: string | null;
  message_count: number | null;
  tool_call_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  parent_session_id: string | null;
  started_at_iso: string | null;
  ended_at_iso: string | null;
  last_activity_at_iso: string | null;
}
export interface SessionsResponse {
  sessions: Session[];
  count: number;
  total: number | null;
  limit: number;
  profiles: { profile: string; available: boolean; total: number | null; error: string | null }[];
  source: string;
}

export interface MemoryFile {
  exists: boolean;
  content: string | null;
  error: string | null;
  size_bytes: number | null;
  sha256?: string | null;
  updated_at: string | null;
  identical_to_default?: boolean | null;
  source: string;
}
export interface MemoryResponse { profile: string; memory: MemoryFile; user: MemoryFile }

export interface Skill { dir: string; folder: string; category: string | null; name: string; description: string | null }
export interface SkillsResponse {
  profile: string;
  skills: Skill[];
  count: number;
  skills_dir_present: boolean;
  definition: string;
  source: string;
}

// /api/openclaw/agents (read-only OpenClaw team; never transcripts or secrets)
export interface OpenClawAgent {
  name: string;
  display_name: string;
  emoji: string | null;
  theme: string | null;
  model: string | null;            // provider prefix and @auth-profile suffix stripped
  model_inherited: boolean;        // true = from agents.defaults.model
  can_delegate_to: string[];
  gateway_status: "running" | "stopped" | "unknown";
  last_run_at: string | null;
  is_running: boolean;             // phase 1: always false (rule not yet validated)
  session_count: number;
  error: string | null;
}
export interface OpenClawAgentsResponse {
  agents: OpenClawAgent[];
  count: number;
  gateway: "running" | "stopped" | "unknown";
  gateway_detail: string;
  available: boolean;
  error: string | null;
  source: string;
}

// GET /api/usage/summary?days=N (api/sources/usage.py). total_tokens = input + output (cache excluded).
export interface UsageBucket {
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  actual_cost_usd: number;
}
export interface UsageSummary {
  generated_at: string;
  timezone: string | null;
  window_days: number;
  totals: { all_time: UsageBucket; today: UsageBucket; last_7_days: UsageBucket; window: UsageBucket };
  by_model: (UsageBucket & { model: string })[];
  by_profile: (UsageBucket & { profile: string })[];
  daily: (UsageBucket & { date: string })[];
  active_sessions: number;
  profiles: { profile: string; available: boolean; error: string | null; sessions: number; active_sessions: number }[];
  opencode: {
    available: boolean; provider: string | null; model: string | null; source: string; error: string | null;
    cost_available: false; note: string;
  };
  source: string;
}

// GET /api/usage/limits (api/sources/usage.py get_limits). Account-level rate-limit windows,
// NOT token totals — Claude via `hermes usage --json` (OAuth usage API); OpenCode has no
// readable limit data so it always reports unavailable.
export interface UsageLimitWindow {
  label: string;
  used_percent: number | null;
  remaining_percent: number;
  resets_at: string | null;
}
export interface UsageLimits {
  claude: {
    provider: string;
    windows: UsageLimitWindow[];
    available: boolean;
    unavailable_reason: string | null;
  };
}
