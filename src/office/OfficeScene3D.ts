// 3D Office: the "Town Hall AI Agent" multi-floor building (src/office/townhall.ts, ported from the
// standalone HTML reference) with Agent Control Center's real agents living inside it.
//
// What this class owns (the integration layer, unchanged in behaviour):
// - Agents only change when Office.tsx pushes real /api/office/state + /api/openclaw/agents data in through
//   setAgentState()/setRobotState(). No simulation. State → room:
//     working → own desk in Lantai 1 "Ruang Kerja" (typing; Hawa → Ruang COO, L2)   reviewing (meeting) → Lantai 1 Ruang Meeting Utama
//     idle    → Lantai 2 Perpustakaan & Lounge / Coffee Corner   break (OpenClaw recent run) → Lantai 3 Ruang Game / Tempat Istirahat
//     waiting → Lantai 1 Lobby                                   offline → dimmed at own desk    unknown → own desk with "?"
//   Agents walk there along a waypoint graph per floor and take the stairs between floors.
// - Claude Code CLI = the orange (#F97316) faceted octahedron mascot, floating in the far south-west corner of the Lantai 2 agent work area.
// - OpenCode = a dark, flat-shaded icosahedron orb with a dim teal glow beside Claude Code on Lantai 2.
// - Right-hand agent roster + detail panel (DOM, Hermes "H" / OpenClaw "OC" badges, toggle button).
// - Left-hand room list (Lantai 1 / 2): clicking a room switches floor and flies the camera there (toggle button).
// - Corner floor lamps that light up at night (setTimeOfDay → TownHall.setNight).
//
// Port notes (r128 -> r187): OrbitControls/CSS2DRenderer from three/examples/jsm; PCFSoftShadowMap is gone, so
// PCFShadowMap + shadow.radius; colour management is switched off while this scene lives (restored on dispose)
// and light intensities are multiplied by PI, so the reference's hex colours and lighting render like r128.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { createTownHall, FT, LH, S as PXS, wx, wz, type FloorMode, type Scope, type StyleNo, type TownHall, type Weather } from "./townhall";
import type { TimeOfDay } from "./palettes";

export type { TimeOfDay, FloorMode, Scope, StyleNo, Weather };
/** Floor selector value: 1-3 = one floor, 4 = roof, "all" = whole building, "x" = floors split vertically. */
export type Preset = FloorMode;
export type AgentStatus = "working" | "meeting" | "waiting" | "idle" | "break" | "offline" | "error";
export type ToolStatus = "working" | "idle" | "unknown";
/** OpenCode engine state from api/sources/opencode.py ("unknown" = no feed / scan failed). */
export type OpenCodeState = "working" | "standby" | "offline" | "unknown";
type Pose = "stand" | "sit" | "type" | "read" | "game" | "lie" | "lean" | "play" | "walk";
type FloorNo = 1 | 2 | 3;

export const STATUS: Record<AgentStatus, { label: string; color: string; use: string }> = {
  working: { label: "Bekerja", color: "#2fbf71", use: "desk" },
  meeting: { label: "Meeting", color: "#4c8dff", use: "meeting" },
  waiting: { label: "Menunggu input", color: "#f2a91e", use: "waiting" },
  idle: { label: "Idle", color: "#9aa6b1", use: "idle" },
  break: { label: "Istirahat", color: "#b06cf0", use: "break" },
  offline: { label: "Offline", color: "#7b8794", use: "desk" },
  error: { label: "Tidak diketahui", color: "#ef4b4b", use: "desk" },
};

/** Compact name shown above an agent: first name plus a concise, lowercase role. */
function officeLabel(name: string, role: string): string {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const shortRole = role.trim().toLowerCase();
  return shortRole ? `${firstName}, ${shortRole}` : firstName;
}

/** Safety cap for agent name labels: max 25 chars, ellipsis when truncated. */
function capLabel(name: string): string {
  return name.length > 25 ? name.slice(0, 24) + "…" : name;
}

export const CLAUDE_AGENT_ID = "claude_cli";
export const OPENCODE_AGENT_ID = "opencode_engine";
const CLAUDE_COLOR = "#F97316";
const OPENCODE_COLOR = "#14B8A6";

/** Extra per-agent info pushed with each state update. All optional; missing → "–". */
export interface AgentMeta {
  role?: string | null;
  color?: string;
  /** Preferred desk index (0..12). Falls back to the first free desk. */
  desk?: number;
  /** ISO timestamp of the agent's last real activity, shown as "Aktivitas". */
  lastActive?: string | null;
  /** Why the API reports this state (shown as "Alasan"). */
  reason?: string | null;
}

export interface SceneOptions {
  onSelect?: (id: string) => void;
  onFirstFrame?: () => void;
  /** Fired when the scene changes floor by itself (selecting an agent on another floor, reset camera). */
  onPresetChange?: (p: Preset) => void;
  reducedMotion?: boolean;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ world data types
type Col = number | string | THREE.Material;
interface GNode { id: string; x: number; z: number; adj: string[] }
interface Spot {
  id: string; floor: FloorNo; room: string; use: string[]; x: number; z: number; rot: number; pose: Pose;
  node: string; y: number; pri: number; by: Agent3D | null;
}
interface Sprite2D { c: HTMLCanvasElement; tex: THREE.CanvasTexture; sp: THREE.Sprite }
interface Tag { obj: CSS2DObject; el: HTMLElement; dot: HTMLElement; name: HTMLElement }
interface Waypoint { x: number; z: number; y: number; node?: string; switchTo?: FloorNo; yAfter?: number; spot?: Spot }

interface AgentData { id: string; name: string; role: string; status: AgentStatus; task: string; color: string; lastActive: string | null; reason: string }
interface Agent3D {
  data: AgentData; group: THREE.Group; body: THREE.Group; lightMat: THREE.MeshBasicMaterial; shirt: THREE.MeshLambertMaterial;
  legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  book: THREE.Mesh; hit: THREE.Mesh; ring: THREE.Mesh; tag: Tag; zzz: THREE.Sprite; dots: THREE.Sprite; excl: THREE.Sprite;
  spot: Spot | null; path: Waypoint[]; floor: FloorNo; lastNode: string; pose: Pose; atSpot: boolean;
  deskIdx: number; since: number | null; phase: number;
  /** Offline agents are drawn with translucent, darkened materials. */
  dimmed?: boolean;
  /** Claude Code CLI is a tool, not a person: rendered as a floating energy orb instead of a body. */
  orb?: Orb;
  /** OpenCode is an engine, not a person: rendered as a floating dark orb. */
  terminal?: Terminal;
}
/** One orbiting ember (units: orb radii, like the reference's R-relative maths). */
interface Ember { a: number; rad: number; spd: number; dy: number; vy: number; size: number; max: number; life: number; fl: number }
/** One smoke tendril: an arc of soft blobs on the tilted orbit plane. */
interface Tendril { a0: number; span: number; r0: number; shrink: number; speed: number; width: number; phase: number; wob: number; alpha: number }
/** A particle layer: one buffer drawn twice (behind the orb, then in front of it). */
interface OrbLayer { geo: THREE.BufferGeometry; pos: Float32Array; col: Float32Array; size: Float32Array; back: THREE.Points; front: THREE.Points }
interface Orb {
  state: ToolStatus; float: THREE.Group;
  /** Flat-shaded Claude-style mascot. */
  mascot: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  glow: THREE.Sprite; fx: THREE.Group; embers: Ember[]; tendrils: Tendril[]; emberLayer: OrbLayer; smokeLayer: OrbLayer;
  fxMats: THREE.ShaderMaterial[]; textures: THREE.Texture[]; light: THREE.PointLight;
  pulse: number; spin: number; time: number; tagClock: number;
}
interface Terminal {
  float: THREE.Group;
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>;
  glow: THREE.Sprite;
  light: THREE.PointLight;
  texture: THREE.Texture;
  state: OpenCodeState;
  time: number;
}

// Claude orb (kiri) dan OpenCode orb (kanan orb, kiri ruang kerja), jarak pusat 1.62u
const ORB_POS = { x: wx(539), z: wz(800) };
const OPENCODE_POS = { x: wx(620), z: wz(800) };
const OPC_TEAL = 0x14B8A6;
const ORB_Y = 1.6;   // centre height above the floor (about a character's shoulder)
const ORB_R = 0.5;   // mascot radius (1u across, roughly one character)
const ORB_EMBERS = 80, ORB_TENDRILS = 16, ORB_SEG = 14;
const TAU = Math.PI * 2;

/** Embers/smoke points: world-sized sprites; uSide keeps only the points behind (-1) or in front (+1) of the orb centre. */
const ORB_PTS_VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uHalfH;
uniform float uSide;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float cz = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  float front = step(cz, mv.z);
  float keep = uSide > 0.0 ? front : 1.0 - front;
  vColor = aColor * keep;
  gl_PointSize = keep * aSize * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.001);
  gl_Position = projectionMatrix * mv;
}`;
const ORB_PTS_FS = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  vec4 s = texture2D(map, gl_PointCoord);
  float a = s.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(min(s.rgb * vColor.rgb * 1.6, vec3(1.0)), a);
}`;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function spawnEmber(e: Ember, init: boolean): Ember {
  e.a = rand(0, TAU); e.rad = rand(1.05, 2.5); e.spd = rand(0.15, 0.4) * (1.3 / e.rad);
  e.dy = 0; e.vy = rand(4, 20) / 200; e.size = rand(0.08, 0.15); e.max = rand(4, 10);
  e.life = init ? rand(0, e.max) : 0; e.fl = rand(0, TAU);
  return e;
}
/** Radial-gradient canvas texture (stops: [offset, css colour]). */
function gradientTexture(size: number, stops: [number, string][], inner = 0): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!, h = size / 2, gr = g.createRadialGradient(h, h, inner * h, h, h, h);
  stops.forEach(([o, s]) => gr.addColorStop(o, s)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const C = { metal: 0x2c2f36, pants: 0x2f3644 };
const SKINS = [0xf1c9a5, 0xd9a273, 0xa8754f, 0xf5d6b8, 0x8d5a3b, 0xe3b48c];
const HAIRS = [0x2b2320, 0x5a3a22, 0x1c1c1c, 0x8a5a34, 0x3a2a22, 0xc98a3c];
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const SPEED = 2.4;
const D2R = Math.PI / 180;
const HOME_CAM = new THREE.Vector3(-34, 40, 50), HOME_TGT = new THREE.Vector3(0, 3, 2);
/** Stairwell (floor-plan px): x centre, bottom step edge, top step edge. Same footprint on Lantai 1 and 2. */
const STAIR = { x: 1303, bottom: 1240, top: 1068 };

/** Personal work seats, keyed by profile id: where an agent sits while `working` instead of its Lantai 1 desk.
 *  px/py/rot = the workstation as placed in townhall.ts (chair 0.62 m behind it); node = Lantai 2 walk-graph node. */
const SEATS: Record<string, { floor: FloorNo; room: string; px: number; py: number; rot: number; node: string }> = {
  // Hawa (profile "default") → Ruang COO workstation, townhall.ts buildL2: put(g, Workstation(), 1725, 405, 180).
  default: { floor: 2, room: "Ruang COO", px: 1725, py: 405, rot: 180, node: "coo" },
};

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + " detik lalu";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " menit lalu";
  const h = Math.floor(m / 60);
  return h < 48 ? h + " jam lalu" : Math.floor(h / 24) + " hari lalu";
}
const SIDEBAR_KEY = "mc.office.sidebarOpen";
function readSidebarOpen() {
  try { return localStorage.getItem(SIDEBAR_KEY) !== "false"; } catch { return true; }
}
/** Active tab of the right-hand panel: agent roster or room shortcuts. */
type RosterTab = "agents" | "rooms";
const ROSTER_TAB_KEY = "mc.office.rosterTab";
function readRosterTab(): RosterTab {
  try { return localStorage.getItem(ROSTER_TAB_KEY) === "rooms" ? "rooms" : "agents"; } catch { return "agents"; }
}
/** "Agen" tab filters. Platform + status persist in localStorage; the name query does not. */
type PlatformFilter = "all" | "hermes" | "openclaw";
type StatusFilter = "all" | "active" | "working" | "idle";
type PlatformGroup = "hermes" | "openclaw" | "tools";
const ROSTER_FILTER_KEY = "mc.office.rosterFilter";
const PLATFORM_FILTERS: [PlatformFilter, string][] = [["all", "Semua"], ["hermes", "Hermes"], ["openclaw", "OpenClaw"]];
const STATUS_FILTERS: [StatusFilter, string][] = [["all", "Semua"], ["active", "Aktif"], ["working", "Working"], ["idle", "Idle"]];
const GROUPS: [PlatformGroup, string][] = [["hermes", "Hermes"], ["openclaw", "OpenClaw"], ["tools", "Tools"]];
function readRosterFilter(): { platform: PlatformFilter; status: StatusFilter } {
  const out = { platform: "all" as PlatformFilter, status: "all" as StatusFilter };
  try {
    const v = JSON.parse(localStorage.getItem(ROSTER_FILTER_KEY) || "{}");
    if (PLATFORM_FILTERS.some(([k]) => k === v.platform)) out.platform = v.platform;
    if (STATUS_FILTERS.some(([k]) => k === v.status)) out.status = v.status;
  } catch { /* storage unavailable / bad JSON */ }
  return out;
}
/** Aktif = not offline/error; Working = working|meeting; Idle = idle|break|waiting. */
function statusMatches(f: StatusFilter, s: AgentStatus): boolean {
  if (f === "active") return s !== "offline" && s !== "error";
  if (f === "working") return s === "working" || s === "meeting";
  if (f === "idle") return s === "idle" || s === "break" || s === "waiting";
  return true;
}
/** Room navigation shortcuts: label centres from townhall.ts roomLabel() (floor-plan px). Toilet/Gudang/Tangga left out. */
interface RoomNav { name: string; icon: string; floor: 1 | 2; px: number; pz: number }
const ROOMS: RoomNav[] = [
  { name: "Ruang Meeting Utama", icon: "🏛️", floor: 1, px: 712, pz: 470 },
  { name: "Lounge & Ruang Tamu", icon: "🛋️", floor: 1, px: 850, pz: 840 },
  { name: "Pantry & Café", icon: "🍽️", floor: 1, px: 1330, pz: 600 },
  { name: "Ruang Kerja", icon: "💻", floor: 1, px: 1677, pz: 560 },
  { name: "Ruang Manager", icon: "👔", floor: 1, px: 1745, pz: 860 },
  { name: "Ruang Manager 2", icon: "👔", floor: 1, px: 1745, pz: 1000 },
  { name: "Ruang Staf A", icon: "🧑‍💼", floor: 1, px: 545, pz: 1060 },
  { name: "Ruang Staf B", icon: "🧑‍💼", floor: 1, px: 545, pz: 1250 },
  { name: "Meeting Room Borland", icon: "🤝", floor: 1, px: 578, pz: 1370 },
  { name: "Meeting Room Kylix", icon: "🤝", floor: 1, px: 578, pz: 1500 },
  { name: "Meeting Room Niklaus Wirth", icon: "🤝", floor: 1, px: 590, pz: 1642 },
  { name: "Pojok Baca", icon: "📖", floor: 1, px: 995, pz: 1060 },
  { name: "Lounge", icon: "🛋️", floor: 1, px: 1010, pz: 1215 },
  { name: "Ruang Tamu VIP", icon: "⭐", floor: 1, px: 995, pz: 1430 },
  { name: "Lobby & Resepsionis", icon: "🛎️", floor: 1, px: 950, pz: 1630 },
  { name: "Pos Satpam", icon: "👮", floor: 1, px: 1275, pz: 1805 },
  { name: "Ruang CEO", icon: "👑", floor: 2, px: 545, pz: 430 },
  { name: "Meeting Room Delphi", icon: "🤝", floor: 2, px: 784, pz: 389 },
  { name: "Meeting Room Pascal", icon: "🤝", floor: 2, px: 1045, pz: 389 },
  { name: "Ruang CTO", icon: "🛠️", floor: 2, px: 1566, pz: 400 },
  { name: "Ruang COO", icon: "📊", floor: 2, px: 1725, pz: 400 },
  { name: "Area Kerja Agen", icon: "🤖", floor: 2, px: 980, pz: 800 },
  { name: "Area Kolaborasi", icon: "💡", floor: 2, px: 1600, pz: 600 },
  { name: "Ruang Training", icon: "🎓", floor: 2, px: 1590, pz: 935 },
  { name: "Perpustakaan & Lounge", icon: "📚", floor: 2, px: 720, pz: 1250 },
  { name: "Coffee Corner", icon: "☕", floor: 2, px: 760, pz: 1600 },
  { name: "Pantry L2", icon: "🍽️", floor: 2, px: 1335, pz: 400 },
];
/** Camera distance from a room centre when flying to it, and the radius that counts as "in" the room (world units). */
const ROOM_CAM_DIST = 12, ROOM_NEAR = 3;
const hex6 = (n: number) => "#" + n.toString(16).padStart(6, "0");
/** Roster icon for Claude CLI: an orange (#F97316) diamond/hexagon mascot. */
function drawClaudeMascotFace(state: ToolStatus): string {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#1c1f26"; g.fillRect(0, 0, 64, 64);
  const col = state === "working" ? "#F97316" : state === "idle" ? "#9A4A12" : "#5A5A5A";
  g.globalAlpha = state === "working" ? 1 : 0.7;
  g.shadowColor = state === "working" ? "#F97316" : "transparent"; g.shadowBlur = state === "working" ? 10 : 0;
  g.fillStyle = col; g.beginPath();
  g.moveTo(32, 5); g.lineTo(57, 20); g.lineTo(51, 48); g.lineTo(32, 59); g.lineTo(13, 48); g.lineTo(7, 20); g.closePath(); g.fill();
  g.shadowBlur = 0; g.strokeStyle = "#FDBA74"; g.lineWidth = 2; g.stroke();
  g.fillStyle = state === "working" ? "#FFEDD5" : "#E8A46B"; g.beginPath(); g.moveTo(32, 14); g.lineTo(45, 23); g.lineTo(41, 41); g.lineTo(32, 47); g.lineTo(23, 41); g.lineTo(19, 23); g.closePath(); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(26, 29, 2.5, 0, Math.PI * 2); g.arc(38, 29, 2.5, 0, Math.PI * 2); g.fill();
  return c.toDataURL();
}
/** 8x8 Minecraft-style head (hair, skin, eyes, shirt strip). */
function drawFace(skin: string, hair: string, shirt: string): string {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "";
  g.imageSmoothingEnabled = false;
  const px = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x * 8, y * 8, w * 8, h * 8); };
  px(0, 0, 8, 8, hair);            // hair block = background
  px(1, 2, 6, 5, skin); px(0, 4, 8, 3, skin);   // face, sideburns above row 4
  px(1, 4, 2, 1, "#ffffff"); px(5, 4, 2, 1, "#ffffff");  // eye whites
  px(2, 4, 1, 1, "#1c1c1c"); px(5, 4, 1, 1, "#1c1c1c");  // pupils (looking inward)
  g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(3 * 8, 6 * 8 - 3, 2 * 8, 3); // mouth
  px(0, 7, 8, 1, shirt);           // shirt strip
  return c.toDataURL();
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class OfficeScene3D {
  private renderer: THREE.WebGLRenderer;
  private css: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
  private controls: OrbitControls;
  private th: TownHall;
  private spots: Spot[] = [];
  private G: Record<FloorNo, Record<string, GNode>> = { 1: {}, 2: {}, 3: {} };
  private mats = new Map<string, THREE.MeshLambertMaterial>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private dimMats = new Map<THREE.Material, THREE.Material>();
  private HIT = new THREE.MeshBasicMaterial({ visible: false });
  private tmpV = new THREE.Vector3();

  private agents: Agent3D[] = [];
  private byId = new Map<string, Agent3D>();
  private selected: Agent3D | null = null;
  /** focus() before the agent's first state push: applied when it is added. */
  private pendingFocus: string | null = null;
  private showLabels = true;
  private tween: { ft: THREE.Vector3; fp: THREE.Vector3; tt: THREE.Vector3; tp: THREE.Vector3; k: number; dur: number } | null = null;
  private reduce: boolean;
  private tod: TimeOfDay = "day";
  private dirty = true;
  private detailClock = 0;
  private last = 0;
  private elapsed = 0;
  private raf = 0;
  private firstFrame = false;
  private ray = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private prevColorManagement: boolean;
  private opts: SceneOptions;

  // DOM: roster + detail panel, owned by the scene.
  private ui: { root: HTMLElement; toggle: HTMLButtonElement; title: HTMLElement; tally: HTMLElement; list: HTMLUListElement; detail: HTMLElement; dl: HTMLDListElement; dName: HTMLElement };
  private sidebarOpen = readSidebarOpen();
  /** Roster face icons (data URLs), keyed by everything that changes the drawing. */
  private faces = new Map<string, string>();
  // DOM: tab bar (Agen / Ruangan) inside the roster; room shortcut buttons indexed like ROOMS.
  private tabs!: Record<RosterTab, { btn: HTMLButtonElement; pane: HTMLElement }>;
  private rosterTab = readRosterTab();
  private rosterFilter = readRosterFilter();
  private rosterQuery = "";
  private filterBtns: { platform: Map<PlatformFilter, HTMLButtonElement>; status: Map<StatusFilter, HTMLButtonElement> } = { platform: new Map(), status: new Map() };
  private searchInput: HTMLInputElement | null = null;
  private searchClear: HTMLButtonElement | null = null;
  private roomEntries: HTMLButtonElement[] = [];
  private activeRoom = -1;

  constructor(private host: HTMLElement, opts: SceneOptions = {}) {
    this.opts = opts;
    this.reduce = !!opts.reducedMotion;
    this.prevColorManagement = THREE.ColorManagement.enabled;
    THREE.ColorManagement.enabled = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);
    this.css = new CSS2DRenderer();
    this.css.domElement.className = "th-labels";
    host.appendChild(this.css.domElement);

    this.camera.position.copy(HOME_CAM);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(HOME_TGT);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6; this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = 86 * D2R;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener("start", this.onControlsStart);

    this.th = createTownHall(this.scene, this.renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048);
    this.buildGraph();

    // The old left-hand room panel is gone (merged into the roster as a tab): drop its stale preference once.
    try { localStorage.removeItem("mc.office.roomPanelOpen"); } catch { /* storage unavailable */ }
    this.ui = this.buildPanel();
    this.applyTheme();

    const c = this.renderer.domElement;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(host);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ================================================================== public interface
  get activePreset(): Preset { return this.th.mode; }
  get timeOfDay(): TimeOfDay { return this.tod; }

  /** Create or update one agent from real API data. `name` = display name. */
  setAgentState(id: string, status: AgentStatus, name: string, task?: string | null, meta: AgentMeta = {}) {
    let a = this.byId.get(id);
    if (!a) { this.addAgent(id, status, name, task, meta); return; }
    const d = a.data, prev = d.status;
    let changed = false;
    if (d.name !== name) { d.name = name; changed = true; }
    if (meta.role !== undefined) d.role = meta.role ?? "";
    d.task = task ?? "";
    if (meta.lastActive !== undefined) d.lastActive = meta.lastActive ?? null;
    if (meta.reason !== undefined) d.reason = meta.reason ?? "";
    if (meta.color && meta.color !== d.color) {
      d.color = meta.color;
      const dim = !!a.dimmed; this.setDim(a, false); a.shirt.color.set(meta.color); this.setDim(a, dim);
      changed = true;
    }
    if (STATUS[status] && status !== prev) {
      d.status = status; a.since = Date.now(); a.lightMat.color.set(STATUS[status].color);
      if (a.orb) { this.applyOrb(a); this.deskGlow(a); }
      else if (a.terminal) this.applyTerminal(a);
      else {
        const s = this.pickSpot(a);
        if (s && s === a.spot && a.atSpot) { this.setPose(a, this.poseFor(a, s)); this.deskGlow(a); } else this.go(a, s);
        this.setDim(a, status === "offline");
      }
      changed = true;
    }
    if (changed) this.drawTag(a);
    this.dirty = true;
  }

  /** Claude Code CLI (a tool, not a Hermes profile) as an extra agent with its own (reserved) desk. */
  setRobotState(state: ToolStatus, label: string) {
    const status: AgentStatus = state === "working" ? "working" : state === "idle" ? "idle" : "offline";
    this.setAgentState(CLAUDE_AGENT_ID, status, "Claude Code CLI", label, { role: "Coding tool", color: CLAUDE_COLOR, desk: 4 });
  }

  /** OpenCode engine is always visible as a dark orb on Lantai 2; state comes from GET /api/agents/tools. */
  setOpenCodeState(state: OpenCodeState, label: string) {
    const status: AgentStatus = state === "working" ? "working" : state === "standby" ? "idle" : state === "offline" ? "offline" : "error";
    this.setAgentState(OPENCODE_AGENT_ID, status, "OpenCode", label, { role: "Terminal engine", color: OPENCODE_COLOR, desk: 10 });
  }

  /** Remove every agent whose id is not in `ids` (e.g. a profile that disappeared from the API). */
  retainAgents(ids: Iterable<string>) {
    const keep = new Set(ids);
    for (const a of [...this.agents]) if (!keep.has(a.data.id)) this.removeAgent(a);
  }
  agentIds(): string[] { return this.agents.map((a) => a.data.id); }

  /** Floor selector (Lantai 1/2/3, Atap, Semua, Pisah lantai). */
  preset(p: Preset, opts?: { instant?: boolean }) { this.setMode(p, false, !!opts?.instant); }
  focus(id: string) {
    if (this.byId.has(id)) { this.pendingFocus = null; this.select(id); } else this.pendingFocus = id;
  }
  setLabels(on: boolean) { this.showLabels = on; }
  setTimeOfDay(tod: TimeOfDay, _opts?: { instant?: boolean }) { this.tod = tod; this.applyTheme(); }
  setStyle(n: StyleNo) { this.th.applyStyle(n); }
  setWeather(w: Weather) { this.th.setWeather(w); }
  setScope(s: Scope) { this.th.setScope(s); }
  setClouds(on: boolean) { this.th.setClouds(on); }
  setLowWalls(on: boolean) { this.th.setLow(on); }
  setWoodFloor(on: boolean) { this.th.setWood(on); }
  setVendors(on: boolean) { this.th.setVendors(on); }
  setAutoRotate(on: boolean) { this.controls.autoRotate = on && !this.reduce; }
  /** Back to the reference's home view (whole building). */
  resetCamera() {
    this.th.setMode("all"); this.opts.onPresetChange?.("all");
    this.flyTo(HOME_TGT.clone(), HOME_CAM.clone(), 0.9);
  }
  /** Zoom buttons: f < 1 moves closer. */
  zoom(f: number) {
    const base = this.tween ? this.tween.tt : this.controls.target, cam = this.tween ? this.tween.tp : this.camera.position;
    const off = cam.clone().sub(base);
    const d = THREE.MathUtils.clamp(off.length() * f, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(base.clone(), base.clone().add(off.setLength(d)), 0.35);
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.ro.disconnect();
    const c = this.renderer.domElement;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.dispose();
    const disposed = new Set<unknown>();
    const kill = (x: { dispose(): void } | null | undefined) => { if (x && !disposed.has(x)) { disposed.add(x); x.dispose(); } };
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.LineSegments).isLineSegments) {
        if (!(o as THREE.Sprite).isSprite) kill(m.geometry);
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => {
          const mm = x as THREE.MeshLambertMaterial;
          kill(mm.map); kill(mm.userData?.map1); kill(mm.userData?.map2); kill(x);
        });
      }
      if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
    });
    this.geos.forEach(kill); this.mats.forEach(kill); this.dimMats.forEach(kill); kill(this.HIT);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    c.remove();
    this.css.domElement.remove();
    this.ui.root.remove(); this.ui.toggle.remove();
    THREE.ColorManagement.enabled = this.prevColorManagement;
  }

  // ================================================================== primitives (agents only)
  private M(c: number | string, o?: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
    const k = String(c) + (o ? JSON.stringify(o) : "");
    let m = this.mats.get(k);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: c, ...(o || {}) }); this.mats.set(k, m); }
    return m;
  }
  private asMat(c: Col, o?: THREE.MeshLambertMaterialParameters): THREE.Material {
    return typeof c === "object" && (c as THREE.Material).isMaterial ? (c as THREE.Material) : this.M(c as number | string, o);
  }
  private geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geos.get(key);
    if (!g) { g = make(); this.geos.set(key, g); }
    return g as T;
  }
  private box(p: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, c: Col, o?: THREE.MeshLambertMaterialParameters) {
    const m = new THREE.Mesh(this.geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), this.asMat(c, o));
    m.position.set(x, y + h / 2, z); m.castShadow = !m.material.transparent; m.receiveShadow = true; p.add(m); return m;
  }
  private textSprite(w: number, h: number, sx: number, sy: number): Sprite2D {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(sx, sy, 1); sp.renderOrder = 20;
    return { c, tex, sp };
  }
  /** Floating HTML name tag (CSS2D), clickable: selects the agent. */
  private makeTag(g: THREE.Object3D, y: number): Tag {
    const el = document.createElement("button"); el.type = "button"; el.className = "lbl agent";
    const dot = document.createElement("i"), name = document.createElement("span");
    el.append(dot, name);
    const obj = new CSS2DObject(el); obj.center.set(0.5, 1); obj.position.set(0, y, 0); g.add(obj);
    return { obj, el, dot, name };
  }

  // ================================================================== walk graph + spots (floor-plan px → world)
  private node(f: FloorNo, id: string, px: number, py: number) { this.G[f][id] = { id, x: wx(px), z: wz(py), adj: [] }; }
  private link(f: FloorNo, ...ids: string[]) {
    for (let i = 0; i < ids.length - 1; i++) { const a = this.G[f][ids[i]], b = this.G[f][ids[i + 1]]; a.adj.push(b.id); b.adj.push(a.id); }
  }
  /** Dijkstra over the floor's walk graph. */
  private route(f: FloorNo, a: string, b: string): GNode[] {
    const g = this.G[f];
    if (!g[a] || !g[b]) return g[b] ? [g[b]] : [];
    const dist: Record<string, number> = {}, prev: Record<string, string | undefined> = {}, open = Object.keys(g);
    open.forEach((k) => { dist[k] = Infinity; }); dist[a] = 0;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      const u = open.splice(bi, 1)[0];
      if (u === b || dist[u] === Infinity) break;
      g[u].adj.forEach((v) => { const d = dist[u] + Math.hypot(g[u].x - g[v].x, g[u].z - g[v].z); if (d < dist[v]) { dist[v] = d; prev[v] = u; } });
    }
    const out: GNode[] = [];
    let c: string | undefined = b;
    while (c !== undefined) { out.unshift(g[c]); if (c === a) break; c = prev[c]; }
    return out[0] && out[0].id === a ? out : [g[b]];
  }
  /** Spot at floor-plan (px, py). `face` uses the reference convention: rotation (deg) of a -z-facing person
   *  (0 → faces -z, 180 → +z, -90 → +x, 90 → -x). The agent body faces +z at rot 0, hence the +PI. */
  private spot(floor: FloorNo, room: string, use: string | string[], px: number, py: number, face: number, pose: Pose, nd: string, o: { y?: number; pri?: number } = {}) {
    const s: Spot = {
      id: "s" + this.spots.length, floor, room, use: ([] as string[]).concat(use), x: wx(px), z: wz(py), rot: face * D2R + Math.PI, pose,
      node: nd, y: FT + (o.y || 0), pri: o.pri || 0, by: null,
    };
    this.spots.push(s); return s;
  }
  /** Floor-plan position of a furniture-local offset (metres) for furniture placed at (px, py) rotated rotDeg. */
  private off(px: number, py: number, rotDeg: number, lx: number, lz: number): [number, number] {
    const t = rotDeg * D2R, c = Math.cos(t), s = Math.sin(t);
    return [px + (lx * c + lz * s) / PXS, py + (-lx * s + lz * c) / PXS];
  }
  /** Two seats of a reference Sofa(len) placed at (px, py, rotDeg). */
  private sofaSeats(floor: FloorNo, room: string, use: string | string[], px: number, py: number, rotDeg: number, len: number, pose: Pose, nd: string | ((i: number) => string), pri = 0) {
    const k = len / 4;
    [-k, k].forEach((lx, i) => {
      const [x, y] = this.off(px, py, rotDeg, lx, -0.05);
      this.spot(floor, room, use, x, y, rotDeg, pose, typeof nd === "string" ? nd : nd(i), { y: 0.07, pri });
    });
  }

  private buildGraph() {
    /* ---------- Lantai 1: work, meeting, lobby ---------- */
    const n1 = (id: string, x: number, y: number) => this.node(1, id, x, y);
    n1("lob", 1060, 1600); n1("lobW", 845, 1600);
    n1("corW1", 790, 1530); n1("corW2", 790, 1300); n1("corW3", 800, 1060); n1("lngS", 830, 990); n1("lng", 780, 900);
    n1("mtgD", 681, 665); n1("mtgIn", 681, 585); n1("mtgW", 478, 585); n1("mtgE", 880, 585);
    n1("mtgNW", 478, 352); n1("mtgNM", 700, 352); n1("mtgNE", 880, 352);
    n1("corE1", 1175, 1590); n1("corE2", 1175, 1280); n1("corE3", 1178, 1110); n1("pan1", 1178, 1030); n1("pan2", 1300, 960);
    n1("pan3", 1470, 925); n1("rk0", 1600, 900); n1("rkG", 1600, 795);
    const rows = [745, 675, 600, 525, 450, 375];
    rows.forEach((y) => n1("rk" + y, 1677, y));
    n1("m1o", 1640, 892); n1("m1i", 1725, 892); n1("m2o", 1640, 1032); n1("m2i", 1725, 1032);
    n1("stB", STAIR.x, 1272);
    this.link(1, "lob", "lobW", "corW1", "corW2", "corW3", "lngS", "lng", "mtgD", "mtgIn");
    this.link(1, "mtgW", "mtgIn", "mtgE"); this.link(1, "mtgW", "mtgNW", "mtgNM", "mtgNE");
    this.link(1, "lob", "corE1", "corE2", "corE3", "pan1", "pan2", "pan3", "rk0", "rkG", "rk745", ...rows.slice(1).map((y) => "rk" + y));
    this.link(1, "rk0", "m1o", "m1i"); this.link(1, "rk0", "m2o", "m2i"); this.link(1, "corE2", "stB");

    // 13 desks, same order as TownHall.deskScreens: west row (0-4), east row (5-10), manager rooms (11-12).
    [375, 450, 525, 600, 675].forEach((y) => { const [x, z] = this.off(1566, y, 90, 0, 0.62); this.spot(1, "Ruang Kerja", "desk", x, z, 90, "type", "rk" + y, { y: 0.05 }); });
    [375, 450, 525, 600, 675, 745].forEach((y) => { const [x, z] = this.off(1788, y, -90, 0, 0.62); this.spot(1, "Ruang Kerja", "desk", x, z, -90, "type", "rk" + y, { y: 0.05 }); });
    [[860, "m1i", "Ruang Manager"], [1000, "m2i", "Ruang Manager 2"]].forEach(([y, nd, room]) => {
      const [x, z] = this.off(1788, y as number, -90, 0, 0.62); this.spot(1, room as string, "desk", x, z, -90, "type", nd as string, { y: 0.05 });
    });
    // Ruang Meeting Utama: OvalTable(8.4, 1.6, 8) at (732, 467); chairs 1.15 m either side of the long axis.
    for (let i = 0; i < 8; i++) {
      const x = 732 + (-3.57 + i * 1.02) / PXS;
      this.spot(1, "Ruang Meeting Utama", "meeting", x, 467 - 1.15 / PXS, 180, "sit", x < 600 ? "mtgNW" : x < 800 ? "mtgNM" : "mtgNE", { y: 0.05 });
      this.spot(1, "Ruang Meeting Utama", "meeting", x, 467 + 1.15 / PXS, 0, "sit", x < 600 ? "mtgW" : x < 760 ? "mtgIn" : "mtgE", { y: 0.05 });
    }
    // Lobby sofas + two standing spots.
    this.sofaSeats(1, "Lobby", "waiting", 823, 1700, 0, 1.8, "sit", "lobW");
    this.sofaSeats(1, "Lobby", "waiting", 915, 1700, 0, 1.8, "sit", "lobW");
    this.spot(1, "Lobby", "waiting", 780, 1640, -90, "stand", "lobW", { pri: 1 });
    this.spot(1, "Lobby", "waiting", 965, 1640, 90, "stand", "lob", { pri: 1 });

    /* ---------- Lantai 2: lounge (idle) ---------- */
    const n2 = (id: string, x: number, y: number) => this.node(2, id, x, y);
    n2("arr", STAIR.x, 1045); n2("c1", 1225, 1045); n2("c2", 1225, 1290); n2("stB", STAIR.x, 1275);
    n2("lib0", 1050, 1290); n2("libE", 900, 1150); n2("lib", 700, 1175); n2("libSW", 650, 1305); n2("libS", 840, 1310);
    n2("cc0", 1000, 1480); n2("cc", 760, 1600);
    this.link(2, "arr", "c1", "c2", "stB"); this.link(2, "c2", "lib0", "libE", "lib", "libSW", "libS", "lib0"); this.link(2, "lib0", "cc0", "cc");
    this.sofaSeats(2, "Perpustakaan & Lounge", "idle", 543, 1237, -90, 2.2, "read", "lib");
    this.sofaSeats(2, "Perpustakaan & Lounge", "idle", 902, 1237, 90, 2.2, "read", "lib");
    this.sofaSeats(2, "Perpustakaan & Lounge", "idle", 622, 1353, 0, 2.2, "read", "libSW");
    this.sofaSeats(2, "Perpustakaan & Lounge", "idle", 754, 1353, 0, 2.2, "read", "libS");
    [560, 620, 680, 740].forEach((x) => this.spot(2, "Coffee Corner", "idle", x, 1662, 180, "sit", "cc", { y: 0.29 }));
    this.spot(2, "Coffee Corner", "idle", 862.5, 1560, -90, "sit", "cc", { y: 0.05 }); this.spot(2, "Coffee Corner", "idle", 937.5, 1560, 90, "sit", "cc0", { y: 0.05 });
    this.spot(2, "Coffee Corner", "idle", 1022.5, 1620, -90, "sit", "cc0", { y: 0.05 }); this.spot(2, "Coffee Corner", "idle", 1097.5, 1620, 90, "sit", "cc0", { y: 0.05 });
    this.spot(2, "Coffee Corner", "idle", 500, 1520, 180, "sit", "cc", { y: 0.05, pri: 1 }); this.spot(2, "Coffee Corner", "idle", 560, 1560, 180, "sit", "cc", { y: 0.05, pri: 1 });
    /* ---------- Lantai 2: personal work seats (SEATS, keyed by profile id) ---------- */
    // Corridor east of the pods (x 1350) north to the collaboration area, east to the Ruang COO door gap (x 1650-1688, wall y 474).
    n2("cooA", 1350, 1000); n2("cooB", 1350, 500); n2("cooC", 1669, 500); n2("cooD", 1669, 440); n2("coo", 1669, 374);
    this.link(2, "arr", "cooA", "cooB", "cooC", "cooD", "coo");
    Object.entries(SEATS).forEach(([profile, st]) => {
      const [x, z] = this.off(st.px, st.py, st.rot, 0, 0.62);
      this.spot(st.floor, st.room, "seat:" + profile, x, z, st.rot, "type", st.node, { y: 0.05 });
    });

    /* ---------- Lantai 3: game room / rest area (break) ---------- */
    const n3 = (id: string, x: number, y: number) => this.node(3, id, x, y);
    n3("arr", STAIR.x, 1045); n3("t1", 1345, 990); n3("t2", 1345, 760); n3("rest", 1200, 700);
    n3("gD", 1475, 780); n3("g1", 1530, 845); n3("g2", 1715, 880);
    this.link(3, "arr", "t1", "t2", "rest"); this.link(3, "t2", "gD", "g1", "g2");
    [[1150, 600], [1235, 560], [1285, 680]].forEach(([x, y]) => this.spot(3, "Tempat Istirahat", "break", x, y, 180, "sit", "rest", { y: 0.05 }));
    this.spot(3, "Ruang Game", "break", 1488, 960, -90, "play", "g1"); this.spot(3, "Ruang Game", "break", 1672, 960, 90, "play", "g2");
    this.spot(3, "Ruang Game", "break", 1460, 845, 180, "lean", "g1");
    this.spot(3, "Ruang Game", "break", 1740, 860, -90, "lean", "g2"); this.spot(3, "Ruang Game", "break", 1740, 915, -90, "lean", "g2");
    this.spot(3, "Ruang Game", "break", 1700, 1020, 0, "sit", "g2", { y: 0.05 }); this.spot(3, "Ruang Game", "break", 1750, 990, 0, "sit", "g2", { y: 0.05 });
    this.sofaSeats(3, "Ruang Game", "break", 1450, 1045, 0, 2.0, "sit", "g1", 1);
  }

  // ================================================================== agents
  private drawTag(a: Agent3D, pulse?: number) {
    const t = a.tag, col = STATUS[a.data.status].color;
    const label = capLabel(officeLabel(a.data.name, a.data.role));
    if (t.name.textContent !== label) t.name.textContent = label;
    t.el.title = a.data.name + " · " + STATUS[a.data.status].label;
    t.el.classList.toggle("sel", a === this.selected);
    t.el.classList.toggle("dim", a.data.status === "offline");
    t.dot.style.background = col;
    t.dot.style.boxShadow = pulse !== undefined ? `0 0 0 ${(2 + pulse * 5).toFixed(1)}px ${col}${Math.round(0x8c * (1 - pulse)).toString(16).padStart(2, "0")}` : "";
  }

  private buildAgent(d: AgentData, deskIdx: number): Agent3D {
    if (d.id === CLAUDE_AGENT_ID) return this.buildOrb(d, deskIdx);
    if (d.id === OPENCODE_AGENT_ID) return this.buildTerminal(d, deskIdx);
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const sm = new THREE.MeshLambertMaterial({ color: d.color }), skin = SKINS[deskIdx % SKINS.length], hair = HAIRS[(deskIdx * 5 + 2) % HAIRS.length];
    this.box(body, 0.44, 0.48, 0.26, 0, 0.45, 0, sm);
    this.box(body, 0.36, 0.34, 0.34, 0, 0.95, 0, skin); this.box(body, 0.4, 0.12, 0.38, 0, 1.25, 0, hair); this.box(body, 0.4, 0.24, 0.1, 0, 1.03, -0.16, hair);
    this.box(body, 0.05, 0.07, 0.02, -0.08, 1.08, 0.172, 0x1c1c1c); this.box(body, 0.05, 0.07, 0.02, 0.08, 1.08, 0.172, 0x1c1c1c);
    this.box(body, 0.02, 0.1, 0.02, 0, 1.37, 0, C.metal);
    const lightMat = new THREE.MeshBasicMaterial({ color: STATUS[d.status].color });
    const lamp = new THREE.Mesh(this.geo("lamp", () => new THREE.IcosahedronGeometry(0.075, 0)), lightMat); lamp.position.set(0, 1.52, 0); body.add(lamp);
    const limb = (x: number, y: number, w: number, h: number, dp: number, c: Col) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); body.add(pv); this.box(pv, w, h, dp, 0, -h, 0, c); return pv; };
    const legL = limb(-0.11, 0.45, 0.17, 0.45, 0.19, C.pants), legR = limb(0.11, 0.45, 0.17, 0.45, 0.19, C.pants);
    const armL = limb(-0.29, 0.91, 0.13, 0.42, 0.15, sm), armR = limb(0.29, 0.91, 0.13, 0.42, 0.15, sm);
    const book = this.box(body, 0.32, 0.03, 0.22, 0, 0.66, 0.36, 0xe9dfc6); book.visible = false;
    const hit = this.box(g, 0.75, 1.65, 0.75, 0, 0, 0, this.HIT); hit.castShadow = false; hit.receiveShadow = false;
    const ring = new THREE.Mesh(this.geo("ring", () => new THREE.RingGeometry(0.5, 0.64, 28)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false; ring.renderOrder = 5; g.add(ring);
    const tag = this.makeTag(g, 2.0);
    const z = this.textSprite(96, 64, 0.75, 0.5), zc = z.c.getContext("2d")!;
    zc.font = "700 34px " + FONT; zc.fillStyle = "#ffffff"; zc.strokeStyle = "rgba(30,40,60,.85)"; zc.lineWidth = 5;
    zc.strokeText("z z z", 6, 42); zc.fillText("z z z", 6, 42); z.tex.needsUpdate = true; z.sp.visible = false; g.add(z.sp);
    const bubble = (txt: string, bg: string, fg: string) => {
      const b = this.textSprite(96, 96, 0.5, 0.5), c = b.c.getContext("2d")!;
      c.fillStyle = bg; rr(c, 8, 8, 80, 80, 40); c.fill(); c.fillStyle = fg; c.font = "700 50px " + FONT; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, 48, 52);
      b.tex.needsUpdate = true; b.sp.position.set(0.45, 2.45, 0); b.sp.visible = false; g.add(b.sp); return b.sp;
    };
    const a: Agent3D = {
      data: d, group: g, body, lightMat, shirt: sm, legL, legR, armL, armR, book, hit, ring, tag, zzz: z.sp,
      // "?" = unknown state (the API could not tell what the agent is doing)
      dots: bubble("…", "rgba(255,255,255,.95)", "#f2a91e"), excl: bubble("?", "#ef4b4b", "#ffffff"),
      spot: null, path: [], floor: 1, lastNode: "lob", pose: "stand", atSpot: false, deskIdx, since: null, phase: Math.random() * 6,
    };
    hit.userData.agent = a;
    this.drawTag(a);
    return a;
  }

  private toolState(s: AgentStatus): ToolStatus { return s === "working" ? "working" : s === "idle" ? "idle" : "unknown"; }

  /** OpenCode: a quiet, dark teal-glowing faceted orb; state comes from GET /api/agents/tools. */
  private buildTerminal(d: AgentData, deskIdx: number): Agent3D {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const float = new THREE.Group(); float.position.y = ORB_Y; g.add(float);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0f0f0f, emissive: OPC_TEAL, emissiveIntensity: 0.15,
      roughness: 0.35, metalness: 0.6, flatShading: true,
    });
    const mesh = new THREE.Mesh(this.geo("opcOrb", () => new THREE.IcosahedronGeometry(ORB_R * 0.95, 1)), material);
    mesh.renderOrder = 2; float.add(mesh);

    const texture = gradientTexture(128, [[0, "rgba(20,184,166,0.6)"], [1, "rgba(20,184,166,0)"]]);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.08 }));
    glow.scale.setScalar(ORB_R * 2 * 1.8); glow.renderOrder = 1; float.add(glow);

    // Never toggle light.visible: changing the light count recompiles scene materials.
    const light = new THREE.PointLight(OPC_TEAL, 0, 3, 2); float.add(light);
    const hit = this.box(g, 1.1, 1.3, 1.1, 0, ORB_Y - 0.65, 0, this.HIT); hit.castShadow = false; hit.receiveShadow = false;
    const ring = new THREE.Mesh(this.geo("ring", () => new THREE.RingGeometry(0.5, 0.64, 28)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false; ring.renderOrder = 5; g.add(ring);
    const tag = this.makeTag(g, ORB_Y + ORB_R + 0.45 + 0.7), stub = new THREE.Sprite(); stub.visible = false; g.add(stub);
    const a: Agent3D = {
      data: d, group: g, body, lightMat: new THREE.MeshBasicMaterial(), shirt: new THREE.MeshLambertMaterial(),
      legL: new THREE.Group(), legR: new THREE.Group(), armL: new THREE.Group(), armR: new THREE.Group(),
      book: hit, hit, ring, tag, zzz: stub, dots: stub, excl: stub,
      spot: null, path: [], floor: 2, lastNode: "hubW", pose: "stand", atSpot: true, deskIdx, since: null, phase: 0,
      terminal: { float, mesh, glow, light, texture, state: "unknown", time: 0 },
    };
    hit.userData.agent = a;
    this.applyTerminal(a);
    this.drawTag(a);
    return a;
  }
  private opcState(s: AgentStatus): OpenCodeState { return s === "working" ? "working" : s === "idle" ? "standby" : s === "offline" ? "offline" : "unknown"; }
  private applyTerminal(a: Agent3D) {
    const t = a.terminal!; t.state = this.opcState(a.data.status);
    const material = t.mesh.material;
    if (t.state === "working") {
      material.color.setHex(0x0f0f0f); material.emissiveIntensity = 0.45;
      (t.glow.material as THREE.SpriteMaterial).opacity = 0.18; t.light.intensity = 0.25;
    } else if (t.state === "standby") {
      material.color.setHex(0x0f0f0f); material.emissiveIntensity = 0.15;
      (t.glow.material as THREE.SpriteMaterial).opacity = 0.08; t.light.intensity = 0;
    } else {
      material.color.setHex(0x0a0a0a); material.emissiveIntensity = 0;
      (t.glow.material as THREE.SpriteMaterial).opacity = 0; t.light.intensity = 0;
      t.float.position.y = ORB_Y; t.mesh.scale.setScalar(1);
    }
    this.dirty = true;
  }
  private stepTerminal(a: Agent3D, dt: number, _time: number) {
    const t = a.terminal!, d = dt * (this.reduce ? 0.35 : 1);
    t.time += d;
    if (t.state === "working") {
      const k = this.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t.time * 3);
      t.mesh.rotation.y += d;
      t.mesh.material.emissiveIntensity = 0.45 + 0.25 * k;
      (t.glow.material as THREE.SpriteMaterial).opacity = 0.18 + 0.10 * k;
      t.light.intensity = 0.25 + 0.2 * k;
      t.mesh.scale.setScalar(1 + 0.04 * k);
      t.float.position.y = ORB_Y + (this.reduce ? 0 : Math.sin(t.time * 2.4) * 0.08);
    } else if (t.state === "standby") {
      t.mesh.rotation.y += d * 0.25;
      t.mesh.material.emissiveIntensity = 0.15;
      (t.glow.material as THREE.SpriteMaterial).opacity = 0.08;
      t.light.intensity = 0;
      t.mesh.scale.setScalar(1);
      t.float.position.y = ORB_Y + (this.reduce ? 0 : Math.sin(t.time * 1.25) * 0.04);
    } else {
      t.mesh.rotation.y = 0; t.mesh.scale.setScalar(1);
      t.float.position.y = ORB_Y;
      t.mesh.material.color.setHex(0x0a0a0a); t.mesh.material.emissiveIntensity = 0;
      (t.glow.material as THREE.SpriteMaterial).opacity = 0; t.light.intensity = 0;
    }
  }

  /** Claude Code CLI: an orange (#F97316) flat-shaded octahedron mascot with glow and orbiting embers. */
  private buildOrb(d: AgentData, deskIdx: number): Agent3D {
    this.hookShaderErrors();
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const float = new THREE.Group(); float.position.y = ORB_Y; g.add(float);

    const mascotMat = new THREE.MeshStandardMaterial({
      color: 0xF97316, emissive: 0xB45309, emissiveIntensity: 0.45,
      roughness: 0.28, metalness: 0.08, flatShading: true,
    });
    const mascot = new THREE.Mesh(this.geo("claudeMascot", () => new THREE.OctahedronGeometry(ORB_R * 1.05, 1)), mascotMat);
    mascot.rotation.z = Math.PI / 4; mascot.rotation.x = 0.12; mascot.renderOrder = 2; float.add(mascot);

    // Back glow keeps the Claude-style silhouette.
    const glowTex = gradientTexture(128, [[0, "rgba(253,186,116,1)"], [0.45, "rgba(249,115,22,0.37)"], [1, "rgba(180,83,9,0)"]], 0.85 / 2.1);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.3 }));
    glow.scale.setScalar(ORB_R * 2 * 2.1); glow.renderOrder = 1; float.add(glow);

    // Ember sprite = the reference's glow sprite; smoke = a soft round puff tinted per point.
    const emberTex = gradientTexture(64, [[0, "rgba(255,237,213,1)"], [0.12, "rgba(251,146,60,0.95)"], [0.38, "rgba(249,115,22,0.35)"], [1, "rgba(154,52,18,0)"]]);
    const smokeTex = gradientTexture(64, [[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]);
    const fx = new THREE.Group(); fx.rotation.set(0.22, 0, -0.32); float.add(fx); // tilted orbit plane (reference TILT)
    const fxMats: THREE.ShaderMaterial[] = [];
    const layer = (n: number, map: THREE.Texture): OrbLayer => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("aColor", new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
      const pts = (side: number, order: number) => {
        const m = new THREE.ShaderMaterial({
          vertexShader: ORB_PTS_VS, fragmentShader: ORB_PTS_FS, defines: { CLAUDE_ORB: 1 },
          uniforms: { map: { value: map }, uHalfH: { value: 300 }, uSide: { value: side } },
          transparent: true, depthWrite: false,
        });
        fxMats.push(m);
        const p = new THREE.Points(geo, m); p.frustumCulled = false; p.renderOrder = order; fx.add(p); return p;
      };
      return { geo, pos, col, size, back: pts(-1, 1), front: pts(1, 3) };
    };
    const smokeLayer = layer(ORB_TENDRILS * ORB_SEG, smokeTex), emberLayer = layer(ORB_EMBERS, emberTex);
    const embers = Array.from({ length: ORB_EMBERS }, () => spawnEmber({} as Ember, true));
    const tendrils: Tendril[] = Array.from({ length: ORB_TENDRILS }, () => ({
      a0: rand(0, TAU), span: rand(1.2, 3.2), r0: rand(1.1, 1.75), shrink: rand(0.05, 0.28), speed: rand(0.12, 0.3),
      width: rand(2, 7), phase: rand(0, TAU), wob: rand(0.03, 0.08), alpha: rand(0.35, 0.8),
    }));

    // Never toggle light.visible: a changing light count recompiles every material. Intensity only.
    const light = new THREE.PointLight(0xF97316, 0, 4, 2); float.add(light);
    const hit = this.box(g, 1.1, 1.3, 1.1, 0, ORB_Y - 0.65, 0, this.HIT); hit.castShadow = false; hit.receiveShadow = false;
    const ring = new THREE.Mesh(this.geo("ring", () => new THREE.RingGeometry(0.5, 0.64, 28)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false; ring.renderOrder = 5; g.add(ring);
    const tag = this.makeTag(g, ORB_Y + ORB_R + 0.45);
    // Person-only parts (limbs, bubbles) are inert stand-ins: orbs never walk, pose or use them.
    const stub = new THREE.Sprite(); stub.visible = false; g.add(stub);
    const a: Agent3D = {
      data: d, group: g, body, lightMat: new THREE.MeshBasicMaterial(), shirt: new THREE.MeshLambertMaterial(),
      legL: new THREE.Group(), legR: new THREE.Group(), armL: new THREE.Group(), armR: new THREE.Group(),
      book: hit, hit, ring, tag, zzz: stub, dots: stub, excl: stub,
      spot: null, path: [], floor: 1, lastNode: "hubW", pose: "stand", atSpot: false, deskIdx, since: null, phase: 0,
      orb: {
        state: "unknown", float, mascot, glow, fx, embers, tendrils, emberLayer, smokeLayer,
        fxMats, textures: [emberTex, smokeTex], light, pulse: 0, spin: 0, time: 0, tagClock: 0,
      },
    };
    hit.userData.agent = a;
    this.applyOrb(a);
    this.stepOrb(a, 0, 0); // fill the particle buffers before the first render
    this.drawTag(a);
    return a;
  }

  /** Route GL compile/link errors: a failing orb particle shader hides the particle layers (the mascot mesh stays). */
  private hookShaderErrors() {
    if (this.renderer.debug.onShaderError) return;
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      console.error("[office3d] shader error", gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
      if ((gl.getShaderSource(fs) ?? "").includes("CLAUDE_ORB")) for (const a of this.agents) if (a.orb) this.orbFallback(a);
    };
  }
  private orbFallback(a: Agent3D) {
    const o = a.orb!; if (o.fx.userData.off) return;
    o.fx.visible = false; o.fx.userData.off = true;
    console.warn("[office3d] Claude CLI particle shader failed to compile; showing the mascot without particles");
  }
  /** State change: pulse kick on entering "working", particles/light per state. */
  private applyOrb(a: Agent3D) {
    const o = a.orb!, prev = o.state; o.state = this.toolState(a.data.status);
    if (o.state === "working" && prev !== "working") {
      o.pulse = 1;
      for (const e of o.embers) e.vy += rand(10, 35) / 200; // reference trigger(): embers jump outwards/up
    }
    if (o.state === "unknown") { o.pulse = 0; o.float.position.y = ORB_Y; }
    o.fx.visible = o.state !== "unknown" && !o.fx.userData.off;
    o.light.intensity = o.state === "idle" ? 0.1 * Math.PI : 0;
    this.dirty = true;
  }
  private stepOrb(a: Agent3D, dt: number, _t: number) {
    const o = a.orb!, working = o.state === "working", idle = o.state === "idle";
    const d = dt * (this.reduce ? 0.35 : 1); // reference: prefers-reduced-motion slows everything to 0.35x
    o.time = (o.time + d) % 900;
    o.pulse *= Math.exp(-d * 2.2);
    if (working) o.pulse = Math.max(o.pulse, 0.3); else if (!idle) o.pulse = 0;
    o.spin += d * (1 + o.pulse * 3);
    const T = o.time, P = o.pulse;

    if (!this.reduce && o.state !== "unknown") o.float.position.y = ORB_Y + (working ? Math.sin(T * 2.4) * 0.14 : Math.sin(T * 1.25) * 0.05);
    o.mascot.rotation.y += d * (working ? 1.15 : 0.35);
    o.mascot.rotation.z = Math.PI / 4 + Math.sin(T * 0.8) * 0.035;
    o.mascot.scale.setScalar(1 + P * 0.08);
    o.mascot.material.emissiveIntensity = (working ? 0.7 : 0.3) + P * 0.65;
    (o.glow.material as THREE.SpriteMaterial).opacity = o.state === "unknown" ? 0.12 : Math.min(1, 0.3 + 0.07 * Math.sin(T * 1.3) + P * 0.35);
    if (working) o.light.intensity = (1 + Math.min(1, P * 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(T * 2.6)))) * Math.PI;

    if (o.fx.visible) {
      const halfH = this.renderer.domElement.height * 0.5;
      for (const m of o.fxMats) m.uniforms.uHalfH.value = halfH;
      // Smoke tendrils: arcs of soft puffs swirling round the glass (reference drawFX, R units -> world).
      const S = o.smokeLayer, sA = working ? 1 : 0.45;
      let i = 0;
      for (const td of o.tendrils) {
        for (let k = 0; k < ORB_SEG; k++, i++) {
          const s = k / (ORB_SEG - 1), ang = td.a0 + td.speed * o.spin + s * td.span;
          const rad = ORB_R * (td.r0 - td.shrink * s + td.wob * Math.sin(s * 6 + T * 0.8 + td.phase));
          const taper = Math.pow(Math.sin(Math.PI * s), 0.8);
          S.pos[i * 3] = Math.cos(ang) * rad; S.pos[i * 3 + 1] = 0.04 * Math.sin(s * 5 + T + td.phase); S.pos[i * 3 + 2] = Math.sin(ang) * rad;
          // dark rust outside -> warm clay along the bright middle of each tendril
          const w = taper * 0.8;
          S.col[i * 4] = (112 + (242 - 112) * w) / 255; S.col[i * 4 + 1] = (46 + (152 - 46) * w) / 255; S.col[i * 4 + 2] = (28 + (112 - 28) * w) / 255;
          S.col[i * 4 + 3] = td.alpha * taper * 0.42 * sA;
          S.size[i] = (0.05 + (td.width / 7) * 0.2) * (0.35 + 0.65 * taper);
        }
      }
      // Embers: orbit, drift upwards, flicker, respawn (reference maths; speed x2 working, barely moving idle).
      const E = o.emberLayer, boost = (1 + P * 3) * (working ? 2 : 0.25), eA = working ? 1 : 0.25;
      o.embers.forEach((e, j) => {
        e.life += d; if (e.life > e.max) spawnEmber(e, false);
        e.a += e.spd * d * boost; e.vy *= Math.exp(-d * 0.4); e.dy += e.vy * d * 0.6;
        E.pos[j * 3] = Math.cos(e.a) * e.rad * ORB_R; E.pos[j * 3 + 1] = Math.min(e.dy, 1.6) * ORB_R; E.pos[j * 3 + 2] = Math.sin(e.a) * e.rad * ORB_R;
        const k = Math.sin(Math.PI * (e.life / e.max)), al = Math.max(0, k * (0.55 + 0.45 * Math.sin(T * 7 + e.fl)));
        const c = (j % 5) / 4; // #F97316 -> #c43c18
        E.col[j * 4] = (249 + (196 - 249) * c) / 255; E.col[j * 4 + 1] = (115 + (60 - 115) * c) / 255; E.col[j * 4 + 2] = (22 + (24 - 22) * c) / 255;
        E.col[j * 4 + 3] = Math.min(1, al * eA);
        E.size[j] = e.size * (1 + P * 0.6);
      });
      for (const L of [S, E]) for (const n of ["position", "aColor", "aSize"]) L.geo.getAttribute(n).needsUpdate = true;
    }
    if (!working) return;
    o.tagClock += dt; // pulse the label's status dot (~12 redraws/s)
    if (o.tagClock > 0.08) { o.tagClock = 0; this.drawTag(a, 0.5 + 0.5 * Math.sin(T * 5)); }
  }
  private addAgent(id: string, status: AgentStatus, name: string, task: string | null | undefined, meta: AgentMeta) {
    const used = new Set(this.agents.map((x) => x.deskIdx));
    const nDesks = this.th.deskScreens.length;
    let desk = meta.desk;
    if (desk === undefined || desk < 0 || desk >= nDesks || used.has(desk)) {
      desk = [...Array(nDesks).keys()].find((i) => !used.has(i)) ?? this.agents.length % nDesks;
    }
    const d: AgentData = {
      id, name: name || id, role: meta.role ?? "", status: STATUS[status] ? status : "idle", task: task ?? "",
      color: meta.color || "#6b7785", lastActive: meta.lastActive ?? null, reason: meta.reason ?? "",
    };
    const a = this.buildAgent(d, desk);
    a.tag.el.addEventListener("click", () => { this.select(a.data.id); this.opts.onSelect?.(a.data.id); });
    this.agents.push(a); this.byId.set(id, a);
    if (a.orb) { // Claude CLI floats in the Lantai 2 work-area corner; its desk stays reserved.
      const ds = this.spots.filter((x) => x.use[0] === "desk"), s = ds[a.deskIdx % ds.length];
      this.claim(a, s); a.floor = 2; this.th.floors[2].add(a.group);
      a.group.position.set(ORB_POS.x, FT, ORB_POS.z); a.atSpot = true; this.deskGlow(a);
    } else if (a.terminal) {
      a.floor = 2; this.th.floors[2].add(a.group);
      a.group.position.set(OPENCODE_POS.x, FT, OPENCODE_POS.z); a.atSpot = true;
    } else {
      const s = this.pickSpot(a);
      if (s) this.place(a, s);
      this.setDim(a, d.status === "offline");
    }
    if (this.pendingFocus === id) { this.pendingFocus = null; this.select(id); }
    this.dirty = true;
  }

  private removeAgent(a: Agent3D) {
    if (a.spot && a.spot.by === a) a.spot.by = null;
    a.atSpot = false; this.deskGlow(a);
    a.group.parent?.remove(a.group);
    a.tag.el.remove();
    a.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Sprite).isSprite && !(a.terminal && o === a.terminal.glow)) { const sm = m.material as THREE.SpriteMaterial; sm.map?.dispose(); sm.dispose(); }
    });
    const dimShirt = this.dimMats.get(a.shirt); if (dimShirt) { dimShirt.dispose(); this.dimMats.delete(a.shirt); }
    a.shirt.dispose(); a.lightMat.dispose(); (a.ring.material as THREE.Material).dispose();
    if (a.orb) {
      const o = a.orb; // glow sprite material/map are disposed by the sprite traversal above
      [o.mascot.material, ...o.fxMats].forEach((m) => m.dispose());
      o.textures.forEach((t) => t.dispose()); o.emberLayer.geo.dispose(); o.smokeLayer.geo.dispose(); o.light.dispose();
    }
    if (a.terminal) {
      a.terminal.mesh.material.dispose();
      (a.terminal.glow.material as THREE.SpriteMaterial).dispose();
      a.terminal.texture.dispose();
    }
    this.agents = this.agents.filter((x) => x !== a); this.byId.delete(a.data.id);
    if (this.selected === a) this.selected = null;
    this.dirty = true;
  }

  /** Offline look: every body material swapped for a darker translucent clone (status lamp stays lit). */
  private setDim(a: Agent3D, on: boolean) {
    if (a.orb || !!a.dimmed === on) return;
    a.dimmed = on;
    a.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.material === a.lightMat) return;
      if (on) {
        const src = m.material as THREE.Material;
        let dm = this.dimMats.get(src);
        if (!dm) {
          const c = src.clone() as THREE.MeshLambertMaterial;
          c.color?.multiplyScalar(0.55); c.transparent = true; c.opacity = 0.5; c.depthWrite = false;
          dm = c; this.dimMats.set(src, dm);
        }
        m.userData.mat0 = src; m.material = dm; m.castShadow = false;
      } else if (m.userData.mat0) {
        m.material = m.userData.mat0; delete m.userData.mat0; m.castShadow = true;
      }
    });
    this.dirty = true;
  }
  private poseFor(a: Agent3D, s: Spot): Pose { return s.pose === "type" && a.data.status !== "working" ? "sit" : s.pose; }
  private setPose(a: Agent3D, p: Pose) {
    a.pose = p; a.body.position.y = 0; a.body.rotation.y = 0; a.dots.visible = false; a.excl.visible = false;
    const sit = p === "sit" || p === "type" || p === "read" || p === "game";
    a.body.rotation.x = p === "lie" ? -Math.PI / 2 : 0;
    a.legL.rotation.x = a.legR.rotation.x = sit ? -Math.PI / 2 : 0;
    const arm = p === "type" || p === "game" ? -1.15 : p === "read" ? -0.9 : p === "lean" ? -0.75 : 0;
    a.armL.rotation.x = a.armR.rotation.x = arm;
    a.book.visible = p === "read"; a.zzz.visible = p === "lie";
    if (p === "lie") { a.tag.obj.position.set(0, 0.95, -0.7); a.zzz.position.set(0.25, 0.75, -1.25); } else a.tag.obj.position.set(0, sit ? 1.75 : 2.0, 0);
  }
  private deskGlow(a: Agent3D) {
    const m = this.th.deskScreens[a.deskIdx]; if (!m) return;
    const st = a.data.status;
    const on = a.orb ? st === "working" : a.atSpot && !!a.spot && a.spot.use[0] === "desk" && st !== "offline";
    m.emissive.setHex(on ? (st === "error" ? 0xd03a3a : 0x3fa6ee) : 0x000000);
    m.emissiveIntensity = on ? 0.9 : 1;
  }
  private pickSpot(a: Agent3D): Spot | null {
    const use = STATUS[a.data.status].use;
    if (a.data.status === "working") { const own = this.spots.find((s) => s.use[0] === "seat:" + a.data.id); if (own) return own; }
    if (use === "desk") { const ds = this.spots.filter((s) => s.use[0] === "desk"); return ds[a.deskIdx % ds.length]; }
    if (a.spot && a.spot.use.indexOf(use) >= 0) return a.spot;
    let free = this.spots.filter((s) => s.use.indexOf(use) >= 0 && !s.by);
    if (!free.length) free = this.spots.filter((s) => s.use.indexOf("idle") >= 0 && !s.by);
    if (!free.length) return a.spot;
    const best = Math.min(...free.map((s) => s.pri));
    // Deterministic per agent, so a reload doesn't reshuffle rooms.
    const cands = free.filter((s) => s.pri === best);
    return cands[hashStr(a.data.id) % cands.length];
  }
  private claim(a: Agent3D, s: Spot | null) {
    if (a.spot && a.spot !== s && a.spot.by === a) a.spot.by = null;
    a.spot = s; if (s) s.by = a;
  }
  private place(a: Agent3D, s: Spot) {
    this.claim(a, s); a.floor = s.floor; this.th.floors[s.floor].add(a.group);
    a.group.position.set(s.x, s.y, s.z); a.group.rotation.y = s.rot; a.lastNode = s.node; a.path = []; a.atSpot = true;
    this.setPose(a, this.poseFor(a, s)); this.deskGlow(a);
  }
  /** Walk to a spot: route to the stairs, climb/descend floor by floor, then route to the spot's node. */
  private go(a: Agent3D, s: Spot | null) {
    if (!s) return;
    if (a.spot === s && (a.atSpot || a.path.length)) { this.deskGlow(a); return; }
    this.claim(a, s); if (a.atSpot) a.group.position.y = FT; a.atSpot = false; this.deskGlow(a); this.setPose(a, "walk");
    if (this.reduce) { this.place(a, s); this.dirty = true; return; }
    const path: Waypoint[] = [];
    const add = (n: GNode) => path.push({ x: n.x, z: n.z, y: FT, node: n.id });
    const sx = wx(STAIR.x), zb = wz(STAIR.bottom), zt = wz(STAIR.top);
    let f = a.floor, last = a.lastNode;
    for (let guard = 0; f !== s.floor && guard < 4; guard++) {
      if (s.floor > f) {
        this.route(f, last, "stB").forEach(add);
        path.push({ x: sx, z: zb, y: FT }, { x: sx, z: zt, y: FT + LH, switchTo: (f + 1) as FloorNo, yAfter: FT, node: "arr" });
        f = (f + 1) as FloorNo; last = "arr";
      } else {
        this.route(f, last, "arr").forEach(add);
        path.push({ x: sx, z: zt, y: FT, switchTo: (f - 1) as FloorNo, yAfter: FT + LH }, { x: sx, z: zb, y: FT });
        f = (f - 1) as FloorNo; last = "stB";
        add(this.G[f].stB);
      }
    }
    this.route(f, last, s.node).forEach(add);
    path.push({ x: s.x, z: s.z, y: FT, spot: s });
    a.path = path;
  }
  private reach(a: Agent3D, wp: Waypoint) {
    if (wp.node) a.lastNode = wp.node;
    if (wp.switchTo) {
      a.floor = wp.switchTo; this.th.floors[a.floor].add(a.group); a.group.position.y = wp.yAfter ?? FT; this.dirty = true;
    }
    if (wp.spot) {
      a.group.rotation.y = wp.spot.rot; a.group.position.y = wp.spot.y; a.atSpot = true; a.lastNode = wp.spot.node;
      this.setPose(a, this.poseFor(a, wp.spot)); this.deskGlow(a); this.dirty = true;
    }
  }
  private stepAgent(a: Agent3D, dt: number, t: number) {
    const p = a.group.position, ph = t * 9 + a.phase;
    if (a.path.length) {
      const wp = a.path[0], dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz), st = SPEED * dt;
      if (d <= st) { p.x = wp.x; p.z = wp.z; p.y = wp.y; a.path.shift(); this.reach(a, wp); }
      else {
        const k = st / d; p.x += dx * k; p.z += dz * k; p.y += (wp.y - p.y) * k;
        let da = Math.atan2(dx, dz) - a.group.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); a.group.rotation.y += da * Math.min(1, dt * 12);
      }
      if (a.pose === "walk") {
        const s = Math.sin(ph) * 0.65;
        a.legL.rotation.x = s; a.legR.rotation.x = -s; a.armL.rotation.x = -s * 0.8; a.armR.rotation.x = s * 0.8; a.body.position.y = Math.abs(Math.sin(ph)) * 0.05;
      }
      return;
    }
    a.body.position.y = 0;
    const st = a.data.status;
    if (st === "error") a.lightMat.color.setHex(Math.sin(t * 9) > 0 ? 0xef4b4b : 0x6b1d1d);
    a.dots.visible = st === "waiting"; a.excl.visible = st === "error";
    if (a.pose === "stand" || a.pose === "lean" || a.pose === "sit") a.body.rotation.y = st === "offline" ? 0 : Math.sin(t * 0.5 + a.phase) * 0.18; else a.body.rotation.y = 0;
    if (a.pose === "type") {
      a.armL.rotation.x = -1.15 + Math.sin(ph * 1.7) * 0.07; a.armR.rotation.x = -1.15 + Math.cos(ph * 1.9) * 0.07;
    } else if (a.pose === "play") { a.armR.rotation.x = -0.9 + Math.sin(ph * 0.7) * 0.6; a.armL.rotation.x = -0.3; }
    else if (a.pose === "game") { a.armL.rotation.x = -1.1 + Math.sin(ph) * 0.05; a.armR.rotation.x = -1.1 + Math.cos(ph) * 0.05; }
    else if (a.pose === "lie") a.zzz.position.y = 0.75 + Math.sin(ph * 0.25) * 0.08;
  }
  private locText(a: Agent3D) {
    if (a.orb) return "Area Kerja Agen, lantai 2";
    if (a.terminal) return "Area Kerja Agen · OpenCode, lantai 2";
    // Seat-holders (e.g. Hawa → Ruang COO) get their room from the spot itself: "Ruang COO, lantai 2".
    const s = a.spot; if (!s) return "–";
    return (a.atSpot ? "" : "Menuju ") + s.room + ", lantai " + s.floor;
  }

  // ================================================================== roster + detail panel (DOM)
  private buildPanel() {
    const root = el("aside", "ov o3d-roster");
    root.setAttribute("aria-label", "Daftar agent");
    const header = el("header"), title = el("h2"), tally = el("div", "o3d-tally");
    header.append(title, tally);
    const list = el("ul", "o3d-list");
    const detail = el("section", "o3d-detail"); detail.hidden = true;
    const h3 = el("h3"), dName = el("span"), close = el("button", "", "Tutup");
    close.type = "button"; close.addEventListener("click", () => this.select(null));
    h3.append(dName, close);
    const dl = el("dl");
    detail.append(h3, dl);
    root.id = "o3d-roster-" + Math.random().toString(36).slice(2, 8);
    // Tab bar right under the header: "Agen" (roster + detail, unchanged) and "Ruangan" (room shortcuts).
    const tablist = el("div", "roster-tabs"); tablist.setAttribute("role", "tablist"); tablist.setAttribute("aria-label", "Panel kantor");
    const mkTab = (key: RosterTab, label: string) => {
      const btn = el("button", "roster-tab-btn", label), pane = el("div", "roster-tab-pane");
      btn.type = "button"; btn.id = root.id + "-tab-" + key; pane.id = root.id + "-pane-" + key;
      btn.setAttribute("role", "tab"); btn.setAttribute("aria-controls", pane.id);
      pane.setAttribute("role", "tabpanel"); pane.setAttribute("aria-labelledby", btn.id);
      btn.addEventListener("click", () => this.setRosterTab(key));
      tablist.appendChild(btn);
      return { btn, pane };
    };
    this.tabs = { agents: mkTab("agents", "Agen"), rooms: mkTab("rooms", "Ruangan") };
    const order: RosterTab[] = ["agents", "rooms"];
    tablist.addEventListener("keydown", (e) => {
      let k: RosterTab | null = null;
      const i = order.indexOf(this.rosterTab);
      if (e.key === "ArrowRight") k = order[(i + 1) % order.length];
      else if (e.key === "ArrowLeft") k = order[(i - 1 + order.length) % order.length];
      else if (e.key === "Home") k = order[0];
      else if (e.key === "End") k = order[order.length - 1];
      if (!k) return;
      e.preventDefault();
      this.setRosterTab(k);
      this.tabs[k].btn.focus();
    });
    this.tabs.agents.pane.append(this.buildRosterFilters(root.id), list, detail);
    this.tabs.rooms.pane.appendChild(this.buildRoomList(root.id));
    root.append(header, tablist, this.tabs.agents.pane, this.tabs.rooms.pane);
    this.applyRosterTab();
    const toggle = el("button", "ov o3d-toggle"); toggle.type = "button";
    toggle.setAttribute("aria-controls", root.id);
    toggle.addEventListener("click", () => this.setSidebar(!this.sidebarOpen));
    this.host.append(root, toggle);
    const ui = { root, toggle, title, tally, list, detail, dl, dName };
    this.applySidebar(ui);
    return ui;
  }
  private applySidebar(ui = this.ui) {
    const open = this.sidebarOpen;
    ui.root.classList.toggle("closed", !open);
    ui.root.toggleAttribute("inert", !open);
    ui.root.setAttribute("aria-hidden", open ? "false" : "true");
    ui.toggle.classList.toggle("closed", !open);
    ui.toggle.textContent = open ? "✕" : "☰";
    ui.toggle.title = open ? "Sembunyikan daftar agent" : "Tampilkan daftar agent";
    ui.toggle.setAttribute("aria-label", ui.toggle.title);
    ui.toggle.setAttribute("aria-expanded", String(open));
  }
  private setSidebar(open: boolean) {
    if (open === this.sidebarOpen) return;
    this.sidebarOpen = open;
    try { localStorage.setItem(SIDEBAR_KEY, String(open)); } catch { /* storage unavailable */ }
    this.applySidebar();
  }
  private faceIcon(a: Agent3D) {
    const orb = a.orb ? a.orb.state : null;
    const skin = hex6(SKINS[a.deskIdx % SKINS.length]), hair = hex6(HAIRS[(a.deskIdx * 5 + 2) % HAIRS.length]);
    const key = orb ? "orb:" + orb : skin + hair + a.data.color;
    let url = this.faces.get(key);
    if (url === undefined) { url = orb ? drawClaudeMascotFace(orb) : drawFace(skin, hair, a.data.color); this.faces.set(key, url); }
    return url;
  }
  /** Platform group of an agent: Claude Code CLI (orb) + OpenCode engine (terminal) are "tools". */
  private groupOf(a: Agent3D): PlatformGroup {
    if (a.terminal || a.orb || a.data.id === CLAUDE_AGENT_ID || a.data.id === OPENCODE_AGENT_ID) return "tools";
    return a.data.id.startsWith("openclaw:") ? "openclaw" : "hermes";
  }
  private isFiltered() {
    const f = this.rosterFilter;
    return f.platform !== "all" || f.status !== "all" || this.rosterQuery.trim() !== "";
  }
  /** AND of platform, status and name/id substring (case-insensitive). */
  private matchesFilter(a: Agent3D) {
    const f = this.rosterFilter;
    if (f.platform !== "all" && this.groupOf(a) !== f.platform) return false;
    if (!statusMatches(f.status, a.data.status)) return false;
    const q = this.rosterQuery.trim().toLowerCase();
    return !q || a.data.name.toLowerCase().includes(q) || a.data.id.toLowerCase().includes(q);
  }
  /** Filter controls of the "Agen" tab. Built once: re-renders only rebuild the <ul>, so the search keeps focus/value. */
  private buildRosterFilters(idBase: string) {
    const box = el("div", "o3d-filters");
    const search = el("div", "o3d-search");
    const input = el("input");
    input.type = "search"; input.placeholder = "Cari nama agent…"; input.id = idBase + "-q";
    input.setAttribute("aria-label", "Cari agent berdasarkan nama"); input.autocomplete = "off"; input.spellcheck = false;
    const clear = el("button", "o3d-search-clear", "✕");
    clear.type = "button"; clear.title = "Kosongkan pencarian"; clear.setAttribute("aria-label", clear.title); clear.hidden = true;
    input.addEventListener("input", () => { this.rosterQuery = input.value; clear.hidden = !input.value; this.renderRoster(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); e.stopPropagation(); this.setRosterQuery(""); } });
    clear.addEventListener("click", () => { this.setRosterQuery(""); input.focus(); });
    search.append(input, clear);
    this.searchInput = input; this.searchClear = clear;
    const mkSeg = <K extends string>(label: string, opts: [K, string][], map: Map<K, HTMLButtonElement>, pick: (k: K) => void) => {
      const seg = el("div", "segmented o3d-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", label);
      opts.forEach(([k, text]) => {
        const b = el("button", "", text); b.type = "button";
        b.addEventListener("click", () => pick(k));
        map.set(k, b); seg.appendChild(b);
      });
      return seg;
    };
    box.append(
      search,
      mkSeg("Filter platform", PLATFORM_FILTERS, this.filterBtns.platform, (k) => this.setRosterFilter({ platform: k })),
      mkSeg("Filter status", STATUS_FILTERS, this.filterBtns.status, (k) => this.setRosterFilter({ status: k })),
    );
    this.applyFilterButtons();
    return box;
  }
  private applyFilterButtons() {
    this.filterBtns.platform.forEach((b, k) => b.setAttribute("aria-pressed", String(k === this.rosterFilter.platform)));
    this.filterBtns.status.forEach((b, k) => b.setAttribute("aria-pressed", String(k === this.rosterFilter.status)));
  }
  private setRosterFilter(patch: Partial<{ platform: PlatformFilter; status: StatusFilter }>) {
    this.rosterFilter = { ...this.rosterFilter, ...patch };
    try { localStorage.setItem(ROSTER_FILTER_KEY, JSON.stringify(this.rosterFilter)); } catch { /* storage unavailable */ }
    this.applyFilterButtons();
    this.renderRoster();
  }
  private setRosterQuery(q: string) {
    this.rosterQuery = q;
    if (this.searchInput) this.searchInput.value = q;
    if (this.searchClear) this.searchClear.hidden = !q;
    this.renderRoster();
  }
  private resetRosterFilters() {
    this.rosterQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    if (this.searchClear) this.searchClear.hidden = true;
    this.setRosterFilter({ platform: "all", status: "all" });
  }
  private renderRoster() {
    const { title, tally, list } = this.ui;
    // Title: "N agent", or "X dari N agent" while filtered. The tally below always counts every agent.
    const shown = this.agents.filter((a) => this.matchesFilter(a));
    title.textContent = this.isFiltered() ? shown.length + " dari " + this.agents.length + " agent" : this.agents.length + " agent";
    tally.textContent = "";
    const counts: Partial<Record<AgentStatus, number>> = {};
    this.agents.forEach((a) => { counts[a.data.status] = (counts[a.data.status] || 0) + 1; });
    (Object.keys(STATUS) as AgentStatus[]).forEach((k) => {
      if (!counts[k]) return;
      const s = el("span"), d = el("i", "o3d-dot"); d.style.background = STATUS[k].color;
      s.append(d, document.createTextNode(counts[k] + " " + STATUS[k].label.toLowerCase())); tally.appendChild(s);
    });
    const keepY = list.scrollTop, keepX = list.scrollLeft;
    list.textContent = "";
    if (!shown.length) {
      const li = el("li", "o3d-empty"), reset = el("button", "o3d-reset", "Reset filter");
      reset.type = "button"; reset.addEventListener("click", () => this.resetRosterFilters());
      li.append(el("p", "", "Tidak ada agent yang cocok"), reset); list.appendChild(li);
    }
    // Platform groups Hermes → OpenClaw → Tools; desk order inside each group, independent of fetch order.
    GROUPS.forEach(([g, label]) => {
      const members = shown.filter((a) => this.groupOf(a) === g).sort((x, y) => x.deskIdx - y.deskIdx);
      if (!members.length) return;
      const head = el("li", "o3d-group", label); head.setAttribute("role", "presentation"); list.appendChild(head);
      members.forEach((a) => this.renderRosterItem(a, list));
    });
    list.scrollTop = keepY; list.scrollLeft = keepX;
    this.renderDetail();
  }
  private renderRosterItem(a: Agent3D, list: HTMLUListElement) {
    const li = el("li"), b = el("button"); b.type = "button";
    if (a === this.selected) b.setAttribute("aria-current", "true");
    const av = el("span", "o3d-avatar"), face = el("img"); face.src = this.faceIcon(a); face.alt = ""; face.draggable = false;
    av.style.background = a.orb ? "#1c1f26" : a.data.color; av.appendChild(face);
    if (a.orb) b.classList.add("o3d-mascot", "o3d-mascot-" + a.orb.state);
    if (a.data.status === "offline") b.classList.add("o3d-off");
    const st = el("i"); st.style.background = STATUS[a.data.status].color; av.appendChild(st);
    const oc = a.data.id.startsWith("openclaw:");
    const engine = !!a.terminal;
    const fw = el("span", "o3d-fw " + (engine ? "badge-opencode" : oc ? "badge-openclaw" : "badge-hermes"), engine ? "OPC" : oc ? "OC" : "H");
    fw.title = engine ? "OpenCode engine" : oc ? "OpenClaw agent" : "Hermes agent";
    const nm = el("span", "o3d-name"); nm.append(fw, el("span", "truncate", capLabel(a.data.name)));
    const who = el("span", "o3d-who"); who.appendChild(nm);
    const sm = el("small", "", STATUS[a.data.status].label); sm.style.color = STATUS[a.data.status].color; who.appendChild(sm);
    b.append(av, who, el("span", "o3d-where", this.locText(a)));
    b.addEventListener("click", () => { this.select(a.data.id); this.opts.onSelect?.(a.data.id); });
    li.appendChild(b); list.appendChild(li);
  }
  private renderDetail() {
    const { detail, dl, dName } = this.ui, a = this.selected;
    if (!a) { detail.hidden = true; return; }
    detail.hidden = false;
    dName.textContent = a.data.name;
    const rows: [string, string, string?][] = [
      ["Peran", a.data.role || "–"],
      ["Status", STATUS[a.data.status].label, STATUS[a.data.status].color],
      ["Lokasi", this.locText(a)],
      ["Tugas", a.data.task || "–"],
      ["Alasan", a.data.reason || "–"],
      ["Aktivitas", a.data.lastActive && !isNaN(Date.parse(a.data.lastActive)) ? ago(Date.parse(a.data.lastActive)) : "–"],
      ["Sejak", a.since ? ago(a.since) : "–"],
    ];
    dl.textContent = "";
    rows.forEach(([k, v, color]) => {
      const dd = el("dd", "", v);
      if (color) { dd.style.color = color; dd.style.fontWeight = "600"; }
      dl.append(el("dt", "", k), dd);
    });
  }

  // ================================================================== roster tabs + room shortcuts (DOM)
  private applyRosterTab() {
    (Object.keys(this.tabs) as RosterTab[]).forEach((k) => {
      const on = k === this.rosterTab, { btn, pane } = this.tabs[k];
      btn.setAttribute("aria-selected", String(on));
      btn.tabIndex = on ? 0 : -1;
      pane.hidden = !on;
    });
  }
  private setRosterTab(tab: RosterTab) {
    if (tab === this.rosterTab) return;
    this.rosterTab = tab;
    try { localStorage.setItem(ROSTER_TAB_KEY, tab); } catch { /* storage unavailable */ }
    this.applyRosterTab();
  }
  /** "Ruangan" tab body: rooms grouped per floor; click = fly to the room (switching floor if needed). */
  private buildRoomList(idBase: string) {
    const body = el("div", "room-list");
    this.roomEntries = [];
    for (const floor of [1, 2] as const) {
      const sec = el("section"), label = el("p", "room-section-label", "Lantai " + floor), ul = el("ul");
      label.id = idBase + "-l" + floor; ul.setAttribute("aria-labelledby", label.id);
      ROOMS.forEach((r, i) => {
        if (r.floor !== floor) return;
        const li = el("li"), b = el("button", "room-entry"); b.type = "button";
        const ic = el("span", "room-icon", r.icon); ic.setAttribute("aria-hidden", "true");
        b.append(ic, el("span", "room-name", r.name));
        b.title = "Pindah kamera ke " + r.name + " (lantai " + floor + ")";
        b.addEventListener("click", () => this.goToRoom(i));
        this.roomEntries[i] = b; li.appendChild(b); ul.appendChild(li);
      });
      sec.append(label, ul); body.appendChild(sec);
    }
    return body;
  }
  /** Room shortcut: show the room's floor, then fly the camera to the room keeping the current heading. */
  private goToRoom(i: number) {
    const r = ROOMS[i]; if (!r) return;
    if (this.th.mode !== r.floor) { this.th.setMode(r.floor); this.opts.onPresetChange?.(r.floor); }
    const t = new THREE.Vector3(wx(r.px), this.targetY(r.floor), wz(r.pz));
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.copy(HOME_CAM).sub(HOME_TGT);
    dir.normalize();
    // Keep the heading but never look flatter than ~37° from horizontal (like the default view).
    if (dir.y < 0.6) { dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize().multiplyScalar(0.8); dir.y = 0.6; }
    this.flyTo(t, t.clone().add(dir.normalize().multiplyScalar(ROOM_CAM_DIST)), 0.9);
  }
  /** Highlight the room the camera target is in (nearest room centre on the shown floor, within ROOM_NEAR). */
  private updateActiveRoom() {
    const m = this.th.mode, t = this.tween ? this.tween.tt : this.controls.target;
    let best = -1, bestD = ROOM_NEAR;
    if (m === 1 || m === 2) ROOMS.forEach((r, i) => {
      if (r.floor !== m) return;
      const d = Math.hypot(wx(r.px) - t.x, wz(r.pz) - t.z);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best === this.activeRoom) return;
    this.roomEntries[this.activeRoom]?.removeAttribute("aria-current");
    this.roomEntries[best]?.setAttribute("aria-current", "true");
    this.activeRoom = best;
  }

  // ================================================================== camera / floors
  private flyTo(t: THREE.Vector3, p: THREE.Vector3, dur = 0.7) {
    if (this.reduce) { this.controls.target.copy(t); this.camera.position.copy(p); this.tween = null; return; }
    this.tween = { ft: this.controls.target.clone(), fp: this.camera.position.clone(), tt: t, tp: p, k: 0, dur };
  }
  /** Reference targetY(): camera target height per mode. */
  private targetY(m: FloorMode) { return m === "all" ? 3.5 : m === "x" ? 8 : (m - 1) * LH + 1.2; }
  private setMode(m: FloorMode, keepCam = false, instant = false) {
    this.th.setMode(m);
    if (keepCam) return;
    const dy = this.targetY(m) - this.controls.target.y;
    const t = this.controls.target.clone().setY(this.controls.target.y + dy), p = this.camera.position.clone().setY(this.camera.position.y + dy);
    if (instant) { this.controls.target.copy(t); this.camera.position.copy(p); this.tween = null; } else this.flyTo(t, p);
  }
  /** Agent tags are readable when their floor is the one shown (or the whole building / split view is shown). */
  private tagVisible(a: Agent3D) { const m = this.th.mode; return m === "all" || m === "x" || m === 4 || a.floor === m; }
  private select(id: string | null) {
    const prev = this.selected;
    this.selected = id === null || id === undefined ? null : this.byId.get(String(id)) ?? null;
    if (prev) { prev.ring.visible = false; this.drawTag(prev); }
    const a = this.selected;
    if (a) {
      a.ring.visible = true; this.drawTag(a);
      const m = this.th.mode;
      if (m !== "x" && m !== a.floor) { this.th.setMode(a.floor); this.opts.onPresetChange?.(a.floor); }
      const f = this.th.floors[a.floor], p = a.group.getWorldPosition(new THREE.Vector3());
      p.y += this.th.yTarget[a.floor] - f.position.y + 0.8;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      if (dir.y < 0.45) { dir.y = 0.6; dir.normalize(); }
      this.flyTo(p, p.clone().add(dir.multiplyScalar(16)), 0.9);
    }
    this.dirty = true;
  }

  // ================================================================== theme
  private applyTheme() { this.th.setNight(this.tod === "night"); }

  // ================================================================== events + loop
  private onControlsStart = () => { this.tween = null; };
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    if (!this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y); this.down = null;
    if (moved > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(m, this.camera);
    const hits = this.ray.intersectObjects(this.agents.filter((a) => this.th.floors[a.floor].visible && this.tagVisible(a)).map((a) => a.hit), false);
    const a = hits.length ? (hits[0].object.userData.agent as Agent3D) : null;
    this.select(a ? a.data.id : null);
    if (a) this.opts.onSelect?.(a.data.id);
  };
  private resize = () => {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.css.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };
  /** Reference updateLabels(): room labels for the visible floor only, faded with distance, hidden past 95 m. */
  private updateLabels() {
    const cam = this.camera.position, v = this.tmpV;
    for (const L of this.th.labels) {
      let show = this.showLabels && this.th.labelVisible(L.floor);
      if (show) {
        L.obj.getWorldPosition(v); const dist = v.distanceTo(cam);
        if (dist > 95) show = false;
        else L.obj.element.style.opacity = dist > 60 ? String(Math.max(0.35, 1 - (dist - 60) / 50)) : "1";
      }
      L.obj.visible = show;
    }
    for (const a of this.agents) a.tag.obj.visible = this.tagVisible(a);
  }
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    // Reference caps dt at 0.05 s; 0.25 keeps walking real-time on slow (software-GL) machines.
    const dt = Math.min(Math.max(0, (now - this.last) / 1000), 0.25); this.last = now;
    this.elapsed += dt;
    const t = this.elapsed;
    this.th.update(this.reduce ? 0 : dt, t, this.controls.target);
    if (this.reduce) for (const n of [1, 2, 3, 4] as const) this.th.floors[n].position.y = this.th.yTarget[n];
    if (this.tween) {
      const tw = this.tween; tw.k = Math.min(1, tw.k + dt / tw.dur);
      const k = tw.k, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.controls.target.lerpVectors(tw.ft, tw.tt, e); this.camera.position.lerpVectors(tw.fp, tw.tp, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    for (const a of this.agents) { if (a.orb) this.stepOrb(a, dt, t); else if (a.terminal) this.stepTerminal(a, dt, t); else this.stepAgent(a, dt, t); }
    this.detailClock += dt;
    if (this.detailClock > 1) { this.detailClock = 0; if (this.selected) this.renderDetail(); }
    if (this.dirty) { this.dirty = false; this.renderRoster(); }
    this.updateLabels();
    this.updateActiveRoom();
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
    if (!this.firstFrame) { this.firstFrame = true; this.opts.onFirstFrame?.(); }
  };
}
