// Graphify (brief 2026-11-23): knowledge-graph page for mission-control-v2's own codebase.
// Data: GET /api/graphify/{stats,top-nodes,findings} (api/sources/graphify.py; graph.json is
// read-only, parsed once and cached in memory by mtime). Update: POST /api/graphify/update
// (202 + job_id; 409 returns the job already running, which this view adopts instead of
// starting a second one), polled every 2s via GET /api/graphify/update/{job_id} until
// succeeded/failed, then stats/top-nodes/findings are refetched (CTO decision #3).
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, CircleCheck, Clock, ExternalLink, GitBranch, GitFork,
  Layers, Loader, Network, RefreshCw, Share2, Tag, TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiPost, endpoints, getToken, refetch, useApi } from "../api/client";
import type { GraphifyFinding, GraphifyJobResponse, GraphifyNode, GraphifyNodeType } from "../api/types";
import { EmptyState, ErrorPanel, Skeleton } from "../components/ui/States";
import { absolute, relative, useNow } from "../lib/time";

const POLL_MS = 2_000;
const nf = new Intl.NumberFormat("en-US");

type SortKey = "label" | "degree" | "community_name" | "type";
type SortDir = "asc" | "desc";

// CTO notes §6: 4-color palette reused from existing tokens, not 7 distinct colors.
const TYPE_COLOR: Record<GraphifyNodeType, string> = {
  class: "var(--accent-primary)",
  function: "var(--accent-secondary)",
  module: "var(--text-secondary)",
  external: "var(--status-idle)",
  concept: "var(--text-muted)",
  rationale: "var(--text-muted)",
  other: "var(--text-muted)",
};

function TypeBadge({ type }: { type: GraphifyNodeType }) {
  return <span className="chip" style={{ color: TYPE_COLOR[type] }}>{type}</span>;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={12} style={{ color: "var(--text-muted)" }} aria-hidden="true" />;
  return dir === "desc"
    ? <ArrowDown size={12} style={{ color: "var(--text-primary)" }} aria-hidden="true" />
    : <ArrowUp size={12} style={{ color: "var(--text-primary)" }} aria-hidden="true" />;
}

function SortableTh({
  label, active, dir, onClick, align,
}: { label: string; active: boolean; dir: SortDir; onClick: () => void; align?: "right" }) {
  return (
    <th scope="col" aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"} style={align ? { textAlign: align } : undefined}>
      <button type="button" className="th-sort-btn" onClick={onClick}>
        {label} <SortIcon active={active} dir={dir} />
      </button>
    </th>
  );
}

function FindingCard({ f }: { f: GraphifyFinding }) {
  const [open, setOpen] = useState(false);
  const warn = f.status === "warning";
  const Icon = warn ? TriangleAlert : CircleCheck;
  const color = warn ? "var(--status-reviewing)" : "var(--status-working)";
  const d = f.detail;
  const hasBody = d.source_file || d.community_name || d.backend_communities || d.cross_boundary_edges != null
    || (d.neighbors_by_relation && d.neighbors_by_relation.length > 0) || d.recommendation;
  return (
    <div className="card">
      <button
        type="button"
        className="card-head"
        style={{ width: "100%", cursor: "pointer", background: "none", border: 0 }}
        aria-expanded={open}
        aria-controls={`finding-${f.id}-body`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={18} style={{ color, flexShrink: 0 }} aria-hidden="true" />
        <span className="card-title" style={{ flex: 1, textAlign: "left" }}>{f.title}</span>
        {f.degree != null && <span className="xs muted">{f.degree} connections</span>}
        <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform var(--dur-fast)" }} aria-hidden="true" />
      </button>
      {open && hasBody && (
        <div id={`finding-${f.id}-body`} className="card-body" role="region" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {d.source_file && <div className="xs"><span className="muted">File:</span> <span className="mono-12">{d.source_file}</span></div>}
          {d.community_name && <div className="xs"><span className="muted">Community:</span> {d.community_name}</div>}
          {d.backend_communities && (
            <div className="xs"><span className="muted">Backend communities:</span> {d.backend_communities.join(", ") || "—"}</div>
          )}
          {d.cross_boundary_edges != null && (
            <div className="xs"><span className="muted">Cross-boundary edges (api|tests ↔ src):</span> {d.cross_boundary_edges}</div>
          )}
          {d.neighbors_by_relation && d.neighbors_by_relation.length > 0 && (
            <div className="xs">
              <span className="muted">Top relations:</span> {d.neighbors_by_relation.map((r) => `${r.relation} (${r.count})`).join(", ")}
            </div>
          )}
          {d.recommendation && <div className="xs" style={{ marginTop: 4 }}>{d.recommendation}</div>}
        </div>
      )}
    </div>
  );
}

export default function Graphify() {
  const stats = useApi(endpoints.graphifyStats, 30_000);
  const topNodes = useApi(endpoints.graphifyTopNodes, 30_000);
  const findings = useApi(endpoints.graphifyFindings, 30_000);
  const now = useNow(30_000);

  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [updatedAnnouncement, setUpdatedAnnouncement] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("degree");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openingGraph, setOpeningGraph] = useState(false);
  const [openGraphError, setOpenGraphError] = useState<string | null>(null);

  const jobApi = useApi(jobId ? endpoints.graphifyUpdateJob(jobId) : null, POLL_MS);

  // Drive the update job state machine from polling (spec §3.2): on succeeded, refetch the three
  // data sources and clear the job; on failed, surface the log tail and clear the job.
  useEffect(() => {
    const job = jobApi.data;
    if (!job || !jobId) return;
    if (job.status === "succeeded") {
      setJobId(null);
      setJobError(null);
      void refetch(endpoints.graphifyStats);
      void refetch(endpoints.graphifyTopNodes);
      void refetch(endpoints.graphifyFindings);
      setUpdatedAnnouncement("Graph diperbarui");
      const t = window.setTimeout(() => setUpdatedAnnouncement(null), 4_000);
      return () => window.clearTimeout(t);
    }
    if (job.status === "failed") {
      setJobId(null);
      setJobError(job.log_tail.slice(-5).join("\n") || "Update gagal — lihat log server.");
    }
  }, [jobApi.data, jobId]);

  const updating = starting || jobId != null;

  async function handleUpdate() {
    setJobError(null);
    setStarting(true);
    try {
      const job = await apiPost<GraphifyJobResponse>(endpoints.graphifyUpdate);
      setJobId(job.job_id);
    } catch (e) {
      const err = e as ApiError;
      const adopted = err instanceof ApiError && err.status === 409
        ? (err.body as { detail?: { job_id?: string } } | null)?.detail?.job_id
        : undefined;
      if (adopted) setJobId(adopted);
      else setJobError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function openGraph() {
    setOpenGraphError(null);
    const win = window.open("", "_blank"); // sync, before the await, so popup blockers allow it
    setOpeningGraph(true);
    try {
      const token = getToken();
      const res = await fetch(endpoints.graphifyGraphHtml, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "text/html" }));
      if (!win) throw new Error("Pop-up diblokir oleh browser");
      win.location.href = url;
    } catch (e) {
      win?.close();
      setOpenGraphError(`Gagal membuka graph: ${(e as Error).message}. Periksa pop-up blocker.`);
    } finally {
      setOpeningGraph(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((v) => (v === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const rows = topNodes.data?.nodes ?? [];
  const sortedRows = useMemo(() => {
    const cmp = (a: GraphifyNode, b: GraphifyNode): number => {
      switch (sortKey) {
        case "label": return a.label.localeCompare(b.label);
        case "degree": return a.degree - b.degree;
        case "community_name": return (a.community_name ?? "").localeCompare(b.community_name ?? "");
        case "type": return a.type.localeCompare(b.type);
      }
    };
    const sorted = [...rows].sort(cmp);
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [rows, sortKey, sortDir]);

  const notFound = stats.error instanceof ApiError && stats.error.status === 404;
  const d = stats.data;
  const loadErrored = !!stats.error && !notFound && !d;
  const cyclesOk = (d?.import_cycles ?? 0) === 0;

  return (
    <div className="stack">
      <div className="page-head">
        <span className="muted">Peta arsitektur codebase mission-control-v2</span>
        <span className="spacer" />
        {d && (
          <>
            <span className="freshness" title={absolute(d.last_updated)}>
              <Clock size={12} aria-hidden="true" /> Updated {relative(d.last_updated, now)}
            </span>
            <span className="freshness">
              <Tag size={12} aria-hidden="true" /> graphify v{d.graphify_version ?? "?"}
            </span>
            <span
              className={`freshness${d.stale ? " stale" : ""}`}
              title={d.stale ? "Graph dibangun dari commit lama — jalankan Update Graph" : (d.built_at_commit ?? undefined)}
            >
              {d.stale ? <TriangleAlert size={12} aria-hidden="true" /> : <GitBranch size={12} aria-hidden="true" />}
              {(d.built_at_commit ?? "????????").slice(0, 8)}{d.stale ? " · stale" : ""}
            </span>
          </>
        )}
        <button
          className="btn btn-primary"
          disabled={updating}
          aria-busy={updating}
          title={updating ? "Update sedang berjalan oleh proses lain" : undefined}
          onClick={handleUpdate}
        >
          {updating
            ? <><Loader size={16} className="spin-1s" aria-hidden="true" /> Updating…</>
            : <><RefreshCw size={16} aria-hidden="true" /> Update Graph</>}
        </button>
      </div>

      {jobError && (
        <div className="error-panel" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="semibold">Update Graph gagal</div>
            <pre>{jobError}</pre>
            <button className="btn btn-secondary" onClick={handleUpdate}>Retry</button>
          </div>
        </div>
      )}

      <div aria-live="polite">
        <span className="sr-only">{updatedAnnouncement}</span>

        {notFound ? (
          <EmptyState
            icon={<Network size={48} aria-hidden="true" />}
            title="Belum ada knowledge graph"
            body="Jalankan Update Graph untuk menganalisis codebase pertama kali. Proses berjalan di latar belakang dan bisa memakan waktu beberapa menit."
            cli="graphify update ."
          />
        ) : loadErrored ? (
          <ErrorPanel what="data graph" error={stats.error} onRetry={() => refetch(endpoints.graphifyStats)} />
        ) : (
          <div className="stack">
            <section className="tiles graphify-tiles" aria-label="Key numbers">
              <div className="card tile">
                <div className="tile-label-row">Total Nodes <Network size={16} aria-hidden="true" /></div>
                {stats.loading ? <Skeleton w={64} h={28} /> : <div className="tile-num">{nf.format(d?.total_nodes ?? 0)}</div>}
              </div>
              <div className="card tile">
                <div className="tile-label-row">Total Edges <Share2 size={16} aria-hidden="true" /></div>
                {stats.loading ? <Skeleton w={64} h={28} /> : <div className="tile-num">{nf.format(d?.total_edges ?? 0)}</div>}
              </div>
              <div className="card tile">
                <div className="tile-label-row">Communities <Layers size={16} aria-hidden="true" /></div>
                {stats.loading ? <Skeleton w={64} h={28} /> : <div className="tile-num">{nf.format(d?.communities ?? 0)}</div>}
              </div>
              <div className={`card tile${cyclesOk ? "" : " alert"}`}>
                <div className="tile-label-row">Import Cycles <GitFork size={16} aria-hidden="true" /></div>
                {stats.loading ? <Skeleton w={64} h={28} /> : (
                  <>
                    <div className="tile-num" style={cyclesOk ? { color: "var(--status-working)" } : undefined}>{d?.import_cycles ?? 0}</div>
                    {cyclesOk ? (
                      <div className="tile-ctx"><CircleCheck size={12} aria-hidden="true" /> No cycles detected</div>
                    ) : (
                      <div className="tile-ctx alert"><TriangleAlert size={12} aria-hidden="true" /> {d?.import_cycles} cycle(s) detected</div>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className="section" aria-label="Key findings">
              <div className="eyebrow">Key Findings</div>
              <div className="stack" style={{ gap: 12 }}>
                {findings.loading ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="card">
                      <div className="card-head"><span className="card-title muted">Loading…</span></div>
                      <div className="card-body"><Skeleton h={56} /></div>
                    </div>
                  ))
                ) : findings.error ? (
                  <ErrorPanel what="findings" error={findings.error} onRetry={() => refetch(endpoints.graphifyFindings)} />
                ) : (
                  (findings.data?.findings ?? []).map((f) => <FindingCard key={f.id} f={f} />)
                )}
              </div>
            </section>

            <div className="card">
              <div className="card-head">
                <span className="card-title">Top Nodes</span>
                <span className="count-pill">{topNodes.data?.nodes.length ?? 0}</span>
              </div>
              <div className="card-body">
                {topNodes.loading ? <Skeleton h={320} /> : topNodes.error ? (
                  <ErrorPanel what="top nodes" error={topNodes.error} onRetry={() => refetch(endpoints.graphifyTopNodes)} />
                ) : sortedRows.length === 0 ? (
                  <EmptyState title="Tidak ada node" body="graph.json belum berisi data. Jalankan Update Graph." />
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="simple">
                      <thead>
                        <tr>
                          <SortableTh label="Name" active={sortKey === "label"} dir={sortDir} onClick={() => toggleSort("label")} />
                          <SortableTh label="Degree" active={sortKey === "degree"} dir={sortDir} onClick={() => toggleSort("degree")} align="right" />
                          <SortableTh label="Community" active={sortKey === "community_name"} dir={sortDir} onClick={() => toggleSort("community_name")} />
                          <SortableTh label="Type" active={sortKey === "type"} dir={sortDir} onClick={() => toggleSort("type")} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((r) => (
                          <tr key={r.id}>
                            <td className="mono-12 truncate" title={r.label} style={{ maxWidth: 320 }}>{r.label}</td>
                            <td className="tabular" style={{ textAlign: "right" }}>{r.degree}</td>
                            <td>{r.community_name ?? r.community ?? "—"}</td>
                            <td><TypeBadge type={r.type} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div>
              <button
                className="btn btn-primary btn-block"
                style={{ height: 44, fontSize: "var(--text-base)" }}
                disabled={openingGraph}
                aria-busy={openingGraph}
                onClick={openGraph}
              >
                {openingGraph
                  ? <><Loader size={18} className="spin-1s" aria-hidden="true" /> Membuka…</>
                  : <><ExternalLink size={18} aria-hidden="true" /> Buka Interactive Graph</>}
              </button>
              {openGraphError && <div className="xs" style={{ color: "var(--outcome-failed)", marginTop: 6 }}>{openGraphError}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
