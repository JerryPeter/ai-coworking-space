// 3D Office: realistic two-floor office (port of the "AI Office 3D" HTML reference), lazy-loaded
// so only this view pays for Three.js. REAL data only, no simulation:
// - /api/office/state every 5 s → Hermes agents + Claude Code CLI
// - /api/openclaw/agents every 15 s → OpenClaw team (chief / researcher / writer / reviewer)
// The scene owns its own roster + detail panel (right side); clicking a Hermes agent or Claude CLI
// also opens the AgentDrawer via ?agent=<id>. OpenClaw agents have no drawer yet.
import { Moon, Sun, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { endpoints, useApi } from "../api/client";
import type { OfficeAgent, OfficeState, OpenClawAgent, ToolState } from "../api/types";
import { ErrorPanel } from "../components/ui/States";
import { StatusBadge } from "../components/ui/StatusBadge";
import { officeBadge, toolBadge } from "../lib/derive";
import { setParams, useRoute } from "../lib/router";
import { relative, useNow } from "../lib/time";
import { CLAUDE_AGENT_ID, OfficeScene3D, STATUS, webglAvailable, type AgentStatus, type Preset } from "../office/OfficeScene3D";
import { readTod, store, TOD_KEY, type TimeOfDay } from "../office/palettes";
import { identity, rosterIndex } from "../theme/agents";

const PRESETS: { p: Preset; label: string; title: string }[] = [
  { p: "workspace", label: "Lantai 1", title: "Lantai 1: Ruang Kerja, Meeting, Tamu, Island Hangout (Lantai 2 disembunyikan)" },
  { p: "lounge", label: "Lantai 2", title: "Lantai 2: Kamar Tidur, Sofa Baca, Ruang Game, Tempat Istirahat, Balkon" },
  { p: "overview", label: "Semua", title: "Kedua lantai" },
];

// OpenClaw team: the Agents view cards have no per-agent colour, so these are picked from the
// reference's SHIRTS palette, chosen to stay distinct from the Hermes + Claude colours.
const OPENCLAW_ORDER = ["chief", "researcher", "writer", "reviewer"];
const OPENCLAW_COLOR: Record<string, string> = { chief: "#e2a91a", researcher: "#22a3b3", writer: "#2f9e6f", reviewer: "#6b7785" };
const OPENCLAW_FALLBACK = ["#e4572e", "#3d7fd9", "#8a5cd0", "#d9488f"];
const OPENCLAW_RECENT_MS = 30 * 60_000; // last run within 30 min → "break", else idle
const ocId = (name: string) => `openclaw:${name}`;

/** /api/office/state → scene status. working (kanban or session) → desk, reviewing → meeting room. */
function officeStatus(s: OfficeState): AgentStatus {
  switch (s) {
    case "working": return "working";
    case "reviewing": return "meeting";
    case "idle": return "idle";
    case "offline": return "offline";
    default: return "error"; // unknown
  }
}
function openclawStatus(a: OpenClawAgent, now: number): AgentStatus {
  if (a.is_running) return "working";
  const t = a.last_run_at ? Date.parse(a.last_run_at) : NaN;
  return !isNaN(t) && now - t < OPENCLAW_RECENT_MS ? "break" : "idle";
}
const ZONE: Record<AgentStatus, string> = {
  working: "Lantai 1 · Ruang Kerja", meeting: "Lantai 1 · Ruang Meeting", waiting: "Lantai 1 · Ruang Tamu",
  idle: "Area santai (Lantai 1/2)", break: "Lantai 2 · Ruang Game / Tempat Istirahat", offline: "Lantai 2 · Kamar Tidur", error: "Lantai 1 · Ruang Kerja",
};
const toolStatus = (s: ToolState | undefined): AgentStatus => (s === "working" ? "working" : s === "idle" ? "idle" : "offline");
const hermesTask = (a: OfficeAgent) => a.current_task?.title || a.last_activity || null;
const known = (v: string) => (v === "Not Available" ? null : v);

export default function Office() {
  const office = useApi(endpoints.office, 5_000);
  const oc = useApi(endpoints.openclaw, 15_000);
  const { params } = useRoute();
  const now = useNow(5_000);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene3D | null>(null);
  const [ready, setReady] = useState(false);
  const [gl] = useState(webglAvailable);
  const [preset, setPreset] = useState<Preset>("overview");
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [tod, setTod] = useState<TimeOfDay>(readTod);
  const [labels, setLabels] = useState(true);
  const ui = useRef({ tod, preset, labels });
  ui.current = { tod, preset, labels };
  const focusParam = params.get("focus");
  const sceneOk = gl && !sceneError;

  // Mount the scene once; dispose runs on every view navigation.
  useEffect(() => {
    if (!host.current || !sceneOk) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let s: OfficeScene3D;
    try {
      s = new OfficeScene3D(host.current, {
        // OpenClaw agents have no drawer yet; the in-scene detail panel still shows them.
        onSelect: (id) => { if (!id.startsWith("openclaw:")) setParams({ agent: id, tab: null }); },
        onFirstFrame: () => setReady(true),
        onPresetChange: setPreset,
        reducedMotion,
      });
    } catch (e) {
      setSceneError((e as Error).message);
      return;
    }
    scene.current = s;
    s.setTimeOfDay(ui.current.tod, { instant: true });
    s.setLabels(ui.current.labels);
    if (ui.current.preset !== "overview") s.preset(ui.current.preset);
    return () => { s.dispose(); scene.current = null; setReady(false); };
  }, [sceneOk]);

  const chooseTod = (next: TimeOfDay) => {
    if (next === tod) return;
    setTod(next);
    store(TOD_KEY, next);
    scene.current?.setTimeOfDay(next);
  };

  // Push real API state into the scene (re-runs on `ready`, so a fresh scene gets it at once).
  const data = office.data;
  const ocData = oc.data;
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const ids: string[] = [];
    if (data) {
      [...data.agents].sort((a, b) => rosterIndex(a.name) - rosterIndex(b.name)).forEach((a) => {
        const ident = identity(a.name);
        s.setAgentState(a.name, officeStatus(a.state), a.display_name || ident.displayName, hermesTask(a), {
          role: known(ident.role), color: ident.hex, desk: ident.desk,
          lastActive: a.last_activity_at, reason: a.state_reason,
        });
        ids.push(a.name);
      });
      s.setRobotState(data.claude_tool?.state ?? "unknown", data.claude_tool?.detail ?? "");
      ids.push(CLAUDE_AGENT_ID);
    } else ids.push(...s.agentIds().filter((id) => !id.startsWith("openclaw:")));
    if (ocData) {
      const ocRank = (n: string) => { const i = OPENCLAW_ORDER.indexOf(n); return i < 0 ? 99 : i; };
      [...ocData.agents].sort((a, b) => ocRank(a.name) - ocRank(b.name)).forEach((a, i) => {
        const oi = OPENCLAW_ORDER.indexOf(a.name);
        s.setAgentState(ocId(a.name), openclawStatus(a, now), a.display_name || a.name, null, {
          role: a.theme ? `${a.theme} (OpenClaw)` : "OpenClaw agent",
          color: OPENCLAW_COLOR[a.name] ?? OPENCLAW_FALLBACK[i % OPENCLAW_FALLBACK.length],
          desk: oi >= 0 ? 5 + oi : undefined,
          lastActive: a.last_run_at,
          reason: a.error ?? (a.is_running ? "OpenClaw: sedang berjalan" : `OpenClaw gateway ${a.gateway_status}`),
        });
        ids.push(ocId(a.name));
      });
    } else ids.push(...s.agentIds().filter((id) => id.startsWith("openclaw:")));
    s.retainAgents(ids);
  }, [data, ocData, ready, now]);

  // ?focus=<id> (from "Open in 3D Office"): fly to the character once the scene is up.
  useEffect(() => {
    if (!ready || !focusParam || !scene.current) return;
    scene.current.focus(focusParam);
    setParams({ focus: null }, true);
  }, [ready, focusParam]);

  const initError = !gl ? "WebGL is not available in this browser" : sceneError;
  if (initError) {
    const rows = [
      ...[...(data?.agents ?? [])].sort((a, b) => rosterIndex(a.name) - rosterIndex(b.name)).map((a) => ({
        key: a.name, name: a.display_name || identity(a.name).displayName, zone: ZONE[officeStatus(a.state)],
        badge: <StatusBadge status={officeBadge(a.state)} />, reason: a.state_reason,
      })),
      ...(data ? [{
        key: CLAUDE_AGENT_ID, name: "Claude Code CLI", zone: ZONE[toolStatus(data.claude_tool?.state)],
        badge: <StatusBadge status={toolBadge(data.claude_tool?.state)} />, reason: data.claude_tool?.detail ?? "–",
      }] : []),
      ...(ocData?.agents ?? []).map((a) => {
        const st = openclawStatus(a, now);
        return { key: ocId(a.name), name: `${a.display_name} (OpenClaw)`, zone: ZONE[st], badge: <span className="xs">{STATUS[st].label}</span>, reason: a.error ?? "–" };
      }),
    ];
    return (
      <div className="webgl-fallback stack">
        <ErrorPanel what="the office view" error={new Error(initError)} />
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="simple">
            <thead><tr><th>Agent</th><th>Zone</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}><td>{r.name}</td><td>{r.zone}</td><td>{r.badge}</td><td className="xs secondary">{r.reason}</td></tr>
              ))}
            </tbody>
          </table>
          {!data && <p className="sm muted" style={{ padding: 16 }}>{office.error ? office.error.message : "Loading office state…"}</p>}
        </div>
      </div>
    );
  }

  const errors = [office.error && `Office: ${office.error.message}`, oc.error && `OpenClaw: ${oc.error.message}`].filter(Boolean);
  return (
    <div className="office">
      <div className="office-frame">
        <div ref={host} className={`office-canvas${ready ? " ready" : ""}`} />
        <div className="ov ov-tl">
          <div className="segmented" role="radiogroup" aria-label="Time of day">
            <button className="icon tod-day" role="radio" aria-checked={tod === "day"} aria-pressed={tod === "day"} aria-label="Day" title="Siang"
              onClick={() => chooseTod("day")}><Sun size={16} /></button>
            <button className="icon tod-night" role="radio" aria-checked={tod === "night"} aria-pressed={tod === "night"} aria-label="Night" title="Malam"
              onClick={() => chooseTod("night")}><Moon size={16} /></button>
          </div>
          <span className="ov-sep" aria-hidden="true" />
          <div className="segmented" role="group" aria-label="Pilih lantai">
            {PRESETS.map(({ p, label, title }) => (
              <button key={p} aria-pressed={preset === p} title={title} onClick={() => { setPreset(p); scene.current?.preset(p); }}>{label}</button>
            ))}
          </div>
          <span className="ov-sep" aria-hidden="true" />
          <div className="segmented">
            <button className="icon" aria-pressed={labels} aria-label="Label ruang" title="Label ruang"
              onClick={() => { setLabels(!labels); scene.current?.setLabels(!labels); }}><Tag size={16} /></button>
          </div>
        </div>
        <div className="ov ov-bl">Seret untuk memutar · gulir untuk zoom · klik kanan untuk menggeser · klik agent untuk detail</div>
        <div className="ov ov-br tabular">
          {office.updatedAt ? `State updated ${relative(office.updatedAt, now)} · every 5s` : "Loading state…"}
          {errors.map((e) => <div key={e} className="xs" style={{ color: "var(--outcome-failed)" }}>{e}</div>)}
        </div>
      </div>
    </div>
  );
}
