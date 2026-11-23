// Agents roster (spec 6.2): Hermes → tool card → OpenClaw; each group sorted by status, then name (t_f8e0064a).
// No filter UI: every agent is always listed (filters removed on request from Hawa).
import type { ReactNode } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { OpenClawAgent } from "../api/types";
import { AgentCard, OpenClawCard, ToolCard } from "../components/agents/AgentCard";
import { ErrorPanel, Skeleton } from "../components/ui/States";
import { usePageSubtitle } from "../lib/subtitle";
import { hermesStatus, openclawStatus, STATUS_RANK, useTeam, type AgentStatus, type TeamMember } from "../lib/team";
import { useNow } from "../lib/time";

type Framework = "hermes" | "openclaw";

/** One sortable row. */
interface Row { key: string; fw: Framework; status: AgentStatus; name: string; m?: TeamMember; a?: OpenClawAgent }

// Default order: working → idle → offline, then A-Z.
const byStatusName = (x: Row, y: Row) => STATUS_RANK[x.status] - STATUS_RANK[y.status] || x.name.localeCompare(y.name);

// Framework badge, overlaid on the card's top-right edge so the card component itself stays untouched.
function FrameworkBadge({ fw }: { fw: Framework }) {
  return fw === "hermes"
    ? <span className="fw-badge badge-hermes" title="Hermes agent"><span className="fw-mono" aria-hidden="true">H</span>Hermes</span>
    : <span className="fw-badge badge-openclaw" title="OpenClaw agent"><span className="fw-mono" aria-hidden="true">OC</span>OpenClaw</span>;
}
function WithFramework({ fw, children }: { fw: Framework; children: ReactNode }) {
  return <div className="fw-wrap">{children}<FrameworkBadge fw={fw} /></div>;
}

export default function Agents() {
  const team = useTeam();
  const now = useNow(10_000);
  const oc = useApi(endpoints.openclaw, 30_000);
  const n = team.members.length;
  usePageSubtitle(team.agents.data ? `· ${n} agent${n === 1 ? "" : "s"} · 1 tool` : null);

  const hermes: Row[] = team.members.map((m): Row => ({
    key: m.id, fw: "hermes", status: hermesStatus(m, now), name: m.ident.displayName, m,
  })).sort(byStatusName);
  const openclaw: Row[] = (oc.data?.agents ?? []).map((a): Row => ({
    key: a.name, fw: "openclaw", status: openclawStatus(a), name: a.display_name || a.name, a,
  })).sort(byStatusName);
  const hermesLoading = team.loading && !n;

  return (
    <>
      <div className="page-head">
        <span className="sm secondary">Status comes from gateway.lock + kanban claims (office state). Click a card for details.</span>
      </div>
      {team.error && !n ? (
        <ErrorPanel what="agents" error={team.error} onRetry={() => { void refetch(endpoints.agents); void refetch(endpoints.office); }} />
      ) : (
        <div className="agent-grid">
          {hermesLoading
            ? [0, 1, 2, 3].map((i) => <Skeleton key={i} h={232} r={12} />)
            : hermes.map((r) => <WithFramework key={r.key} fw="hermes"><AgentCard m={r.m!} now={now} /></WithFramework>)}
          <WithFramework fw="hermes"><ToolCard tool={team.tool} loading={team.tools.loading} now={now} /></WithFramework>
        </div>
      )}
      <section className="openclaw-team" aria-label="OpenClaw Team" style={{ marginTop: "var(--space-6)" }}>
        <hr style={{ border: 0, borderTop: "1px solid var(--border-default)", margin: "0 0 var(--space-4)" }} />
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>OpenClaw Team</h2>
        <div className="xs muted" style={{ margin: "4px 0 var(--space-4)" }}>Data source: OpenClaw (read-only)</div>
        {oc.error && !oc.data ? (
          <ErrorPanel what="OpenClaw agents" error={oc.error} onRetry={() => void refetch(endpoints.openclaw)} />
        ) : !oc.data ? (
          <div className="agent-grid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={232} r={12} />)}</div>
        ) : openclaw.length > 0 && (
          <div className="agent-grid">
            {openclaw.map((r) => <WithFramework key={r.key} fw="openclaw"><OpenClawCard a={r.a!} now={now} /></WithFramework>)}
          </div>
        )}
        {oc.data && !oc.data.available && <div className="sm muted">OpenClaw config unavailable: {oc.data.error}</div>}
      </section>
    </>
  );
}
