// Agents roster (spec 6.2): fixed hierarchy order, the tool card always last.
import { useState } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import { AgentCard, OpenClawCard, ToolCard } from "../components/agents/AgentCard";
import { ErrorPanel, Skeleton } from "../components/ui/States";
import { usePageSubtitle } from "../lib/subtitle";
import { useTeam } from "../lib/team";
import { useNow } from "../lib/time";

type Filter = "all" | "agents" | "tools";

export default function Agents() {
  const team = useTeam();
  const now = useNow(10_000);
  const [filter, setFilter] = useState<Filter>("all");
  const oc = useApi(endpoints.openclaw, 30_000);
  const n = team.members.length;
  usePageSubtitle(team.agents.data ? `· ${n} agent${n === 1 ? "" : "s"} · 1 tool` : null);

  return (
    <>
      <div className="page-head">
        <span className="sm secondary">Status comes from gateway.lock + kanban claims (office state). Click a card for details.</span>
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="Show">
          {(["all", "agents", "tools"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>
      {team.error && !n ? (
        <ErrorPanel what="agents" error={team.error} onRetry={() => { void refetch(endpoints.agents); void refetch(endpoints.office); }} />
      ) : (
        <div className="agent-grid">
          {filter !== "tools" && (team.loading && !n
            ? [0, 1, 2, 3].map((i) => <Skeleton key={i} h={232} r={12} />)
            : team.members.map((m) => <AgentCard key={m.id} m={m} now={now} />))}
          {filter !== "agents" && <ToolCard tool={team.tool} loading={team.tools.loading} now={now} />}
        </div>
      )}
      {filter !== "tools" && (
        <section className="openclaw-team" aria-label="OpenClaw Team" style={{ marginTop: "var(--space-6)" }}>
          <hr style={{ border: 0, borderTop: "1px solid var(--border-default)", margin: "0 0 var(--space-4)" }} />
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>OpenClaw Team</h2>
          <div className="xs muted" style={{ margin: "4px 0 var(--space-4)" }}>Data source: OpenClaw (read-only)</div>
          {oc.error && !oc.data ? (
            <ErrorPanel what="OpenClaw agents" error={oc.error} onRetry={() => void refetch(endpoints.openclaw)} />
          ) : (
            <div className="agent-grid">
              {!oc.data
                ? [0, 1, 2, 3].map((i) => <Skeleton key={i} h={232} r={12} />)
                : oc.data.agents.map((a) => <OpenClawCard key={a.name} a={a} now={now} />)}
            </div>
          )}
          {oc.data && !oc.data.available && <div className="sm muted">OpenClaw config unavailable: {oc.data.error}</div>}
        </section>
      )}
    </>
  );
}
