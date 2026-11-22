// Token Monitor (t_4c63386c): Hermes token/cost usage from every profile's state.db + OpenCode status.
// Data: GET /api/usage/summary?days=30 (api/sources/usage.py) and GET /api/agents/tools (OpenCode state).
// total tokens = input + output; cache read/write tokens are shown as context, never added in.
import { Coins, MessageSquare, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { ToolState, UsageBucket } from "../api/types";
import { EmptyState, ErrorPanel, Skeleton } from "../components/ui/States";
import { StatusBadge, type BadgeStatus } from "../components/ui/StatusBadge";
import { usePageSubtitle } from "../lib/subtitle";
import { color, identity } from "../theme/agents";

const EXPENSIVE_USD = 10; // a row/day at or above this is highlighted as expensive
const MOBILE_PX = 780;

const nf = new Intl.NumberFormat("en-US");
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return nf.format(n);
}
const fmtUsd = (v: number) => `$${v.toFixed(2)}`;

function Cost({ v }: { v: number }) {
  const hot = v >= EXPENSIVE_USD;
  return (
    <span
      className="tabular"
      title={hot ? `≥ $${EXPENSIVE_USD}` : undefined}
      style={hot ? { color: "var(--outcome-failed)", background: "var(--outcome-failed-subtle)", borderRadius: 4, padding: "0 4px", fontWeight: 600 } : undefined}
    >
      {fmtUsd(v)}
    </span>
  );
}

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth <= MOBILE_PX);
  useEffect(() => {
    const on = () => setM(window.innerWidth <= MOBILE_PX);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return m;
}

function TokenTile({ label, b, loading }: { label: string; b?: UsageBucket; loading: boolean }) {
  return (
    <div className="card tile">
      <div className="tile-label-row">{label} <Zap size={16} /></div>
      {loading ? <Skeleton w={80} h={28} /> : !b ? <div className="tile-num muted">—</div> : (
        <div className="tile-num" title={`${nf.format(b.total_tokens)} token`}>{fmtTokens(b.total_tokens)}</div>
      )}
      {b && (
        <div className="tile-ctx">
          in {fmtTokens(b.input_tokens)} · out {fmtTokens(b.output_tokens)} · {b.sessions} sesi · {fmtUsd(b.cost_usd)}
        </div>
      )}
      {b && <div className="tile-ctx" title="Cache read / write (tidak dihitung dalam total token)">cache {fmtTokens(b.cache_read_tokens)} / {fmtTokens(b.cache_write_tokens)}</div>}
    </div>
  );
}

type Row = UsageBucket & { key: string };

function UsageTable({ rows, head, renderName }: { rows: Row[]; head: string; renderName: (k: string) => ReactNode }) {
  if (!rows.length) return <EmptyState title="Belum ada sesi pada periode ini." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="simple">
        <thead>
          <tr>
            <th>{head}</th>
            <th style={{ textAlign: "right" }}>Sesi</th>
            <th style={{ textAlign: "right" }}>Token</th>
            <th style={{ textAlign: "right" }}>Biaya</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{renderName(r.key)}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{r.sessions}</td>
              <td className="tabular" style={{ textAlign: "right" }} title={`in ${nf.format(r.input_tokens)} · out ${nf.format(r.output_tokens)}`}>{fmtTokens(r.total_tokens)}</td>
              <td style={{ textAlign: "right" }}><Cost v={r.cost_usd} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOOL_BADGE: Record<ToolState, BadgeStatus> = {
  working: "working", idle: "idle", standby: "idle", offline: "offline", unknown: "unknown",
};

export default function TokenMonitor() {
  const usage = useApi(endpoints.usage, 60_000);
  const tools = useApi(endpoints.tools, 30_000);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"model" | "agent">("model");
  const d = usage.data;
  usePageSubtitle(d ? `${d.window_days} hari · ${d.timezone ?? "local"}` : null);

  if (usage.error && !d) {
    return <ErrorPanel what="token usage" error={usage.error} onRetry={() => refetch(endpoints.usage)} />;
  }

  const t = d?.totals;
  const modelRows: Row[] = (d?.by_model ?? []).map((r) => ({ ...r, key: r.model }));
  const agentRows: Row[] = (d?.by_profile ?? []).map((r) => ({ ...r, key: r.profile }));
  const oc = tools.data?.tools.find((x) => x.name === "OpenCode");
  const days = d?.daily ?? [];
  const maxTok = Math.max(1, ...days.map((x) => x.total_tokens));
  const brokenProfiles = (d?.profiles ?? []).filter((p) => !p.available);

  const byModel = (
    <div className="card" style={{ overflow: "hidden", minWidth: 0, alignSelf: mobile ? undefined : "start" }}>
      <div className="card-head"><span className="card-title">By Model</span><span className="count-pill">{modelRows.length}</span></div>
      <div className="card-body">
        {usage.loading ? <Skeleton h={160} /> : <UsageTable rows={modelRows} head="Model" renderName={(k) => <span className="mono-12">{k}</span>} />}
      </div>
    </div>
  );
  const byAgent = (
    <div className="card" style={{ overflow: "hidden", minWidth: 0, alignSelf: mobile ? undefined : "start" }}>
      <div className="card-head"><span className="card-title">By Agent</span><span className="count-pill">{agentRows.length}</span></div>
      <div className="card-body">
        {usage.loading ? <Skeleton h={160} /> : (
          <UsageTable rows={agentRows} head="Agent" renderName={(k) => (
            <span className="row"><span className="dot" style={{ background: color(k) }} />{identity(k).shortName}</span>
          )} />
        )}
      </div>
    </div>
  );

  return (
    <div className="stack">
      {/* Bagian 1: Hermes overview */}
      <section className="section" aria-label="Hermes overview">
        <div className="eyebrow">Hermes (Claude) — overview</div>
        <div className="tiles tm-tiles">
          <TokenTile label="Token hari ini" b={t?.today} loading={usage.loading} />
          <TokenTile label="Token 7 hari" b={t?.last_7_days} loading={usage.loading} />
          <TokenTile label={`Token ${d?.window_days ?? 30} hari`} b={t?.window} loading={usage.loading} />
          <div className="card tile">
            <div className="tile-label-row">Estimasi biaya {d?.window_days ?? 30} hari <Coins size={16} /></div>
            {usage.loading ? <Skeleton w={80} h={28} /> : <div className="tile-num">{t ? fmtUsd(t.window.cost_usd) : "—"}</div>}
            {t && <div className="tile-ctx">Hari ini {fmtUsd(t.today.cost_usd)} · 7 hari {fmtUsd(t.last_7_days.cost_usd)}</div>}
            {t && <div className="tile-ctx">Semua waktu {fmtUsd(t.all_time.cost_usd)} ({t.all_time.sessions} sesi)</div>}
          </div>
          <div className="card tile">
            <div className="tile-label-row">Sesi aktif <MessageSquare size={16} /></div>
            {usage.loading ? <Skeleton w={48} h={28} /> : <div className="tile-num">{d ? d.active_sessions : "—"}<span className="unit">sesi</span></div>}
            <div className="tile-ctx">Lease chat yang masih hidup (semua profil)</div>
          </div>
        </div>
        {brokenProfiles.length > 0 && (
          <div className="xs" style={{ color: "var(--outcome-failed)" }}>
            state.db tidak terbaca: {brokenProfiles.map((p) => `${p.profile} (${p.error})`).join(", ")}
          </div>
        )}
      </section>

      {/* Bagian 2: breakdown */}
      <section className="section" aria-label="Breakdown">
        <div className="eyebrow">Breakdown {d?.window_days ?? 30} hari</div>
        {mobile ? (
          <>
            <div className="team-filter-bar" role="tablist" aria-label="Breakdown">
              {(["model", "agent"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k}
                  className={`team-filter-btn${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
                  {k === "model" ? "By Model" : "By Agent"}
                </button>
              ))}
            </div>
            {tab === "model" ? byModel : byAgent}
          </>
        ) : (
          <div className="dash-cols" style={{ gridTemplateColumns: "1fr 1fr" }}>{byModel}{byAgent}</div>
        )}
      </section>

      {/* Bagian 3: OpenCode */}
      <section className="section" aria-label="OpenCode">
        <div className="eyebrow">OpenCode</div>
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-head">
            <span className="card-title">OpenCode</span>
            <span style={{ marginLeft: "auto" }}>
              {tools.loading ? <Skeleton w={72} h={20} /> : oc
                ? <StatusBadge status={TOOL_BADGE[oc.state]} label={oc.state === "standby" ? "Standby" : undefined} title={oc.detail ?? undefined} />
                : <StatusBadge status="unknown" title={tools.error?.message ?? "OpenCode tidak ada di /api/agents/tools"} />}
            </span>
          </div>
          <div className="card-body">
            <div className="stat-grid" style={mobile ? { gridTemplateColumns: "1fr" } : undefined}>
              <div className="stat-cell">
                <div className="l">Model aktif</div>
                {d?.opencode.available
                  ? <div className="v mono-12" style={{ wordBreak: "break-all" }}>{d.opencode.provider} / {d.opencode.model}</div>
                  : <div className="v na" title={d?.opencode.error ?? undefined}>Tidak tersedia</div>}
              </div>
              <div className="stat-cell">
                <div className="l">Provider</div>
                {d?.opencode.provider ? <div className="v mono-12">{d.opencode.provider}</div> : <div className="v na">Tidak tersedia</div>}
              </div>
              <div className="stat-cell">
                <div className="l">Biaya</div>
                <div className="v na">Tidak tersedia</div>
              </div>
            </div>
            <div className="xs muted" style={{ marginTop: 8 }}>
              Penggunaan OpenCode tidak dilacak secara terpisah (OpenCode tidak menyimpan usage log).
            </div>
          </div>
        </div>
      </section>

      {/* Bagian 4: trend harian */}
      <section className="section" aria-label="Trend harian">
        <div className="eyebrow">Trend harian ({days.length} hari)</div>
        <div className="card">
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {usage.loading ? <Skeleton h={240} /> : days.slice().reverse().map((x) => (
              <div key={x.date} className="row xs" title={`${x.sessions} sesi · in ${nf.format(x.input_tokens)} · out ${nf.format(x.output_tokens)}`}>
                <span className="tabular muted" style={{ width: 44, flexShrink: 0 }}>{x.date.slice(5)}</span>
                <div style={{ flex: 1, height: 10, background: "var(--bg-surface-hover)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(x.total_tokens / maxTok) * 100}%`, height: "100%", background: x.cost_usd >= EXPENSIVE_USD ? "var(--outcome-failed)" : "var(--accent-secondary)" }} />
                </div>
                <span className="tabular" style={{ width: 64, textAlign: "right", flexShrink: 0 }}>{fmtTokens(x.total_tokens)}</span>
                <span style={{ width: 64, textAlign: "right", flexShrink: 0 }}><Cost v={x.cost_usd} /></span>
              </div>
            ))}
          </div>
        </div>
        <div className="xs muted">
          Total token = input + output (cache read/write tidak dihitung). Biaya = estimated_cost_usd dari Hermes, bukan tagihan aktual.
          Sorotan merah = ≥ ${EXPENSIVE_USD}.
        </div>
      </section>
    </div>
  );
}
