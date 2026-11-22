// Workflow view (t_b9f7d656, t_5115c601): animated node diagram of how requests flow through the AI agent team.
// Colors always come from theme/agents.ts -> --agent-* CSS variables (never hardcoded hex).
import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { identity } from "../theme/agents";

/** A flow node: `id` is an agent profile id (null = the requesting user, neutral color). */
interface FlowNode { id: string | null; name: string; desc: string }
/** A flow is a sequence of stages; every node of a stage links to every node of the next stage. */
interface Flow { key: string; label: string; title: string; stages: FlowNode[][] }

const USER = (desc: string): FlowNode => ({ id: null, name: "User", desc });
const claude = (desc: string): FlowNode => ({ id: "claude_cli", name: "Claude Code CLI", desc });

const FLOWS: Flow[] = [
  { key: "teknis", label: "Teknis", title: "Request Teknis / Aplikasi", stages: [
    [USER("Request teknis / aplikasi")],
    [{ id: "default", name: "Hawa The Second (COO)", desc: "Koordinasi & keputusan produk" }],
    [{ id: "goku_cto", name: "Goku The CTO", desc: "Perencanaan teknis & brief" }],
    [
      { id: "kuririn_dev_lead", name: "Kuririn The Dev", desc: "Implementasi kode" },
      { id: "bulma_uiux", name: "Bulma UI/UX", desc: "Desain & review visual" },
    ],
    [claude("Eksekusi kode, build, test")],
  ] },
  { key: "video", label: "Video", title: "Request Video", stages: [
    [USER("Request video")],
    [{ id: "default", name: "Hawa (COO)", desc: "Koordinasi & keputusan" }],
    [{ id: "beerus_digital_lead", name: "Beerus", desc: "Konsep konten, riset, brief kreatif" }],
    [{ id: "bejita_video_editor", name: "Bejita", desc: "Produksi video, editing, render" }],
    [claude("Render & build")],
  ] },
  { key: "riset", label: "Riset", title: "Riset / Data", stages: [
    [USER("Riset atau permintaan data")],
    [{ id: "default", name: "Hawa (COO)", desc: "Ditangani langsung atau melalui Goku" }],
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

const nodeColor = (id: string | null) => (id ? `var(${identity(id).cssVar})` : "var(--text-muted)");
const isTool = (id: string | null) => id !== null && identity(id).kind === "tool";
const nodeIcon = (id: string | null) => (id === null ? "👤" : isTool(id) ? ">_" : identity(id).shortName.charAt(0));
/** Center of slot `i` out of `n` equal slots, as a percentage string. */
const slot = (i: number, n: number) => `${((2 * i + 1) / (2 * n)) * 100}%`;

function Node({ n, active }: { n: FlowNode; active: boolean }) {
  const cls = `wf-node${isTool(n.id) ? " wf-node-tool" : ""}${active ? " wf-node-active" : ""}`;
  return (
    <div className={cls} style={{ "--wf-c": nodeColor(n.id) } as CSSProperties}>
      <span className="wf-icon" aria-hidden="true">{nodeIcon(n.id)}</span>
      <span className="wf-text">
        <span className="wf-name">{n.name}</span>
        <span className="wf-desc">{n.desc}</span>
      </span>
    </div>
  );
}

/** Animated arrows from every node of `from` to every node of `to`. Two SVGs: horizontal (desktop) and
 *  vertical (mobile); CSS shows the one matching the layout. Percent coordinates keep dashes unscaled. */
function Connector({ from, to }: { from: FlowNode[]; to: FlowNode[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const links = from.flatMap((_, a) => to.map((t, b) => ({ a, b, c: nodeColor(t.id) })));
  const svg = (dir: "h" | "v") => (
    <svg className={`wf-link wf-link-${dir}`} aria-hidden="true">
      <defs>
        {links.map((l, i) => (
          <marker key={i} id={`${uid}${dir}${i}`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: l.c }} />
          </marker>
        ))}
      </defs>
      {links.map((l, i) => {
        const ends = dir === "h"
          ? { x1: "0", y1: slot(l.a, from.length), x2: "100%", y2: slot(l.b, to.length) }
          : { x1: slot(l.a, from.length), y1: "0", x2: slot(l.b, to.length), y2: "100%" };
        return <line key={i} className="wf-flow-line" {...ends} style={{ stroke: l.c }} markerEnd={`url(#${uid}${dir}${i})`} />;
      })}
    </svg>
  );
  return <div className="wf-connector">{svg("h")}{svg("v")}</div>;
}

function Diagram({ flow }: { flow: Flow }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setActive((s) => (s + 1) % flow.stages.length), 2000);
    return () => window.clearInterval(t);
  }, [flow]);
  return (
    <div className="wf-diagram-wrap">
      <div className="wf-diagram">
        {flow.stages.map((stage, i) => (
          <div key={i} className="wf-stage-group">
            {i > 0 && <Connector from={flow.stages[i - 1]} to={stage} />}
            <div className="wf-stage">
              {stage.map((n, j) => <Node key={j} n={n} active={i === active} />)}
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
          <Diagram flow={flow} />
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
