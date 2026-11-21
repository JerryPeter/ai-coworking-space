// Task Board (spec 6.3, 5.5, 5.7). Read-only: the hermes kanban CLI owns writes.
import { ChevronDown, ChevronsUp, ChevronUp, Clock, Equal, Search, SquareKanban } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { KanbanColumn, KanbanTask } from "../api/types";
import { Drawer } from "../components/ui/Drawer";
import { PixelAvatar } from "../components/ui/PixelAvatar";
import { EmptyState, ErrorPanel, InlineText, RelTime, Skeleton } from "../components/ui/States";
import { setParams, useRoute } from "../lib/router";
import { usePageSubtitle } from "../lib/subtitle";
import { absolute, relative, toDate, useNow } from "../lib/time";
import { AGENTS, color, identity } from "../theme/agents";

// The 8 Hermes workflow columns, in board order. "archived" is a filter status, not a column.
const COLUMN_ORDER = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];
const DOT: Record<string, string> = {
  running: "var(--accent-primary)", review: "var(--status-reviewing)", blocked: "var(--outcome-failed)", done: "var(--outcome-success)",
};
const DONE_LIMIT = 20;

function updatedAt(t: KanbanTask) {
  return t.completed_at ?? t.started_at ?? t.created_at;
}

type Prio = { label: string; Icon: typeof ChevronUp; color: string } | null;
function priority(p: KanbanTask["priority"]): Prio {
  if (p == null || p === "") return null;
  const s = String(p).toLowerCase();
  if (s === "urgent") return { label: "Urgent", Icon: ChevronsUp, color: "var(--outcome-failed)" };
  if (s === "high") return { label: "High", Icon: ChevronUp, color: "var(--status-reviewing)" };
  if (s === "medium") return { label: "Medium", Icon: Equal, color: "var(--text-secondary)" };
  if (s === "low") return { label: "Low", Icon: ChevronDown, color: "var(--text-muted)" };
  // Numeric priority: the Hermes scale isn't documented in the API, so show the raw value neutrally.
  return { label: `P${s}`, Icon: Equal, color: "var(--text-secondary)" };
}

export default function TaskBoard() {
  const r = useApi(endpoints.kanban, 30_000);
  const now = useNow(15_000);
  const { params } = useRoute();
  const [who, setWho] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const total = r.data?.count;
  usePageSubtitle(total != null ? `· ${total} task${total === 1 ? "" : "s"}` : null);

  const columns: KanbanColumn[] = useMemo(() => {
    const cols = r.data?.columns ?? [];
    const known = COLUMN_ORDER.map((s) => cols.find((c) => c.status === s) ?? { status: s, label: s[0].toUpperCase() + s.slice(1), count: 0, tasks: [] });
    const extra = cols.filter((c) => !COLUMN_ORDER.includes(c.status) && c.status !== "archived");
    return [...known, ...extra];
  }, [r.data]);

  const filter = (t: KanbanTask) =>
    (!who.size || who.has(t.assignee ?? "__none")) && (!q || (t.title ?? "").toLowerCase().includes(q.toLowerCase()));

  const taskId = params.get("task");
  const openTask = taskId ? r.data?.columns?.flatMap((c) => c.tasks).find((t) => String(t.id) === taskId) : undefined;

  if (r.loading) return <div className="board">{COLUMN_ORDER.map((s) => <Skeleton key={s} w={304} h={240} r={12} style={{ flexShrink: 0 }} />)}</div>;
  if (r.error) return <ErrorPanel what="kanban tasks" error={r.error} onRetry={() => refetch(endpoints.kanban)} />;
  if (!r.data?.available) return <ErrorPanel what="kanban tasks" error={new Error(r.data?.error ?? "kanban.db unavailable")} onRetry={() => refetch(endpoints.kanban)} />;

  if (total === 0) {
    return (
      <div style={{ paddingTop: "12vh" }}>
        <EmptyState circle icon={<SquareKanban size={48} />} title="No tasks yet"
          body={<InlineText text="Use `hermes kanban create` from the CLI to add tasks. Agent Control Center shows tasks from the shared Hermes kanban (read-only):" />}
          cli="hermes kanban create"
          foot={<>Reading ~/.hermes/kanban.db · checked {r.updatedAt ? relative(r.updatedAt, now) : "—"}</>} />
      </div>
    );
  }

  const toggleWho = (id: string) => setWho((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <div className="page-head">
        <div className="chips" role="group" aria-label="Filter by assignee">
          {AGENTS.map((a) => (
            <button key={a.id} className="chip" aria-pressed={who.has(a.id)} onClick={() => toggleWho(a.id)}>
              <span className="dot" style={{ background: color(a.id) }} />{a.shortName}
            </button>
          ))}
          <button className="chip" aria-pressed={who.has("__none")} onClick={() => toggleWho("__none")}>Unassigned</button>
        </div>
        <div className="spacer" />
        <label className="search-wrap"><Search size={14} /><input className="search-input" style={{ width: 240 }} placeholder="Search titles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search task titles" /></label>
      </div>
      {r.data.truncated && <p className="xs muted" style={{ marginBottom: 8 }}>Showing {r.data.returned} of {total} tasks (API limit).</p>}
      <div className="board">
        {columns.map((c) => {
          let tasks = c.tasks.filter(filter);
          let hidden = 0;
          if (c.status === "done") {
            tasks = [...tasks].sort((a, b) => (toDate(updatedAt(b))?.getTime() ?? 0) - (toDate(updatedAt(a))?.getTime() ?? 0));
            if (!showOlder && tasks.length > DONE_LIMIT) { hidden = tasks.length - DONE_LIMIT; tasks = tasks.slice(0, DONE_LIMIT); }
          }
          return (
            <section key={c.status} className="kcol" aria-label={`${c.label} column`}>
              <div className="kcol-head">
                <span className="dot" style={{ background: DOT[c.status] ?? "var(--text-muted)" }} />
                <span className="kcol-name">{c.label}</span>
                <span className="count-pill">{c.count}</span>
              </div>
              <div className="kcol-body">
                {tasks.length === 0 ? <div className="kcol-empty">No tasks</div> : tasks.map((t) => <TaskCard key={String(t.id)} t={t} now={now} />)}
                {hidden > 0 && <button className="btn btn-text" onClick={() => setShowOlder(true)}>Show older ({hidden})</button>}
              </div>
            </section>
          );
        })}
      </div>
      {openTask && (
        <Drawer open onClose={() => setParams({ task: null })} title={openTask.title ?? `Task ${openTask.id}`} subtitle={`#${openTask.id} · ${openTask.status}`}>
          <dl className="kv">
            {Object.entries(openTask).map(([k, v]) => (
              <Fragment key={k}><dt className="mono-12">{k}</dt><dd className="mono-12">{v == null ? <span className="muted">null</span> : /_at$/.test(k) ? `${String(v)} (${absolute(v as string)})` : String(v)}</dd></Fragment>
            ))}
          </dl>
        </Drawer>
      )}
    </>
  );
}

function TaskCard({ t, now }: { t: KanbanTask; now: number }) {
  const p = priority(t.priority);
  const a = t.assignee ? identity(t.assignee) : null;
  return (
    <button type="button" className={`task-card${t.status === "blocked" ? " blocked" : ""}`} onClick={() => setParams({ task: String(t.id) })}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        {p ? <span className="prio" style={{ color: p.color }}><p.Icon size={12} />{p.label}</span> : <span />}
        <span className="mono-12 muted">#{String(t.id)}</span>
      </div>
      <div className="task-title clamp-3" title={t.title ?? undefined}>{t.title ?? <span className="muted">Untitled</span>}</div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        {a ? (
          <span className="row xs secondary" style={{ gap: 6 }}><PixelAvatar id={a.id} size={20} tile={false} />{a.shortName}</span>
        ) : (
          <span className="row xs muted" style={{ gap: 6 }}><span className="unassigned-dot" />Unassigned</span>
        )}
        <span className="row xs muted" style={{ gap: 4 }}><Clock size={12} /><RelTime t={updatedAt(t)} now={now} fallback="—" /></span>
      </div>
    </button>
  );
}
