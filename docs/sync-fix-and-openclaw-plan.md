# Mission Control V2: agent-state sync fix + OpenClaw integration plan

Author: Pratama (CTO) · 2026-11-16 · Status: spec only, no code changed yet
Repo state inspected: `main` @ d80b675. OpenClaw 2026.11.3 (per `meta.lastTouchedVersion`).

---

## Issue 1: agent state does not reflect real activity

### 1.1 Current logic (confirmed in code)

`api/sources/office.py::_agent_state` (lines 45-74) decides the state. `working` is returned only
at line 66-68 (a kanban task in Running assigned to the profile). Leases are read at line 91,
*after* the state is decided, and are passed through as info only (docstring line 20 and
`API_CONTRACT.md` line 81 both say so explicitly).

`api/sources/profiles.py` needs no change. It only answers "is the gateway alive", and that part
is correct.

Live evidence (dry run at 14:26 WIB, this very session):

| profile | current | live leases | last activity | proposed |
|---|---|---|---|---|
| pratama_cto | idle | 1 (surface=cli) | 0.1 min ago, "receiving stream response" | **working** |
| default (Hawa) | idle | 0 | 3.4 min ago | idle |
| bagas_dev_lead | idle | 0 | 45.7 min ago | idle |
| susi_uiux | idle | 0 | 43.7 min ago | idle |

I was mid-turn writing this document and Mission Control showed me as idle.

### 1.2 New rule

First match wins. Rules 1-4 are unchanged; 5 is new; 6 is the old rule 5.

1. unknown: gateway status unknown, kanban unreadable, or state.db unreadable
2. offline: gateway.lock stale
3. working: kanban task in Running (`state_source = "kanban"`)
4. reviewing: kanban task in Review (`state_source = "kanban"`)
5. **working: `session_leases.live_count > 0` AND `last_activity_at` less than 10 min ago
   (`state_source = "session"`)**
6. idle: everything else

Both conditions are required, and each covers the other's weakness:

- Lease alone is not enough. A CLI left open at the prompt holds a live lease forever.
- Recency alone is not enough. A session that just ended has fresh activity but nobody is working.
- The lease's own `updated_at` cannot be used for recency. In the live file it equals `started_at`
  (written once, never heartbeated). Recency must come from `state.db` `sessions.last_activity_at`.

**N = 10 minutes.** `last_activity_at` is refreshed at each turn start and during streaming, but not
while a tool is blocking. The longest foreground tool call is 600 s, so 10 min is the smallest
window that does not flicker to idle in the middle of a legitimate turn. 30 min would keep an
abandoned-but-open CLI showing "working" for half an hour, which is the dishonesty we are fixing.
The cost of 10: a single tool call that runs longer than 10 min (background job, long delegation)
shows idle until the next activity write. Acceptable.

### 1.3 State name: reuse `working`, add `state_source`

Recommendation: do **not** add a new state value now. Return `working` and add a new field
`state_source: "kanban" | "session" | null`.

Reasons:

1. A new value crashes the UI as built. `StatusBadge.tsx` line 36 does `const d = DEFS[status]`
   then reads `d.token`. `officeBadge()` in `lib/derive.ts` passes the API value straight through,
   so `state: "active"` gives `d === undefined` and a TypeError in the Office legend, the Office
   table, `AgentCard` and `AgentDrawer`. `dist/` is prebuilt, so the running UI would break until
   a frontend change is built and deployed.
2. It is accurate. A live process plus activity in the last 10 minutes means the agent is
   processing a turn. That is work. The only thing lost is "tracked on the board or not", and
   `state_source` plus `state_reason` carry exactly that.
3. It is backend-only: one file, no rebuild, no design work. The office already does the right
   thing for `working` (walk to desk, type, screen on) and already shows `last_activity` as the
   label text (`Office.tsx` line 117).
4. It does not block the precise version. If Susi later wants a distinct "In session" look, the
   frontend can branch on `state_source === "session"` without another API change.

### 1.4 How the renderers treat an unknown state value (for the record)

If a new value such as `active` were sent anyway:

| place | behaviour |
|---|---|
| `characters.ts` `setState` (line 383) | anything not `idle` goes to the desk. No typing animation (line 465 checks `working` only), no dimming, no question box. Degrades fine. |
| `OfficeScene.ts` `updateDesk` (line 215) | screen and status strip stay black. Fine. |
| `PixelOfficeScene.ts` (lines 300, 313, 394, 454) | sits at desk, CRT off, no typing, dot falls back to grey via `?? "#6B7285"`. Fine. |
| `Office.tsx` `LABEL[a.state] ?? "Unknown"` | label text reads "Unknown". Misleading but no crash. |
| `StatusBadge.tsx` `DEFS[status]` | **crash** (see 1.3). |

So it does not fall into the renderer's "unknown" look (no question mark), but the badge breaks
the page. A new state needs changes in `api/types.ts`, `StatusBadge.tsx`, `Office.tsx`,
`tokens.css`, `palettes.ts`, `characters.ts`, `OfficeScene.ts`, `PixelOfficeScene.ts`, plus a build.

### 1.5 Exact change: `api/sources/office.py`

Add a constant next to `ACTIVE_WINDOW_MIN` (line 32):

```python
SESSION_ACTIVE_MIN = 10  # live lease + activity within this many minutes => working (no kanban claim needed)
```

Change the signature (line 45). The defaults keep the 9 existing test cases passing untouched:

```python
def _agent_state(info: dict, claims: dict, activity: dict,
                 leases: dict | None = None, now_ts: float | None = None) -> tuple[str, str, dict | None]:
```

Insert between the `if review:` block and the final `return ("idle", ...)` (before line 73):

```python
    live = (leases or {}).get("live_count") or 0
    sess = activity["session"]
    last = sess.get("last_activity_at") if sess else None
    if live > 0 and now_ts is not None and isinstance(last, (int, float)):
        age_s = now_ts - last
        if -60 <= age_s < SESSION_ACTIVE_MIN * 60:  # -60: tolerate small clock/rounding skew
            return ("working", f"{live} live session lease(s) and last activity {max(0, int(age_s // 60))} min ago "
                    f"(< {SESSION_ACTIVE_MIN} min); no kanban task claimed", None)
```

In `office_state()`: move `lz = session_leases(name)` (line 91) up to before line 84, then:

```python
        st, reason, task = _agent_state(info, claims, act, lz, now.timestamp())
```

and add one key to the agent dict:

```python
            "state_source": "kanban" if task else ("session" if st == "working" else None),
```

That is about 12 lines in one file. Also update:

- the module docstring (lines 11-20) and `API_CONTRACT.md` lines 72-82 and the `OfficeAgent` shape
  (new `state_source`); the sentence "Session leases and recency never change the state" becomes false
- `tests/test_office_rules.py`: add 4 cases: lease + fresh activity gives working with no task;
  lease + stale activity gives idle; fresh activity with no lease gives idle; kanban Running still
  wins over a session and returns the task
- optional, cosmetic: `src/api/types.ts` add `state_source?: "kanban" | "session" | null`, and fix
  the comment at `Office.tsx` lines 2-3. Not required for the fix to work.

### 1.6 Known limits after the fix

- Hawa shows working only while a turn is running. Between turns (for example while waiting on a
  delegated agent) its lease is gone and it shows idle. That matches reality.
- Gateway stopped + a live CLI session still shows offline, because rule 2 fires first. Left as-is
  to keep the change minimal. Worth revisiting if agents are often run by CLI with the gateway down.
- Recency comes from the profile's most recent session, not strictly the leased one. Matching
  lease `session_id` to the session row would be stricter. Not needed for v1.

---

## Issue 2: OpenClaw agents in Mission Control

### 2.1 Inspection findings

**CLI: not inspected.** `openclaw agents list` was blocked twice by the Hermes terminal lifecycle
guard (it could not scan the openclaw entry script), so it never ran. I did not work around the
guard. Everything below is from files and SQLite. This does not change the plan: the backend
should not shell out to a CLI that has hung before.

**Config, `~/.openclaw/openclaw.json` `agents` key**

- `agents.entries` has **4** agents, not 5: `chief`, `researcher`, `writer`, `reviewer`.
- Per entry: `name`, `workspace`, `agentDir`, `identity {name, emoji, theme}`,
  `subagents.allowAgents`. Only `chief` also has `model.primary` and a `models` map.
- `agents.defaults`: `model = anthropic/claude-opus-5-5` (runtime `claude-cli`),
  `systemAgent.agentId = chief`, `heartbeat.every = "0s"` (disabled).
- `chief` may delegate to the other three (`delegationMode: prefer`). The other three have empty
  `allowAgents`.
- The file also holds the gateway auth token and the Telegram bot token.

| id | identity | theme | configured model |
|---|---|---|---|
| chief | Chief of Staff 🧭 | calm, accountable coordination | openrouter/~openai/gpt-luna-latest |
| researcher | Researcher 🔎 | curious, evidence-led research | anthropic/claude-opus-5-5 (default) |
| writer | Writer ✍️ | clear, audience-aware writing | anthropic/claude-opus-5-5 (default) |
| reviewer | Reviewer 🔍 | careful, independent review | anthropic/claude-opus-5-5 (default) |

**The fifth directory, `agents/openclaw/`**, is not a team agent. It has no config entry, no
workspace, no `sessions/` dir and no row in `agent_provenance` (the other four are
`created_via = operator`). It has 3 runs in the audit log, all on 2026-11-15. It looks like
OpenClaw's built-in system agent; I could not confirm its exact role from files alone.

**Per-agent files**

- `~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite` (+ `-wal`, `-shm`, `.seal`): per-agent DB,
  schema v27: sessions, transcripts, memory index, auth profiles.
- `~/.openclaw/agents/<id>/sessions/`: exists but empty. Transcripts live in the SQLite DB.
- `~/.openclaw/workspace/<id>/`: `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `USER.md`, `.git`
  (chief also has `DREAMS.md`, `memory/`). This is the closest analogue of a Hermes profile dir.
- No `gateway.lock`, no `profile.yaml`, no per-agent process.

**Global DB, `~/.openclaw/state/openclaw.sqlite`** (WAL mode, about 110 tables, most empty). Useful ones:

| table | rows | use |
|---|---|---|
| `state_leases` (scope `gateway-owner`) | 1 | gateway liveness: `heartbeat_at`, `expires_at`, payload `owner.pid`, `owner.startedAt`, `port` |
| `gateway_boot_lifecycle` | 1 | gateway pid + boot time |
| `audit_events` | 231 | per-agent `agent.run.started/finished`, `tool.action.started/finished` with `agent_id`, `run_id`, `status`, `occurred_at` |
| `task_runs` | 51 | runs with `agent_id`, `status`, `started_at`, `ended_at`, `runtime` (all cron so far) |
| `agent_databases` | 5 | registry of agent DBs: `agent_id`, path, `last_seen_at`, size |
| `agent_provenance` | 4 | who created each agent, when |
| `cron_jobs`, `cron_run_receipts` | 2 / 51 | scheduled jobs and their runs |
| `worker_session_placements` | 2 | per-session `turn_claim_run_id` (NULL in both rows) |

Per-agent DB: `session_windows` (`status`, `started_at`, `ended_at`, `channel`, `model_provider`,
`model`, `display_name`), `session_nodes` (`last_activity_at`, `last_interaction_at`, `label`),
`transcript_events`.

Timestamps are epoch **milliseconds** (Hermes state.db uses seconds).

**Runtime**

- One gateway serves all agents: `openclaw-gateway.service` (systemd user unit), pid 86777,
  loopback port 18789, token auth, up since 2026-11-15 21:40 WIB.
- The `gateway-owner` lease heartbeat was 1 s old when read and expires 300 s after each heartbeat.
  Its `owner.startedAt` (12760335) equals `/proc/86777/stat` field 22 exactly. So the same
  pid + starttime check Mission Control already uses for Hermes `gateway.lock` works here.

**Activity so far**

- `chief`: 3 sessions (1 Telegram, 2 cron "Memory Dreaming Promotion"), last run finished
  2026-11-15 20:00 UTC, 27 succeeded / 33 failed / 1 cancelled runs.
- `researcher`, `writer`, `reviewer`: zero sessions, zero runs, ever. Their cards will be mostly empty.

### 2.2 Feasibility

Feasible, read-only, without touching OpenClaw. Verified: opening the live DB with the repo's
existing `ro_connect` (`mode=ro` + `PRAGMA query_only`) works while the gateway is running and
changed no file in `~/.openclaw/state/`.

Reliable:

- agent list, display name, emoji, theme, configured model, delegation targets (config)
- gateway running / stopped (lease + `/proc`), shared by all agents
- last run time and result per agent, run counts, tool-call counts (`audit_events`)
- session count, last session channel and actual model used (per-agent DB)
- cron jobs per agent

Not determinable, or not yet verified:

- **"Working" right now is unverified.** There is no per-agent session lease like Hermes
  `active_sessions.json`. The candidate signal is an `agent.run.started` row with no
  `agent.run.finished` for the same `run_id`. Nothing was running during inspection, so I have
  never seen an in-flight run in the data. The audit log also has 3 finished rows with no started
  row, so it is not perfectly paired. This rule must be checked against one real live run before
  it is trusted.
- Per-agent online/offline: there is one gateway, so all agents share one status.
- Cost and token totals: no plain column. A `session-cost-usage-projection` cache exists but it is
  a zstd blob in a private format.
- "Current task": no kanban equivalent. `task_runs` has only cron automation.
- The role of the `openclaw` system agent.

### 2.3 OpenClaw agent card

| field | source | notes |
|---|---|---|
| Name | `identity.name` | "Chief of Staff" |
| Avatar | `identity.emoji` | no pixel avatar exists; emoji on a neutral tile |
| Role | `identity.theme` | closest thing to a description |
| Runtime badge | constant | "OpenClaw", so it is never confused with a Hermes agent |
| Model | entry `model.primary`, else `defaults.model` | strip the `@<auth-profile>` suffix; label "(default)" when inherited |
| Status | gateway lease + `/proc`, then run rule | see 2.4 |
| Last activity | `MAX(audit_events.occurred_at)` for the agent | "Never run" for the three with no rows, stated plainly |
| Last run result | status of latest `agent.run.finished` | succeeded / failed / cancelled |
| Sessions | `COUNT(*)` from per-agent `session_windows` | |
| Can delegate to | `subagents.allowAgents` | chief only |

Shown as "Not Available": current task, kanban, session leases, cost/tokens, skills, memory files,
individual gateway pid.

### 2.4 Backend: `api/sources/openclaw.py` (new, read-only)

```
OPENCLAW_HOME = ~/.openclaw            (config.py, overridable by env; source returns available=False if missing)

list_agents()    -> openclaw.json: agents.entries + agents.defaults        (file read, no CLI)
gateway_status() -> state_leases WHERE scope='gateway-owner'
                    running: owner.pid alive AND /proc starttime == owner.startedAt AND expires_at > now
                    stopped: lease row exists but pid dead / starttime differs / lease expired
                    unknown: db unreadable or no lease row
agent_activity() -> audit_events GROUP BY agent_id (last event, run counts by status)
                    + per-agent session_windows (count, last channel/model)
openclaw_state() -> composes the above into one payload
```

State rule per agent, same vocabulary as Hermes so the existing badge works:

1. unknown: config or DB unreadable, or no gateway lease row
2. offline: gateway stopped
3. working: an `agent.run.started` after the current gateway boot, within the last 30 min, with no
   matching `agent.run.finished`. **Ship behind a flag, off, until validated on a live run.**
4. idle: otherwise

Endpoint: `GET /api/openclaw/agents` in a new `api/routers/openclaw.py`. Keep it out of
`/api/office/state` `agents[]` for now, so the current office frontend is unaffected.

Hard rules for this source:

- Never write under `~/.openclaw/`. Open with `ro_connect` only. Do not copy DBs into the repo.
- No CLI calls, and no calls to the gateway HTTP port (would require reading its token).
- **Explicit column allowlists; never `SELECT *`, never return config objects whole.** The data
  sits next to live secrets: `openclaw.json` (gateway token, Telegram bot token),
  `config_machine_state` (a push private key), `device_identities`, `device_bootstrap_tokens`,
  and `auth_profile_store` in each agent DB (provider API keys). Only `agents.entries` and
  `agents.defaults.model` are read from the config.
- Do not expose transcript text or `session_key` values in v1. They contain the user's Telegram
  conversations and peer ids.
- Every failure maps to `available: false` plus an error string, as in the other sources. If the
  gateway is down and SQLite cannot open the WAL read-only, that is `unknown`, not a crash.

Estimated size: about 120 lines of source, 20 of router, plus rule tests in the style of
`tests/test_office_rules.py`.

### 2.5 UI

**Agents view: yes, same page, separate section.** Add an "OpenClaw Team" section below the Hermes
cards, 4 cards, each with the "OpenClaw" runtime badge. Reuse `AgentCard` layout with the reduced
field set from 2.3. The `openclaw` system agent is hidden by default; it can be a small footnote
row ("system agent, 3 runs") if wanted.

**Office: not in phase 1.** Reasons:

- Seats are hard-coded per agent id in `layout.ts` `DESKS` (4 desks), and furniture is built per
  desk in `room.ts` and `pixel-furniture.ts`. `hasSeat()` gates drawing in both renderers, so an
  agent without a desk is simply not drawn. Adding seats means layout, voxel furniture, pixel
  grid, lounge routing and identity colours, in both modes. That is a design task for Susi, not a
  data task.
- Three of the four agents have never run and "working" is unverified. Four permanently idle
  characters add clutter and no information.

**Desk count.** The real number is 4 Hermes + 4 OpenClaw = 8 characters (plus the Claude robot),
not 9, because the fifth OpenClaw directory is a system agent. The room has 4 desks.

**Phase 2, if wanted after phase 1 proves useful:** seat the OpenClaw team at one shared 4-seat
table in the existing "Open Work Area" zone on Floor 0 (already labelled in `ZONE_LABELS`,
currently an empty rug). Their own area, same workspace floor, no new room. Static seats like the
Claude bench (no lounge walk) for the first version. Voxel and pixel together, since both read
positions from `layout.ts`. Needs from Susi: 4 identity colours and the table design.

### 2.6 Suggested order

1. Issue 1 fix (backend only, about 12 lines + tests + contract doc). Assign: Bagas.
2. `api/sources/openclaw.py` + router + tests, working rule flagged off. Assign: Bagas.
3. "OpenClaw Team" section in the Agents view. Assign: Bagas, with Susi for the card variant.
4. Trigger one real OpenClaw run, confirm the in-flight rows look as assumed, then enable rule 3.
5. Decide on phase 2 (office seats) after a week of real use.

### 2.7 Open questions for Hawa / the user

- What is the `agents/openclaw` agent for, and should it be visible at all?
- Is hiding OpenClaw conversation text in Mission Control the right default? (I assumed yes.)
- Should the OpenClaw CLI block be looked at? It may explain the earlier "hangs" as well.
