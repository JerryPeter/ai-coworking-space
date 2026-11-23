// Workflow view (t_b9f7d656, t_5115c601): animated node diagram of how requests flow through the AI agent team.
// Design spec: Bulma (t_5115c601) — pill nodes w/ step number, SVG arrow overlay w/ agent-color gradients,
// continuous CSS-only dash animation (no JS timers — animation must never be "triggered by state").
// Colors always come from theme/agents.ts -> --agent-* CSS variables (never hardcoded hex).
import { Fragment, useId, useState } from "react";
import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { identity, color, subtle } from "../theme/agents";

/** A flow node: `id` is an agent profile id (null = the requesting user, neutral color). */
interface FlowNode { id: string | null; desc: string }
/** A flow is a sequence of stages; every node of a stage links to every node of the next stage
 *  (this models both branches, e.g. Goku -> {Kuririn, Bulma}, and merges, e.g. {Kuririn, Bulma} -> Claude). */
interface Flow { key: string; label: string; title: string; stages: FlowNode[][] }

const user = (desc: string): FlowNode => ({ id: null, desc });
const node = (id: string, desc: string): FlowNode => ({ id, desc });
const claude = (desc: string): FlowNode => node("claude_cli", desc);

const FLOWS: Flow[] = [
  { key: "teknis", label: "Teknis", title: "Request Teknis / Aplikasi", stages: [
    [user("Mengajukan request teknis atau aplikasi")],
    [node("default", "Koordinasi & keputusan produk")],
    [node("goku_cto", "Perencanaan teknis & brief")],
    [
      node("kuririn_dev_lead", "Implementasi kode"),
      node("bulma_uiux", "Desain & review visual"),
    ],
    [claude("Eksekusi kode, build, test")],
  ] },
  { key: "video", label: "Video", title: "Request Video", stages: [
    [user("Mengajukan request video")],
    [node("default", "Koordinasi & keputusan")],
    [node("beerus_digital_lead", "Konsep konten, riset, brief kreatif")],
    [node("bejita_video_editor", "Produksi video, editing, render")],
    [claude("Render & build")],
  ] },
  { key: "riset", label: "Riset", title: "Riset / Data", stages: [
    [user("Mengajukan riset atau permintaan data")],
    [node("default", "Ditangani langsung atau melalui Goku")],
  ] },
];

const DELEGATION: [string, string][] = [
  ["Menulis kode", "Kuririn The Dev (via Goku)"],
  ["Desain UI / review visual", "Bulma UI/UX"],
  ["Arsitektur & brief teknis", "Goku The CTO"],
  ["Konsep konten, riset & brief kreatif", "Beerus (Digital & Creative Lead)"],
  ["Editing & render video", "Bejita (Video Editor)"],
  ["Build, test & eksekusi kode", "Claude Code CLI"],
];

/** Center of slot `i` out of `n` equal slots, as a percentage string (for arrow endpoints). */
const slot = (i: number, n: number) => `${((2 * i + 1) / (2 * n)) * 100}%`;
const nodeColor = (id: string | null) => (id === null ? "var(--text-muted)" : color(id));
const nodeSubtle = (id: string | null) => (id === null ? "transparent" : subtle(id));
const nodeName = (id: string | null) => (id === null ? "User" : identity(id).shortName);

/** Node state (spec: aktif / selesai / pending). This diagram has no live execution-status feed yet,
 *  so every real agent/tool renders "aktif" (the team is always available) and the user is neutral.
 *  `--done`/`--pending` styling is implemented and ready to wire up once real step-status data exists. */
type NodeState = "user" | "active" | "done" | "pending";
const nodeState = (id: string | null): NodeState => (id === null ? "user" : "active");

function Node({ n, step }: { n: FlowNode; step: number }) {
  const state = nodeState(n.id);
  const style = { "--wf-c": nodeColor(n.id), "--wf-c-subtle": nodeSubtle(n.id) } as CSSProperties;
  return (
    <div className={`wf-node wf-node--${state}`} style={style} title={n.desc}>
      <span className="wf-node-step">{String(step).padStart(2, "0")}</span>
      <span className="wf-node-name">{nodeName(n.id)}</span>
      {state === "done" && <Check className="wf-node-check" size={12} aria-hidden="true" />}
    </div>
  );
}

/** SVG arrow overlay between two adjacent stages: one line per (from-node, to-node) pair, gradient
 *  from the source agent's color to the target's. A link only "flows" (dashed + animated) when both
 *  ends are real agents — the initial User -> Hawa hop is drawn idle/solid, matching the idle arrow spec. */
function Connector({ from, to }: { from: FlowNode[]; to: FlowNode[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const links = from.flatMap((f, a) => to.map((t, b) => ({ a, b, src: f.id, tgt: t.id })));
  return (
    <svg className="wf-link" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        {links.map((l, i) => (
          <Fragment key={i}>
            {/* userSpaceOnUse is required: with the default objectBoundingBox units a horizontal line
                (1 -> 1 node, y1 === y2) has a zero-height bbox, so the gradient paint is invalid and the
                line is not rendered at all (only its marker shows) - that also hid the flow animation. */}
            <linearGradient id={`${uid}g${i}`} gradientUnits="userSpaceOnUse"
              x1="0" y1={slot(l.a, from.length)} x2="100%" y2={slot(l.b, to.length)}>
              <stop offset="0%" style={{ stopColor: nodeColor(l.src) }} />
              <stop offset="100%" style={{ stopColor: nodeColor(l.tgt) }} />
            </linearGradient>
            <marker id={`${uid}m${i}`} viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" style={{ fill: nodeColor(l.tgt) }} />
            </marker>
          </Fragment>
        ))}
      </defs>
      {links.map((l, i) => {
        const active = l.src !== null && l.tgt !== null;
        return (
          <line key={i}
            x1="0" y1={slot(l.a, from.length)} x2="100%" y2={slot(l.b, to.length)}
            className={`wf-flow-line${active ? " wf-flow-line--active" : ""}`}
            style={{ stroke: active ? `url(#${uid}g${i})` : "var(--border-strong)" }}
            markerEnd={`url(#${uid}m${i})`}
          />
        );
      })}
    </svg>
  );
}

function Diagram({ flow }: { flow: Flow }) {
  let step = 0;
  return (
    <div className="wf-canvas">
      <div className="wf-canvas-grid" aria-hidden="true" />
      <div className="wf-diagram">
        {flow.stages.map((stage, i) => (
          <div key={i} className="wf-stage-group">
            {i > 0 && <Connector from={flow.stages[i - 1]} to={stage} />}
            <div className="wf-stage">
              {stage.map((n, j) => { step += 1; return <Node key={j} n={n} step={step} />; })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkflowView() {
  const [sel, setSel] = useState(FLOWS[0].key);
  const flow = FLOWS.find((f) => f.key === sel) ?? FLOWS[0];
  return (
    <div className="stack">
      <div className="section">
        <div className="eyebrow">Workflow</div>
        <h1 className="wf-title">Alur Kerja Tim AI Agent Control Center</h1>
      </div>
      <section className="section">
        <div className="wf-tabs-row">
          <div className="segmented" role="group" aria-label="Pilih alur">
            {FLOWS.map((f) => (
              <button key={f.key} type="button" aria-pressed={f.key === sel} onClick={() => setSel(f.key)}>{f.label}</button>
            ))}
          </div>
        </div>
        <div className="card wf-card">
          <h2 className="wf-flow-title">{flow.title}</h2>
          {/* key: remount per tab so gradient/marker ids and the CSS dash animation start fresh on every switch */}
          <Diagram key={flow.key} flow={flow} />
        </div>
      </section>
      <section className="section">
        <div className="eyebrow">Delegasi</div>
        <div className="card wf-card">
          <div className="wf-table-wrap">
            <table className="wf-table">
              <thead><tr><th>Hawa tidak mengerjakan langsung</th><th>Hawa mendelegasikan ke tim</th></tr></thead>
              <tbody>{DELEGATION.map(([task, who]) => <tr key={task}><td>{task}</td><td>{who}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
