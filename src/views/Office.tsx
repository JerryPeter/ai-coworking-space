// 3D Office: the "Town Hall AI Agent" 3-floor building (port of the Town Hall HTML reference), lazy-loaded
// so only this view pays for Three.js. REAL data only, no simulation:
// - /api/office/state every 5 s → Hermes agents + Claude Code CLI
// - /api/openclaw/agents every 15 s → OpenClaw team (chief / researcher / writer / reviewer)
// - /api/agents/tools every 5 s → OpenCode engine state (working / standby / offline)
// The scene owns its own roster + detail panel (right side); clicking a Hermes agent or Claude CLI
// also opens the AgentDrawer via ?agent=<id>. OpenClaw agents have no drawer yet.
import { House, Minus, Moon, Plus, RotateCw, SlidersHorizontal, Sun, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { endpoints, useApi } from "../api/client";
import type { OfficeAgent, OfficeState, OpenClawAgent, ToolState } from "../api/types";
import { ErrorPanel } from "../components/ui/States";
import { StatusBadge } from "../components/ui/StatusBadge";
import { officeBadge, toolBadge } from "../lib/derive";
import { setParams, useRoute } from "../lib/router";
import { relative, useNow } from "../lib/time";
import { CLAUDE_AGENT_ID, OPENCODE_AGENT_ID, OfficeScene3D, STATUS, webglAvailable, type AgentStatus, type OpenCodeState, type Preset } from "../office/OfficeScene3D";
import { MODE_KEY, readMode, readTod, readVisual, store, TOD_KEY, VISUAL_KEY, type TimeOfDay, type VisualPrefs } from "../office/palettes";
import { identity, rosterIndex } from "../theme/agents";

const FLOORS: { p: Preset; label: string; title: string }[] = [
  { p: 1, label: "Lantai 1", title: "Lantai 1: Ruang Kerja (bekerja / offline), Ruang Meeting (review), Lobby" },
  { p: 2, label: "Lantai 2", title: "Lantai 2: Perpustakaan & Lounge, Coffee Corner (idle)" },
  { p: 3, label: "Lantai 3", title: "Lantai 3: Ruang Game, Tempat Istirahat (istirahat), Balkon" },
  { p: 4, label: "Atap", title: "Atap: panel surya & taman atap" },
  { p: "all", label: "Semua", title: "Seluruh gedung" },
  { p: "x", label: "Pisah lantai", title: "Pisahkan lantai secara vertikal" },
];
const STYLES = [{ v: 1, label: "Style 1" }, { v: 2, label: "Style 2" }, { v: 3, label: "Style 3" }] as const;

// OpenClaw team: the Agents view cards have no per-agent colour, so these are picked from the
// reference's SHIRTS palette, chosen to stay distinct from the Hermes + Claude colours.
const OPENCLAW_ORDER = ["chief", "researcher", "writer", "reviewer"];
const OPENCLAW_COLOR: Record<string, string> = { chief: "#e2a91a", researcher: "#22a3b3", writer: "#2f9e6f", reviewer: "#6b7785" };
const OPENCLAW_ROLE: Record<string, string> = { chief: "chief", researcher: "researcher", writer: "writer", reviewer: "reviewer" };
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
  working: "Lantai 1 · Ruang Kerja", meeting: "Lantai 1 · Ruang Meeting Utama", waiting: "Lantai 1 · Lobby",
  idle: "Lantai 2 · Perpustakaan & Lounge / Coffee Corner", break: "Lantai 3 · Ruang Game / Tempat Istirahat",
  offline: "Lantai 1 · Ruang Kerja (meja sendiri, redup)", error: "Lantai 1 · Ruang Kerja (status tidak diketahui)",
};
const toolStatus = (s: ToolState | undefined): AgentStatus => (s === "working" ? "working" : s === "idle" ? "idle" : "offline");
/** OpenCode entry of GET /api/agents/tools (state is working|standby|offline; anything else → unknown). */
const OPC_STATES: readonly OpenCodeState[] = ["working", "standby", "offline"];
const OPC_LABEL: Record<OpenCodeState, string> = { working: "Bekerja", standby: "Standby", offline: "Offline", unknown: "Tidak diketahui" };
function openCodeTool(tools: { name: string; state: string; detail: string | null }[] | undefined): { state: OpenCodeState; detail: string } {
  const t = tools?.find((x) => x.name === "OpenCode");
  if (!t) return { state: "unknown", detail: tools ? "OpenCode tidak ada di /api/agents/tools" : "Memuat status OpenCode…" };
  const state = (OPC_STATES as readonly string[]).includes(t.state) ? (t.state as OpenCodeState) : "unknown";
  return { state, detail: t.detail ?? "" };
}
const hermesTask = (a: OfficeAgent) => a.current_task?.title || a.last_activity || null;
const known = (v: string) => (v === "Not Available" ? null : v);

export default function Office() {
  const office = useApi(endpoints.office, 5_000);
  const oc = useApi(endpoints.openclaw, 15_000);
  const tools = useApi(endpoints.tools, 5_000);
  const opc = openCodeTool(tools.data?.tools);
  const { params } = useRoute();
  const now = useNow(5_000);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene3D | null>(null);
  const [ready, setReady] = useState(false);
  const [gl] = useState(webglAvailable);
  const [preset, setPresetState] = useState<Preset>(readMode);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [tod, setTod] = useState<TimeOfDay>(readTod);
  const [visual, setVisualState] = useState<VisualPrefs>(readVisual);
  const [rotate, setRotate] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const popBtn = useRef<HTMLButtonElement>(null);
  const ui = useRef({ tod, preset, visual });
  ui.current = { tod, preset, visual };
  const setPreset = (p: Preset) => { setPresetState(p); store(MODE_KEY, String(p)); };
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
        onPresetChange: (p) => { setPresetState(p); store(MODE_KEY, String(p)); },
        reducedMotion,
      });
    } catch (e) {
      setSceneError((e as Error).message);
      return;
    }
    scene.current = s;
    const v = ui.current.visual;
    s.setStyle(v.style); s.setWeather(v.weather); s.setScope(v.scope); s.setClouds(v.clouds);
    s.setLowWalls(v.low); s.setWoodFloor(v.wood); s.setVendors(v.vendors); s.setLabels(v.labels);
    s.setTimeOfDay(ui.current.tod, { instant: true });
    if (ui.current.preset !== "all") s.preset(ui.current.preset, { instant: true });
    return () => { s.dispose(); scene.current = null; setReady(false); };
  }, [sceneOk]);

  /** Update one visual setting: React state, localStorage and the live scene. */
  const setVisual = <K extends keyof VisualPrefs>(k: K, val: VisualPrefs[K]) => {
    const next = { ...ui.current.visual, [k]: val };
    setVisualState(next); store(VISUAL_KEY, JSON.stringify(next));
    const s = scene.current; if (!s) return;
    if (k === "style") s.setStyle(next.style); else if (k === "weather") s.setWeather(next.weather); else if (k === "scope") s.setScope(next.scope);
    else if (k === "clouds") s.setClouds(next.clouds); else if (k === "low") s.setLowWalls(next.low); else if (k === "wood") s.setWoodFloor(next.wood);
    else if (k === "vendors") s.setVendors(next.vendors); else if (k === "labels") s.setLabels(next.labels);
  };

  // Close the visual-settings popup on any click outside it (reference behaviour) or on Escape.
  useEffect(() => {
    if (!popOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !popBtn.current?.contains(t)) setPopOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPopOpen(false); };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [popOpen]);

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
      const claudeState = data.claude_tool?.state === "working" || data.claude_tool?.state === "idle"
        ? data.claude_tool.state : "unknown";
      s.setRobotState(claudeState, data.claude_tool?.detail ?? "");
      ids.push(CLAUDE_AGENT_ID);
      s.setOpenCodeState(opc.state, opc.detail);
      ids.push(OPENCODE_AGENT_ID);
    } else ids.push(...s.agentIds().filter((id) => !id.startsWith("openclaw:")));
    if (ocData) {
      const ocRank = (n: string) => { const i = OPENCLAW_ORDER.indexOf(n); return i < 0 ? 99 : i; };
      [...ocData.agents].sort((a, b) => ocRank(a.name) - ocRank(b.name)).forEach((a, i) => {
        const oi = OPENCLAW_ORDER.indexOf(a.name);
        s.setAgentState(ocId(a.name), openclawStatus(a, now), a.display_name || a.name, null, {
          role: OPENCLAW_ROLE[a.name] ?? "openclaw",
          color: OPENCLAW_COLOR[a.name] ?? OPENCLAW_FALLBACK[i % OPENCLAW_FALLBACK.length],
          desk: oi >= 0 ? 5 + oi : undefined,
          lastActive: a.last_run_at,
          reason: a.error ?? (a.is_running ? "OpenClaw: sedang berjalan" : `OpenClaw gateway ${a.gateway_status}`),
        });
        ids.push(ocId(a.name));
      });
    } else ids.push(...s.agentIds().filter((id) => id.startsWith("openclaw:")));
    s.retainAgents(ids);
  }, [data, ocData, ready, now, opc.state, opc.detail]);

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
      }, {
        key: OPENCODE_AGENT_ID, name: "OpenCode", zone: "Lantai 2 · Area Kerja Agen",
        badge: <span className="xs">{OPC_LABEL[opc.state]}</span>, reason: opc.detail || "–",
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
    <div className="office" data-style={visual.style}>
      <div className="office-frame">
        <div ref={host} className={`office-canvas${ready ? " ready" : ""}`} />
        <div className="ov ov-tl th-bar" role="toolbar" aria-label="Kontrol tampilan">
          <select className="th-sel" aria-label="Pilih gaya tampilan" title="Gaya tampilan" value={visual.style}
            onChange={(e) => setVisual("style", Number(e.target.value) as VisualPrefs["style"])}>
            {STYLES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <span className="ov-sep" aria-hidden="true" />
          <div className="segmented" role="radiogroup" aria-label="Time of day">
            <button className="icon tod-day" role="radio" aria-checked={tod === "day"} aria-pressed={tod === "day"} aria-label="Day" title="Mode siang"
              onClick={() => chooseTod("day")}><Sun size={16} /></button>
            <button className="icon tod-night" role="radio" aria-checked={tod === "night"} aria-pressed={tod === "night"} aria-label="Night" title="Mode malam"
              onClick={() => chooseTod("night")}><Moon size={16} /></button>
          </div>
          <span className="ov-sep" aria-hidden="true" />
          <div className="segmented" role="group" aria-label="Pilih lantai">
            {FLOORS.map(({ p, label, title }) => (
              <button key={String(p)} aria-pressed={preset === p} title={title} onClick={() => { setPreset(p); scene.current?.preset(p); }}>{label}</button>
            ))}
          </div>
          <span className="ov-sep" aria-hidden="true" />
          <div className="segmented">
            <button ref={popBtn} className="icon" aria-pressed={popOpen} aria-expanded={popOpen} aria-controls="th-visual-pop" aria-label="Pengaturan visual" title="Pengaturan visual"
              onClick={() => setPopOpen(!popOpen)}><SlidersHorizontal size={16} /></button>
            <button className="icon" aria-pressed={visual.labels} aria-label="Label ruang" title="Tampilkan/sembunyikan label ruang"
              onClick={() => setVisual("labels", !visual.labels)}><Tag size={16} /></button>
            <button className="icon" aria-pressed={rotate} aria-label="Putar otomatis" title="Putar otomatis"
              onClick={() => { setRotate(!rotate); scene.current?.setAutoRotate(!rotate); }}><RotateCw size={16} /></button>
            <button className="icon" aria-label="Reset kamera" title="Kembali ke sudut awal"
              onClick={() => scene.current?.resetCamera()}><House size={16} /></button>
          </div>
        </div>
        {popOpen && (
          <div ref={popRef} id="th-visual-pop" className="ov th-pop" role="dialog" aria-label="Pengaturan visual">
            <p className="th-pop-t">Tampilan</p>
            <label className="th-chk"><input type="radio" name="th-scope" checked={visual.scope === "all"} onChange={() => setVisual("scope", "all")} /> Tampilkan semua ornamen</label>
            <label className="th-chk"><input type="radio" name="th-scope" checked={visual.scope === "building"} onChange={() => setVisual("scope", "building")} /> Hanya gedung kantor</label>
            <div className="th-pop-sep" />
            <p className="th-pop-t">Cuaca</p>
            {([["clear", "Cerah"], ["rain", "Hujan"], ["snow", "Salju"]] as const).map(([w, l]) => (
              <label key={w} className="th-chk"><input type="radio" name="th-weather" checked={visual.weather === w} onChange={() => setVisual("weather", w)} /> {l}</label>
            ))}
            <div className="th-pop-sep" />
            <p className="th-pop-t">Lainnya</p>
            <label className="th-chk"><input type="checkbox" checked={visual.clouds} onChange={(e) => setVisual("clouds", e.target.checked)} /> Tampilkan awan</label>
            <label className="th-chk"><input type="checkbox" checked={visual.low} onChange={(e) => setVisual("low", e.target.checked)} /> Tembok rendah</label>
            <label className="th-chk"><input type="checkbox" checked={visual.wood} onChange={(e) => setVisual("wood", e.target.checked)} /> Lantai kayu</label>
            <label className="th-chk"><input type="checkbox" checked={visual.vendors} onChange={(e) => setVisual("vendors", e.target.checked)} /> Tampilkan pedagang kaki lima</label>
          </div>
        )}
        <div className="ov ov-bl th-brand">
          <b>JRRYPTR</b>
          <span title="Seret untuk memutar · gulir untuk zoom · klik kanan untuk menggeser · klik agent untuk detail">Kantor virtual 3D · klik agent untuk detail</span>
          <span className="tabular th-state">
            {office.updatedAt ? `State updated ${relative(office.updatedAt, now)} · every 5s` : "Loading state…"}
          </span>
          {errors.map((e) => <span key={e} className="xs" style={{ color: "var(--outcome-failed)" }}>{e}</span>)}
        </div>
        <div className="th-zoom">
          <button className="ov" aria-label="Perbesar" title="Perbesar" onClick={() => scene.current?.zoom(0.75)}><Plus size={18} /></button>
          <button className="ov" aria-label="Perkecil" title="Perkecil" onClick={() => scene.current?.zoom(1.33)}><Minus size={18} /></button>
        </div>
      </div>
    </div>
  );
}
