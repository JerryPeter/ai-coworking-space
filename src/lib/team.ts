// Joins the per-agent API feeds into one roster model used by Dashboard, Agents, Office and drawers.
import { endpoints, useApi } from "../api/client";
import type { Agent, CronJob, OfficeAgent, Session, Tool } from "../api/types";
import { identity, rosterIndex, type AgentIdentity } from "../theme/agents";
import { jobFailing, sessionsByProfile, sessionsToday } from "./derive";

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
}

export function useTeam(officeInterval = 30_000) {
  const agents = useApi(endpoints.agents, 30_000);
  const office = useApi(endpoints.office, officeInterval);
  const tools = useApi(endpoints.tools, 30_000);
  const sessions = useApi(endpoints.sessions, 30_000);
  const jobs = useApi(endpoints.cronJobs, 30_000);

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
    };
  });

  const tool: Tool | undefined = tools.data?.tools[0];
  const loading = agents.loading && office.loading;
  const error = agents.error ?? office.error ?? null;
  return { members, tool, office, agents, tools, sessions, jobs, loading, error };
}

export type Team = ReturnType<typeof useTeam>;
