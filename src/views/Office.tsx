// 3D Office (spec 6.7 + 7). Lazy-loaded so only this view pays for Three.js.
// Polls /api/office/state every 5 s. Characters only show "working" when the API says so
// (a real kanban claim); today everyone is idle, which is correct.
import { Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { endpoints, useApi } from "../api/client";
import type { OfficeState, ToolState } from "../api/types";
import { PixelAvatar } from "../components/ui/PixelAvatar";
import { ErrorPanel } from "../components/ui/States";
import { StatusBadge } from "../components/ui/StatusBadge";
import { officeBadge, toolBadge } from "../lib/derive";
import { setParams, useRoute } from "../lib/router";
import { relative, useNow } from "../lib/time";
import { OfficeScene, webglAvailable, type Preset } from "../office/OfficeScene";
import { hasSeat, loungeSpotFor } from "../office/layout";
import type { RobotState } from "../office/characters";
import { readTod, store, TOD_KEY, type TimeOfDay } from "../office/palettes";
import { AGENTS, CLAUDE, CLAUDE_ID, identity, rosterIndex } from "../theme/agents";

const LABEL: Record<OfficeState, string> = { working: "Working", reviewing: "Reviewing", idle: "Idle", offline: "Offline", unknown: "Unknown" };
const robotState = (s: ToolState | undefined): RobotState => (s === "working" ? "running" : s === "idle" ? "not_running" : "unknown");
const ROBOT_LABEL: Record<RobotState, string> = { running: "Running", not_running: "Not running", unknown: "Unknown" };
const PRESET_LABEL: Record<Preset, string> = { overview: "Overview", workspace: "Floor 0 · Workspace", lounge: "Floor 1 · Lounge" };
const ZONE_NAME = { tv: "TV corner", balcony: "Balcony", nap: "Rest room", commons: "Commons" } as const;

export default function Office() {
  const office = useApi(endpoints.office, 5_000);
  const { params } = useRoute();
  const now = useNow(5_000);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const [ready, setReady] = useState(false);
  const [gl] = useState(webglAvailable);
  const [preset, setPreset] = useState<Preset>("overview");
  const [initError, setInitError] = useState<string | null>(null);
  const [tod, setTod] = useState<TimeOfDay>(readTod);
  const todRef = useRef(tod);
  todRef.current = tod;
  const focusParam = params.get("focus");

  // Mount / unmount the Three.js scene with the view (render loop stops on unmount).
  useEffect(() => {
    if (!gl || !host.current) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let s: OfficeScene;
    try {
      s = new OfficeScene(host.current, {
        characters: AGENTS.map((a) => ({ id: a.id, hex: a.hex, shortName: a.shortName, index: rosterIndex(a.id) })),
        robot: { id: CLAUDE_ID, hex: CLAUDE.hex, shortName: CLAUDE.shortName, index: rosterIndex(CLAUDE_ID) },
        onSelect: (id) => setParams({ agent: id, tab: null }),
        onFirstFrame: () => setReady(true),
        onPresetChange: setPreset,
        reducedMotion,
      });
    } catch (e) {
      setInitError((e as Error).message);
      return;
    }
    scene.current = s;
    s.setTimeOfDay(todRef.current, { instant: true }); // persisted choice, no tween on first paint
    return () => { s.dispose(); scene.current = null; };
  }, [gl]);

  const toggleTod = () => {
    const next: TimeOfDay = tod === "day" ? "night" : "day";
    setTod(next);
    store(TOD_KEY, next);
    scene.current?.setTimeOfDay(next);
  };

  // Push API state into the scene.
  const data = office.data;
  useEffect(() => {
    const s = scene.current;
    if (!s || !data) return;
    data.agents.forEach((a) => s.setAgentState(a.name, a.state, LABEL[a.state] ?? "Unknown"));
    const rs = robotState(data.claude_tool?.state);
    s.setRobotState(rs, ROBOT_LABEL[rs]);
  }, [data, ready]);

  // ?focus=<id> (from "Open in 3D Office"): tween to the character once the scene is up.
  useEffect(() => {
    if (!ready || !focusParam || !scene.current) return;
    scene.current.focus(focusParam);
    setParams({ focus: null }, true);
  }, [ready, focusParam]);

  // Agents per floor by their target floor (idle → Floor 1 lounge, everything else → Floor 0 desk).
  const seated = (data?.agents ?? []).filter((a) => hasSeat(a.name));
  const onFloor = { workspace: seated.filter((a) => a.state !== "idle").length, lounge: seated.filter((a) => a.state === "idle").length };

  const legend = [
    ...[...(data?.agents ?? [])].sort((a, b) => rosterIndex(a.name) - rosterIndex(b.name)).map((a) => ({
      id: a.name, name: identity(a.name).displayName, seat: hasSeat(a.name),
      badge: <StatusBadge status={officeBadge(a.state)} compact title={`${LABEL[a.state]}: ${a.state_reason}`} />, label: LABEL[a.state],
    })),
    { id: CLAUDE_ID, name: "Claude Code CLI", seat: true, badge: <StatusBadge status={toolBadge(data?.claude_tool?.state)} compact title={data?.claude_tool?.detail ?? undefined} />, label: ROBOT_LABEL[robotState(data?.claude_tool?.state)] },
  ];

  if (!gl || initError) {
    return (
      <div className="webgl-fallback stack">
        <ErrorPanel what="the 3D view" error={new Error(initError ?? "3D view needs WebGL, which isn't available in this browser")} />
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="simple">
            <thead><tr><th>Agent</th><th>Zone</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {[...(data?.agents ?? [])].sort((a, b) => rosterIndex(a.name) - rosterIndex(b.name)).map((a) => (
                <tr key={a.name}>
                  <td>{identity(a.name).displayName}</td>
                  <td>{a.state === "idle" ? `Floor 1 · Lounge${hasSeat(a.name) ? ` (${ZONE_NAME[loungeSpotFor(a.name).zone]})` : ""}` : "Floor 0 · Workspace"}</td>
                  <td><StatusBadge status={officeBadge(a.state)} /></td>
                  <td className="xs secondary">{a.state_reason}</td>
                </tr>
              ))}
              {data && (
                <tr>
                  <td>Claude Code CLI</td><td>Floor 0 · Tool bench</td>
                  <td><StatusBadge status={toolBadge(data.claude_tool?.state)} /></td>
                  <td className="xs secondary">{data.claude_tool?.detail ?? "Not Available"}</td>
                </tr>
              )}
            </tbody>
          </table>
          {!data && <p className="sm muted" style={{ padding: 16 }}>{office.error ? office.error.message : "Loading office state…"}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="office">
      <div className="office-frame">
        <div ref={host} className={`office-canvas${ready ? " ready" : ""}`} />
        <div className="ov ov-tl">
          <div className="segmented" role="radiogroup" aria-label="Time of day">
            <button className="icon tod-day" role="radio" aria-checked={tod === "day"} aria-pressed={tod === "day"} aria-label="Day" title="Day mode"
              onClick={() => tod !== "day" && toggleTod()}><Sun size={16} /></button>
            <button className="icon tod-night" role="radio" aria-checked={tod === "night"} aria-pressed={tod === "night"} aria-label="Night" title="Night mode"
              onClick={() => tod !== "night" && toggleTod()}><Moon size={16} /></button>
          </div>
          <span className="ov-sep" aria-hidden="true" />
          <div className="segmented" role="group" aria-label="Camera preset and floor">
            {(["overview", "workspace", "lounge"] as Preset[]).map((p) => (
              <button key={p} aria-pressed={preset === p} onClick={() => { setPreset(p); scene.current?.preset(p); }}
                title={p === "overview" ? "Both floors" : p === "workspace" ? "Floor 0 only (Floor 1 hidden)" : "Floor 1 lounge"}>
                {PRESET_LABEL[p]}
                {p !== "overview" && data && <span className="floor-count" aria-label={`${onFloor[p]} agents on this floor`}>{onFloor[p]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="ov ov-tr" aria-label="Characters">
          {legend.map((r) => (
            <button key={r.id} className="legend-row" disabled={!r.seat}
              onClick={() => { scene.current?.focus(r.id); setParams({ agent: r.id, tab: null }); }}
              title={r.seat ? `Focus ${r.name}` : "No desk assigned in the office layout"}>
              <PixelAvatar id={r.id} size={20} tile={false} />
              <span className="nm truncate">{r.name}</span>
              {r.badge}
              <span className="xs secondary">{r.label}</span>
            </button>
          ))}
          {office.error && <div className="xs" style={{ color: "var(--outcome-failed)", padding: "4px 6px" }}>{office.error.message}</div>}
        </div>
        <div className="ov ov-bl">Drag to orbit · Scroll to zoom · Click a character for details · Use the floor buttons to switch floors</div>
        <div className="ov ov-br tabular">
          {office.updatedAt ? `State updated ${relative(office.updatedAt, now)} · every 5s` : "Loading state…"}
        </div>
      </div>
    </div>
  );
}
