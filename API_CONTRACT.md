# Mission Control V2 — API Contract

Version 0.1.0 · backend commit `72bfdb6` or later · base URL `http://127.0.0.1:8742`
(in Vite dev, call the same relative paths from `http://127.0.0.1:5173`; Vite proxies `/api` and `/health`).

Verified live against this host's real Hermes data on 2026-11-15. Every example below is
trimmed from an actual response unless it says "illustrative".

## 0. Ground rules for frontend code

- **Auth.** Every `/api/*` route needs `Authorization: Bearer <token>`. The token is the
  `MISSION_CONTROL_V2_API_TOKEN` value in `.env`. The user pastes it into a token form once.
  Store it in `localStorage` (v1 used `mc_api_token`) and clear it on any 401. `/health` and the
  static frontend need no token.
- **Read-only.** All endpoints are `GET`. Nothing writes to `~/.hermes`.
- **Honesty fields.** Most responses carry `available` / `error` / `source`. When
  `available === false` or a value is `null`, show a specific empty or error state with the
  `error` or `source` text. Never render `null` as `0`. The backend never fills in a guessed value.
- **Timestamps.** `*_iso` fields and `generated_at` are ISO-8601 UTC. Raw `started_at`,
  `last_activity_at`, etc. on sessions are unix epoch seconds (float). Cron times are ISO strings
  with offsets (`+07:00`) exactly as Hermes stored them. Show them in WIB on screen.
- **Profiles.** There are 4: `bagas_dev_lead`, `default` (Hawa The Second, data at `~/.hermes`
  itself), `pratama_cto`, `susi_uiux`. Lists are sorted by profile name. Use `display_name`
  for people-facing labels.
- **State vocabulary** (lowercase everywhere in v2):
  - office/agent state: `working | reviewing | idle | offline | unknown`
  - gateway: `running | stopped | unknown`
  - Claude tool: `working | idle | unknown`
- **Polling.** The office view can poll `/api/office/state` every 5 s (one request, about 20 ms).
  Other views: 15–30 s or on focus.

### Errors (all endpoints)

| Status | When | Body |
|---|---|---|
| 401 | Missing, malformed or wrong bearer token | `{"detail": "Invalid or missing bearer token"}` + `WWW-Authenticate: Bearer` |
| 400 | Profile name fails `^[A-Za-z0-9_-]{1,64}$` (in-handler check) | `{"detail": "invalid profile name"}` |
| 422 | Path/query validation (bad profile chars, `limit` out of range) | FastAPI validation body |
| 404 | Profile directory doesn't exist | `{"detail": "profile 'x' not found"}` |

```ts
type ISODate = string;          // ISO-8601
type Epoch = number;            // unix seconds, float
type ProfileName = string;      // "bagas_dev_lead" | "default" | "pratama_cto" | "susi_uiux" | ...
type AgentState = "working" | "reviewing" | "idle" | "offline" | "unknown";
type GatewayStatus = "running" | "stopped" | "unknown";
type ToolState = "working" | "idle" | "unknown";
```

---

## 1. `GET /health`

Auth: **no**. Liveness only.

```ts
interface Health { status: "ok" }
```
```json
{"status": "ok"}
```

---

## 2. `GET /api/office/state` ← main feed for the 3D office

Auth: yes. No params.
Sources: `<profile>/gateway.lock` + `/proc` (gateway), `~/.hermes/kanban.db: tasks` (Running/Review
claims), `<profile>/state.db: sessions` (last activity), `<profile>/runtime/active_sessions.json`
(leases), `/proc/*/cmdline` (Claude Code CLI). Composed server-side in `api/sources/office.py`.

**State rules** (first match wins; `state_reason` always says which rule fired):

1. `unknown`: gateway status unknown, or kanban.db unreadable, or this profile's state.db unreadable
2. `offline`: gateway.lock is stale (pid dead or reused). Beats a Running task.
3. `working`: a kanban task assigned to this profile is in **Running**
4. `reviewing`: a kanban task assigned to this profile is in **Review** (task is in the Review
   column; that doesn't prove anyone is reviewing it now)
5. `working`: no kanban claim, but `session_leases.live_count > 0` **and** the profile's
   `state.db` `last_activity_at` is less than 10 minutes ago (`state_source: "session"`).
   Both are required: a CLI left open holds a lease forever, and a just-ended session has fresh
   activity with nobody working.
6. `idle`: everything else

`state_source` says where a `working`/`reviewing` state came from: `"kanban"` (rules 3/4),
`"session"` (rule 5), else `null`. The state value set is unchanged (no new `active` value).

```ts
interface OfficeState {
  agents: OfficeAgent[];                       // sorted by name; always one per profile
  counts: Record<AgentState, number>;
  desk_count: number;                          // 4
  claude_tool: {
    name: "Claude Code CLI";
    agent_color: string;                       // "#F97316" (--agent-claude)
    state: ToolState;
    process_count: number;                     // live `claude -p` processes
    detail: string;
  };
  kanban: { available: boolean; total: number | null; error: string | null };
  generated_at: ISODate;
  source: string;
}

interface OfficeAgent {
  name: ProfileName;
  display_name: string;                        // profile.yaml description, else name
  state: AgentState;
  state_reason: string;                        // one line, human-readable; use as the status tooltip
  state_source: "kanban" | "session" | null;   // which rule produced working/reviewing; null otherwise
  current_task: string | null;                 // kanban title when working/reviewing
  current_task_id: string | null;
  last_activity: string | null;                // state.db sessions.last_activity_description ("" -> null)
  last_activity_at: ISODate | null;            // from the most recently active session
  active_ago_min: number | null;               // only for idle agents active < 15 min ago
  gateway: GatewayStatus;
  session_leases: {                            // open chat sessions (feed rule 5)
    available: boolean; live_count: number | null; total: number | null; error: string | null;
  };
  desk_index: number | null;                   // 0..3 = fixed seat by profile order; null if > 4 profiles
  agent_color: string;                         // spec dark-theme --agent-* hex; "#9AA0A6" for unknown profiles
}
```

Desk order today: 0 `bagas_dev_lead`, 1 `default` (Hawa), 2 `pratama_cto`, 3 `susi_uiux`.
`agent_color` is the dark-theme reference value. 2D UI should use the theme-aware CSS tokens
(`--agent-hawa`, etc.). The 3D scene can use the hex directly, since it always renders dark.

```json
{
  "agents": [
    {
      "name": "bagas_dev_lead",
      "display_name": "Bagas Developer Lead yang menjadi leader para developer",
      "state": "idle",
      "state_reason": "gateway running; no Running/Review task assigned to bagas_dev_lead among 0 kanban task(s)",
      "current_task": null,
      "current_task_id": null,
      "last_activity": "receiving stream response",
      "last_activity_at": "2026-11-15T14:46:07.157004+00:00",
      "active_ago_min": 0,
      "gateway": "running",
      "session_leases": {"available": true, "live_count": 0, "total": 0, "error": null},
      "desk_index": 0,
      "agent_color": "#84CC16"
    }
  ],
  "counts": {"working": 0, "reviewing": 0, "idle": 4, "offline": 0, "unknown": 0},
  "desk_count": 4,
  "claude_tool": {"name": "Claude Code CLI", "agent_color": "#F97316", "state": "idle",
                  "process_count": 0, "detail": "no `claude -p` process found among 148 processes in /proc"},
  "kanban": {"available": true, "total": 0, "error": null},
  "generated_at": "2026-11-15T14:46:14.341371+00:00",
  "source": "gateway.lock + /proc (gateway), ~/.hermes/kanban.db: tasks (claims), ..."
}
```

---

## 3. `GET /api/agents`

Auth: yes. No params.
Source: `~/.hermes/profiles/*` + `~/.hermes` (default). Status from `gateway.lock` + `/proc/<pid>/stat`
starttime (protects against pid reuse). Description from `profile.yaml`.

```ts
interface AgentsResponse { agents: Agent[]; count: number; source: string }
interface Agent {
  name: ProfileName;
  display_name: string;
  description: string | null;      // raw profile.yaml description
  home: string;                    // "~/.hermes" | "~/.hermes/profiles/<name>"
  status: GatewayStatus;
  detail: string | null;           // why that status
  gateway_pid: number | null;
}
```
```json
{
  "agents": [
    {"name": "default", "display_name": "Hawa The Second", "description": "Hawa The Second",
     "home": "~/.hermes", "status": "running",
     "detail": "gateway pid 14190 alive; /proc starttime matches gateway.lock (8326984)", "gateway_pid": 14190}
  ],
  "count": 4,
  "source": "~/.hermes/profiles/* and ~/.hermes (default profile) (...)"
}
```
Note: all four profiles are currently served by one gateway process (same pid in each lock).

## 4. `GET /api/agents/tools`

Auth: yes. Source: `/proc/*/cmdline`. argv match: program `claude` (or node/bun running `claude`)
with its own `-p`/`--print` argument. Many processes collapse into one entity.

```ts
interface ToolsResponse {
  tools: { name: "Claude Code CLI"; kind: "tool"; state: ToolState; process_count: number;
           pids: number[]; detail: string }[];
  source: string;
}
```
```json
{"tools": [{"name": "Claude Code CLI", "kind": "tool", "state": "working", "process_count": 1,
            "pids": [89323], "detail": "1 live `claude -p` process (pid 89323)"}],
 "source": "process scan of /proc/*/cmdline (argv match: claude ... -p|--print)"}
```

---

## 5. `GET /api/dashboard/summary`

Auth: yes. Sources: kanban.db, every profile's `cron/jobs.json` + `cron/executions.db`, every profile's `state.db`.
A `null` count means "could not be determined". Check `unreadable_profiles`.

```ts
interface DashboardSummary {
  agents: { total: number; source: string };
  kanban: { total: number | null; by_status: Record<string, number> | null;
            available: boolean; error: string | null; source: string };
  cron: {
    jobs: number | null; runs_total: number | null; failed_total: number | null;
    recent_failures: number | null; recent_failures_window_hours: number;  // 168
    failure_definition: string; unreadable_profiles: ProfileName[]; source: string;
  };
  activity: { sessions_24h: number | null; definition: string;
              unreadable_profiles: ProfileName[]; source: string };
  generated_at: ISODate;
}
```
```json
{
  "agents": {"total": 4, "source": "..."},
  "kanban": {"total": 0, "by_status": {"triage": 0, "todo": 0, "scheduled": 0, "ready": 0, "running": 0,
             "blocked": 0, "review": 0, "done": 0, "archived": 0}, "available": true, "error": null, "source": "..."},
  "cron": {"jobs": 2, "runs_total": 46, "failed_total": 6, "recent_failures": 6,
           "recent_failures_window_hours": 168, "failure_definition": "executions.status = 'failed'",
           "unreadable_profiles": [], "source": "..."},
  "activity": {"sessions_24h": 37, "definition": "sessions with started_at in the last 24h",
               "unreadable_profiles": [], "source": "..."},
  "generated_at": "2026-11-15T14:44:03.515815+00:00"
}
```

---

## 6. `GET /api/kanban/tasks`

Auth: yes. Source: `~/.hermes/kanban.db: tasks` (up to 2000, ordered by priority desc, created_at desc).
Columns are Hermes' default workflow plus `archived`. Any unexpected status gets its own column at the end.

```ts
interface KanbanResponse {
  count: number | null;          // all tasks in DB
  returned: number | null;
  truncated: boolean;
  columns: KanbanColumn[] | null; // null when unavailable
  available: boolean; error: string | null; source: string;
}
interface KanbanColumn { status: string; label: string; count: number; tasks: KanbanTask[] }
interface KanbanTask {
  id: string; title: string; assignee: ProfileName | null; status: string; priority: number | null;
  created_by: string | null; created_at: number | null; started_at: number | null;
  completed_at: number | null; tenant: string | null; consecutive_failures: number | null;
}
```
Column order: `triage, todo, scheduled, ready, running, blocked, review, done, archived`.
The board is **empty today** (`count: 0`). Show the honest empty state.

---

## 7. `GET /api/cron/jobs`

Auth: yes. Source: `<profile>/cron/jobs.json` (Hermes' own job store), all profiles.
Job objects are **passed through as Hermes stores them** plus `profile`. Only the fields below
are treated as stable. Others may change with Hermes versions.

```ts
interface CronJobsResponse {
  jobs: CronJob[]; count: number;
  profiles: { profile: ProfileName; jobs_file_present: boolean; count: number | null; error: string | null }[];
  source: string;
}
interface CronJob {
  profile: ProfileName; id: string; name: string; prompt: string;
  schedule: { kind: string; minutes?: number; expr?: string; display: string };
  schedule_display: string;
  enabled: boolean; state: string;                  // e.g. "scheduled", "paused"
  created_at: ISODate; next_run_at: ISODate | null; last_run_at: ISODate | null;
  last_status: string | null;                       // "ok" | "error" | ...
  last_error: string | null; failure_streak: number;
  repeat: { times: number | null; completed: number };
  [passthrough: string]: unknown;                   // origin, deliver, enabled_toolsets, last_dispatch, ...
}
```
Privacy: passthrough includes `origin` (Telegram chat_id/user_id) and full prompts. Don't render
`origin` in the UI.

## 8. `GET /api/cron/runs`

Auth: yes. Query: `limit` (int, 1–5000, default 200) **per profile**.
Source: `<profile>/cron/executions.db: executions`, newest `claimed_at` first within each profile.
The merged list is **not** globally re-sorted. Sort client-side.

```ts
interface CronRunsResponse {
  runs: CronRun[];
  count: number | null;           // total rows across all profiles
  returned: number; limit_per_profile: number;
  profiles: { profile: ProfileName; available: boolean; total: number | null; error: string | null }[];
  source: string;
}
interface CronRun {
  profile: ProfileName; id: string; job_id: string; source: string;
  status: "claimed" | "running" | "completed" | "failed" | "unknown" | "cancelled" | "missed";
  claimed_at: ISODate; started_at: ISODate | null; finished_at: ISODate | null;
  error: string | null; delivery_outcome: string | null; scheduled_instant: ISODate | null;
}
```
"Failed" means `status === "failed"`. No run output log is stored (only `error`).

---

## 9. `GET /api/activity/sessions`

Auth: yes. Query: `limit` (int, 1–1000, default 50).
Source: every profile's `state.db: sessions` (+ `messages` count). Newest `started_at` first,
merged across profiles, cut to `limit`.

```ts
interface SessionsResponse {
  sessions: Session[];
  count: number;                  // returned
  total: number | null;           // all sessions in all state.dbs
  limit: number;
  profiles: { profile: ProfileName; available: boolean; total: number | null; error: string | null }[];
  source: string;
}
interface Session {
  profile: ProfileName; id: string; source: string;        // "oneshot" | "telegram" | "cli" | ...
  model: string | null; title: string | null; display_name: string | null;
  started_at: Epoch; ended_at: Epoch | null; end_reason: string | null;
  last_activity_at: Epoch | null; last_activity_description: string | null;  // may be ""
  message_count: number | null; tool_call_count: number | null;
  input_tokens: number | null; output_tokens: number | null;
  estimated_cost_usd: number | null; actual_cost_usd: number | null;
  parent_session_id: string | null; archived: 0 | 1; hidden: 0 | 1;
  messages_in_db: number;
  started_at_iso: ISODate; ended_at_iso: ISODate | null; last_activity_at_iso: ISODate | null;
}
```
"Open" session = `ended_at === null`. Per-agent model can be read from that agent's most recent session.

---

## 10. `GET /api/memory/{profile}`

Auth: yes. Path: `profile` matches `^[A-Za-z0-9_-]{1,64}$`. Unknown profile returns 404.
Source: `<profile home>/memories/MEMORY.md` and `USER.md`, returned verbatim.

```ts
interface MemoryResponse { profile: ProfileName; memory: MemoryFile; user: MemoryFile }
interface MemoryFile {
  exists: boolean;
  content: string | null;              // verbatim UTF-8; null if missing/unreadable/non-UTF-8
  error: string | null;
  size_bytes: number | null;
  sha256: string | null;
  updated_at: ISODate | null;          // file mtime
  identical_to_default: boolean | null; // byte-identical to default profile's file; null = n/a
  source: string;                       // e.g. "~/.hermes/profiles/susi_uiux/memories/MEMORY.md"
}
```
Entries in MEMORY.md are separated by a line containing only `§` (split client-side, per the design spec).
Today's state:

| profile | MEMORY.md | USER.md |
|---|---|---|
| default | exists (1297 B) | exists (205 B) |
| pratama_cto | exists, own content | missing |
| susi_uiux | exists, `identical_to_default: true` | exists, `identical_to_default: true` |
| bagas_dev_lead | missing | missing |

```json
{"profile": "bagas_dev_lead",
 "memory": {"exists": false, "content": null, "error": null, "size_bytes": null, "sha256": null,
            "updated_at": null, "identical_to_default": null,
            "source": "~/.hermes/profiles/bagas_dev_lead/memories/MEMORY.md"},
 "user":   {"exists": false, "content": null, "error": null, "size_bytes": null, "sha256": null,
            "updated_at": null, "identical_to_default": null,
            "source": "~/.hermes/profiles/bagas_dev_lead/memories/USER.md"}}
```

---

## 11. `GET /api/skills/{profile}`

Auth: yes. Path as above. Source: `<profile home>/skills/`. A skill is any directory (excluding
dot-dirs, not following symlinks) that directly contains `SKILL.md`. `name`/`description` come from
its YAML frontmatter.

```ts
interface SkillsResponse {
  profile: ProfileName; skills: Skill[]; count: number;
  skills_dir_present: boolean; definition: string; source: string;
}
interface Skill {
  dir: string;                 // path relative to skills/, e.g. "apple/apple-notes"
  folder: string;              // "apple-notes"
  category: string | null;     // "apple"; null for top-level skills
  name: string | null;
  description: string | null;
}
```
```json
{"profile": "pratama_cto",
 "skills": [{"dir": "apple/apple-notes", "folder": "apple-notes", "category": "apple",
             "name": "apple-notes", "description": "Manage Apple Notes via memo CLI: create, search, edit."}],
 "count": 44, "skills_dir_present": true, "definition": "...", "source": "~/.hermes/profiles/pratama_cto/skills/"}
```

---

## 12. Not in the API yet (gaps vs. Susi's design spec)

These are honest gaps. Show "Not available" in the UI until a backend endpoint exists.

| Spec element | Status |
|---|---|
| Skill drawer showing SKILL.md body | No endpoint. Candidate: `GET /api/skills/{profile}/{dir}`. |
| Cron "run log" output | Not stored by Hermes (executions has `error` only). |
| Memory usage meter (chars vs budget) | Budget limit not exposed. `size_bytes` only. |
| Activity "Task" / "System" event types | Only sessions (§9) and cron runs (§8) exist. No kanban event feed yet. |
| Spec "Unknown" tooltip ("no heartbeat in 30 min") | Use `state_reason` instead. That's the real rule. |
| Per-agent model/provider on the card | Derive from the agent's latest session `model`. Provider not exposed. |

Production frontend: `npm run build` writes `dist/`. FastAPI serves it at `/` when `dist/index.html`
exists. There is no SPA history fallback yet, so use hash routing or query params, or ask backend to add one.
