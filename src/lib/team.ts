// Joins the per-agent API feeds into one roster model used by Dashboard, Agents, Office and drawers.
import { endpoints, useApi } from "../api/client";
import type { Agent, CronJob, OfficeAgent, OpenClawAgent, Session, Tool } from "../api/types";
import { identity, rosterIndex, type AgentIdentity } from "../theme/agents";
import { jobFailing, sessionsByProfile, sessionsToday } from "./derive";
import { toDate } from "./time";

// Same order/id scheme as src/views/Office.tsx.
const OPENCLAW_ORDER = ["chief", "researcher", "writer", "reviewer"];
const ocRank = (n: string) => { const i = OPENCLAW_ORDER.indexOf(n); return i < 0 ? 99 : i; };

function openclawIdentity(a: OpenClawAgent): AgentIdentity {
  const name = a.display_name || a.name;
  return {
    id: `openclaw:${a.name}`, displayName: name, shortName: name, role: "OpenClaw",
    cssVar: "--agent-openclaw", hex: "#F59E0B", hexLight: "#D97706", kind: "agent",
  };
}

export interface TeamMember {
  id: string;
  ident: AgentIdentity;
  agent?: Agent;              // /api/agents
  office?: OfficeAgent;       // /api/office/state
  sessions: Session[];        // newest first (from /api/activity/sessions?limit=1000)
  sessionTotal: number | null;
  today: { n: number; exact: boolean } | null;
  model: string | null;       // model of the latest session (API_CONTRACT §9), null if no sessions
  jobs: CronJob[];
  failingJobs: number;
  lastActive: string | number | null;
  framework?: "hermes" | "openclaw";
  openclaw?: OpenClawAgent;   // raw /api/openclaw/agents row (OpenClaw members only)
}

export function useTeam(officeInterval = 30_000) {
  const agents = useApi(endpoints.agents, 30_000);
  const office = useApi(endpoints.office, officeInterval);
  const tools = useApi(endpoints.tools, 30_000);
  const sessions = useApi(endpoints.sessions, 30_000);
  const jobs = useApi(endpoints.cronJobs, 30_000);
  const openclaw = useApi(endpoints.openclaw, 30_000);

  // Profile list = what the API reports (never a hard-coded list); spec roster order.
  const ids = new Set<string>();
  agents.data?.agents.forEach((a) => ids.add(a.name));
  office.data?.agents.forEach((a) => ids.add(a.name));
  const byProfile = sessionsByProfile(sessions.data);

  const members: TeamMember[] = [...ids].sort((a, b) => rosterIndex(a) - rosterIndex(b)).map((id) => {
    const list = byProfile.get(id) ?? [];
    const own = jobs.data?.jobs.filter((j) => j.profile === id) ?? [];
    const off = office.data?.agents.find((a) => a.name === id);
    const latest = list[0];
    return {
      id,
      ident: identity(id),
      agent: agents.data?.agents.find((a) => a.name === id),
      office: off,
      sessions: list,
      sessionTotal: sessions.data?.profiles.find((p) => p.profile === id)?.total ?? null,
      today: sessions.data ? sessionsToday(sessions.data, id) : null,
      model: latest?.model ?? null,
      jobs: own,
      failingJobs: own.filter(jobFailing).length,
      lastActive: off?.last_activity_at ?? latest?.last_activity_at_iso ?? latest?.started_at_iso ?? null,
      framework: "hermes" as const,
    };
  });

  // OpenClaw agents are kept OUT of `members` (Memory/Agents/AgentDrawer/tiles assume Hermes profiles).
  const openclawMembers: TeamMember[] = [...(openclaw.data?.agents ?? [])]
    .sort((a, b) => ocRank(a.name) - ocRank(b.name))
    .map((a) => ({
      id: `openclaw:${a.name}`,
      ident: openclawIdentity(a),
      agent: undefined,
      office: undefined,
      sessions: [],
      sessionTotal: null,
      today: null,
      model: a.model,
      jobs: [],
      failingJobs: 0,
      lastActive: a.last_run_at ?? null,
      framework: "openclaw" as const,
      openclaw: a,
    }));

  const tool: Tool | undefined = tools.data?.tools[0];
  const loading = agents.loading && office.loading;
  const error = agents.error ?? office.error ?? null; // openclaw errors deliberately excluded
  return { members, openclawMembers, tool, office, agents, tools, sessions, jobs, openclaw, loading, error };
}

export type Team = ReturnType<typeof useTeam>;

// Card status used for sorting/filtering on the Agents page (t_f8e0064a).
export type AgentStatus = "working" | "idle" | "offline" | "error";
export const STATUS_RANK: Record<AgentStatus, number> = { working: 0, idle: 1, offline: 2, error: 3 };
const RECENT_MS = 5 * 60_000;

/** Hermes never yields "error": Agent.status is a GatewayStatus (running|stopped|unknown) with no error field.
 *  "Active session" = office state working/reviewing (there is no "busy" state) or the newest session has no ended_at. */
export function hermesStatus(m: TeamMember, now = Date.now()): AgentStatus {
  if (!m.agent || m.agent.status === "stopped") return "offline";
  const st = m.office?.state;
  if (st === "working" || st === "reviewing") return "working";
  const latest = m.sessions[0];
  if (latest && latest.started_at != null && latest.ended_at == null) return "working";
  const t = toDate(m.lastActive)?.getTime();
  if (t != null && now - t <= RECENT_MS) return "working";
  return "idle";
}

export function openclawStatus(a: OpenClawAgent): AgentStatus {
  if (a.is_running === true) return "working";
  if (a.gateway_status === "running") return "idle";
  if (a.error) return "error";
  return "offline";
}
