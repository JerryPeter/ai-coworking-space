// Workflow view (t_b9f7d656): how requests flow through the AI agent team. Colors come from theme/agents.ts.
import { identity } from "../theme/agents";

/** A flow node: `id` is an agent profile id (null = the requesting user, neutral color). */
interface FlowNode { id: string | null; name: string; desc: string; children?: FlowNode[] }
interface Flow { title: string; root: FlowNode }

const claude = (desc: string): FlowNode => ({ id: "claude_cli", name: "Claude Code CLI", desc });

const FLOWS: Flow[] = [
  { title: "Request Teknis / Aplikasi", root: {
    id: null, name: "User", desc: "Mengajukan request teknis atau aplikasi", children: [{
      id: "default", name: "Hawa The Second (COO)", desc: "Koordinasi & keputusan produk", children: [{
        id: "goku_cto", name: "Goku The CTO", desc: "Perencanaan teknis & brief", children: [
          { id: "kuririn_dev_lead", name: "Kuririn The Dev", desc: "Implementasi kode", children: [claude("Eksekusi kode, build, test")] },
          { id: "bulma_uiux", name: "Bulma UI/UX", desc: "Desain & review visual", children: [claude("Eksekusi kode, build, test")] },
        ],
      }],
    }],
  } },
  { title: "Request Video", root: {
    id: null, name: "User", desc: "Mengajukan request video", children: [{
      id: "default", name: "Hawa (COO)", desc: "Koordinasi & keputusan", children: [{
        id: "beerus_digital_lead", name: "Beerus (Digital & Creative Lead)", desc: "Konsep konten, riset, brief kreatif", children: [{
          id: "bejita_video_editor", name: "Bejita (Video Editor)", desc: "Produksi video, editing, render", children: [claude("Render & build")],
        }],
      }],
    }],
  } },
  { title: "Riset / Data", root: {
    id: null, name: "User", desc: "Mengajukan riset atau permintaan data", children: [{
      id: "default", name: "Hawa (COO)", desc: "Ditangani langsung atau melalui Goku", children: [
        { id: "goku_cto", name: "Goku The CTO", desc: "Opsional: riset teknis mendalam" },
      ],
    }],
  } },
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

function Node({ n }: { n: FlowNode }) {
  return (
    <li className="wf-item">
      <div className="wf-node">
        <span className="wf-dot" style={{ background: nodeColor(n.id) }} aria-hidden="true" />
        <span className="wf-name">{n.name}</span>
        <span className="wf-desc">— {n.desc}</span>
      </div>
      {n.children?.length ? <ul className="wf-list">{n.children.map((c, i) => <Node key={i} n={c} />)}</ul> : null}
    </li>
  );
}

export default function WorkflowView() {
  return (
    <div className="stack">
      <div className="section">
        <div className="eyebrow">Workflow</div>
        <h1 className="wf-title">Alur Kerja Tim AI Agent Control Center</h1>
      </div>
      {FLOWS.map((f, i) => (
        <section key={f.title} className="section">
          <div className="eyebrow">Alur {i + 1}</div>
          <div className="card wf-card">
            <h2 className="wf-flow-title">{f.title}</h2>
            <ul className="wf-list wf-root"><Node n={f.root} /></ul>
          </div>
        </section>
      ))}
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
