// Agents roster (spec 6.2): Hermes → tool card → OpenClaw; each group sorted by status, then name (t_f8e0064a).
import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { OpenClawAgent } from "../api/types";
import { AgentCard, OpenClawCard, ToolCard } from "../components/agents/AgentCard";
import { EmptyState, ErrorPanel, Skeleton } from "../components/ui/States";
import { usePageSubtitle } from "../lib/subtitle";
import { hermesStatus, openclawStatus, STATUS_RANK, useTeam, type AgentStatus, type TeamMember } from "../lib/team";
import { useNow } from "../lib/time";

type Framework = "hermes" | "openclaw";
type PlatformFilter = "all" | Framework;
type StatusFilter = "all" | "working" | "idle" | "offline";
interface Filters { platform: PlatformFilter; status: StatusFilter; search: string }

const FILTER_KEY = "mc.agents.filter";
const PLATFORMS: [PlatformFilter, string][] = [["all", "Semua"], ["hermes", "Hermes"], ["openclaw", "OpenClaw"]];
const STATUSES: [StatusFilter, string][] = [["all", "Semua"], ["working", "Working"], ["idle", "Idle"], ["offline", "Offline"]];
const DEFAULTS: Filters = { platform: "all", status: "all", search: "" };

function readFilters(): Filters {
  try {
    const v = JSON.parse(sessionStorage.getItem(FILTER_KEY) || "{}");
    return {
      platform: PLATFORMS.some(([k]) => k === v.platform) ? v.platform : "all",
      status: STATUSES.some(([k]) => k === v.status) ? v.status : "all",
      search: typeof v.search === "string" ? v.search : "",
    };
  } catch { return DEFAULTS; }
}

/** One sortable/filterable row; `names` are the strings the search box matches. */
interface Row { key: string; fw: Framework; status: AgentStatus; name: string; names: string[]; m?: TeamMember; a?: OpenClawAgent }

const statusOk = (f: StatusFilter, s: AgentStatus) => f === "all" || f === s || (f === "offline" && s === "error");
const searchOk = (q: string, names: string[]) => !q || names.some((n) => n.toLowerCase().includes(q));
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
  const [f, setF] = useState<Filters>(readFilters);
  const oc = useApi(endpoints.openclaw, 30_000);
  const n = team.members.length;
  usePageSubtitle(team.agents.data ? `· ${n} agent${n === 1 ? "" : "s"} · 1 tool` : null);

  useEffect(() => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* storage unavailable */ }
  }, [f]);
  const set = (p: Partial<Filters>) => setF((cur) => ({ ...cur, ...p }));

  const hermesRows: Row[] = team.members.map((m) => ({
    key: m.id, fw: "hermes", status: hermesStatus(m, now), name: m.ident.displayName,
    names: [m.ident.displayName, m.ident.shortName, m.id], m,
  }));
  const ocRows: Row[] = (oc.data?.agents ?? []).map((a) => ({
    key: a.name, fw: "openclaw", status: openclawStatus(a), name: a.display_name || a.name,
    names: [a.display_name, a.name], a,
  }));
  const all = [...hermesRows, ...ocRows];
  const q = f.search.trim().toLowerCase();
  const match = (r: Row, x: Filters) => (x.platform === "all" || x.platform === r.fw) && statusOk(x.status, r.status) && searchOk(q, r.names);
  const count = (p: Partial<Filters>) => all.filter((r) => match(r, { ...f, ...p })).length;
  const hermes = hermesRows.filter((r) => match(r, f)).sort(byStatusName);
  const openclaw = ocRows.filter((r) => match(r, f)).sort(byStatusName);

  const showHermes = f.platform !== "openclaw";
  const showOc = f.platform !== "hermes";
  const showTool = showHermes && f.status === "all" && searchOk(q, ["Claude CLI", "Claude Code CLI", "claude_cli"]);
  const filtered = f.platform !== "all" || f.status !== "all" || q !== "";
  const hermesLoading = team.loading && !n;
  // Loading or failed sections keep their skeleton/error panel instead of the "no match" empty state.
  const hermesBusy = showHermes && (hermesLoading || (!!team.error && !n));
  const ocBusy = showOc && !oc.data;
  const nothing = filtered && !hermesBusy && !ocBusy && !hermes.length && !openclaw.length && !showTool;

  const btn = (active: boolean, label: string, c: number, onClick: () => void, key: string) => (
    <button key={key} type="button" className={`team-filter-btn${active ? " active" : ""}`} aria-pressed={active} onClick={onClick}>
      {label} <span className="filter-count">({c})</span>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <span className="sm secondary">Status comes from gateway.lock + kanban claims (office state). Click a card for details.</span>
      </div>
      <div className="agents-filters">
        <div className="team-filter-bar" role="group" aria-label="Platform">
          {PLATFORMS.map(([k, l]) => btn(f.platform === k, l, count({ platform: k }), () => set({ platform: k }), k))}
        </div>
        <div className="team-filter-bar" role="group" aria-label="Status">
          {STATUSES.map(([k, l]) => btn(f.status === k, l, count({ status: k }), () => set({ status: k }), k))}
        </div>
        <div className="team-filter-bar">
          <label className="search-wrap"><Search size={14} />
            <input type="search" className="search-input" style={{ width: 240 }} placeholder="Cari agent..." aria-label="Cari agent"
              value={f.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
        </div>
      </div>
      {nothing ? (
        <div className="card"><EmptyState title="Tidak ada agent yang sesuai filter." /></div>
      ) : (
        <>
          {showHermes && (team.error && !n ? (
            <ErrorPanel what="agents" error={team.error} onRetry={() => { void refetch(endpoints.agents); void refetch(endpoints.office); }} />
          ) : (hermes.length > 0 || showTool || hermesLoading) && (
            <div className="agent-grid">
              {hermesLoading
                ? [0, 1, 2, 3].map((i) => <Skeleton key={i} h={232} r={12} />)
                : hermes.map((r) => <WithFramework key={r.key} fw="hermes"><AgentCard m={r.m!} now={now} /></WithFramework>)}
              {showTool && <WithFramework fw="hermes"><ToolCard tool={team.tool} loading={team.tools.loading} now={now} /></WithFramework>}
            </div>
          ))}
          {showOc && (
            <section className="openclaw-team" aria-label="OpenClaw Team" style={{ marginTop: showHermes ? "var(--space-6)" : 0 }}>
              {showHermes && <hr style={{ border: 0, borderTop: "1px solid var(--border-default)", margin: "0 0 var(--space-4)" }} />}
              <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>OpenClaw Team</h2>
              <div className="xs muted" style={{ margin: "4px 0 var(--space-4)" }}>Data source: OpenClaw (read-only)</div>
              {oc.error && !oc.data ? (
                <ErrorPanel what="OpenClaw agents" error={oc.error} onRetry={() => void refetch(endpoints.openclaw)} />
              ) : !oc.data ? (
                <div className="agent-grid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={232} r={12} />)}</div>
              ) : openclaw.length ? (
                <div className="agent-grid">
                  {openclaw.map((r) => <WithFramework key={r.key} fw="openclaw"><OpenClawCard a={r.a!} now={now} /></WithFramework>)}
                </div>
              ) : filtered && <div className="sm muted">Tidak ada agent OpenClaw yang sesuai filter.</div>}
              {oc.data && !oc.data.available && <div className="sm muted">OpenClaw config unavailable: {oc.data.error}</div>}
            </section>
          )}
        </>
      )}
    </>
  );
}
