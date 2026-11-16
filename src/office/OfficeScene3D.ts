// Realistic two-floor 3D office, ported from the standalone "AI Office 3D" HTML reference
// (three@0.128 + global OrbitControls) to three@0.187 + ES modules, wrapped in one class.
//
// Port notes (r128 -> r187):
// - OrbitControls comes from three/examples/jsm.
// - PCFSoftShadowMap was removed in r18x; PCFShadowMap + shadow.radius is used instead.
// - THREE.Clock is deprecated; frame timing uses performance.now().
// - Lights are physical since r155: the reference's legacy intensities are multiplied by PI, and
//   colour management is switched off while this scene lives (restored on dispose), so hex colours,
//   canvas textures and lighting render like the r128 reference. Nothing else in the app uses three.
// - The reference's random "simulation" is NOT ported: agents only change when Office.tsx pushes
//   real /api/office/state + /api/openclaw/agents data in through setAgentState()/setRobotState().
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Preset = "overview" | "workspace" | "lounge";
import type { TimeOfDay } from "./palettes";
export type { TimeOfDay };
export type AgentStatus = "working" | "meeting" | "waiting" | "idle" | "break" | "offline" | "error";
export type ToolStatus = "working" | "idle" | "unknown";
type Mode = "f1" | "f2" | "all";
type Pose = "stand" | "sit" | "type" | "read" | "game" | "lie" | "lean" | "play" | "walk";
type FloorNo = 1 | 2;

const PRESET_MODE: Record<Preset, Mode> = { overview: "all", workspace: "f1", lounge: "f2" };
const MODE_PRESET: Record<Mode, Preset> = { all: "overview", f1: "workspace", f2: "lounge" };

export const STATUS: Record<AgentStatus, { label: string; color: string; use: string }> = {
  working: { label: "Bekerja", color: "#2fbf71", use: "desk" },
  meeting: { label: "Meeting", color: "#4c8dff", use: "meeting" },
  waiting: { label: "Menunggu input", color: "#f2a91e", use: "waiting" },
  idle: { label: "Idle", color: "#9aa6b1", use: "idle" },
  break: { label: "Istirahat", color: "#b06cf0", use: "break" },
  offline: { label: "Offline", color: "#7b8794", use: "sleep" },
  error: { label: "Error", color: "#ef4b4b", use: "desk" },
};

export const CLAUDE_AGENT_ID = "claude_cli";
const CLAUDE_COLOR = "#F97316";

/** Extra per-agent info pushed with each state update. All optional; missing → "–". */
export interface AgentMeta {
  role?: string | null;
  color?: string;
  /** Preferred desk index (0..9). Falls back to the first free desk. */
  desk?: number;
  /** ISO timestamp of the agent's last real activity, shown as "Aktivitas". */
  lastActive?: string | null;
  /** Why the API reports this state (shown as "Alasan"). */
  reason?: string | null;
}

export interface SceneOptions {
  onSelect?: (id: string) => void;
  onFirstFrame?: () => void;
  /** Fired when the scene changes floor by itself (selecting an agent on a hidden floor). */
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
type Animator = (dt: number, t: number) => void;
interface GNode { id: string; x: number; z: number; adj: string[] }
interface Spot {
  id: string; floor: FloorNo; room: string; use: string[]; x: number; z: number; rot: number; pose: Pose;
  node: string; y: number; pri: number; by: Agent3D | null;
}
interface Wall { tall: THREE.Group; low: THREE.Group; nx: number; nz: number }
interface Sprite2D { c: HTMLCanvasElement; tex: THREE.CanvasTexture; sp: THREE.Sprite }
interface Waypoint { x: number; z: number; y: number; node?: string; switchTo?: FloorNo; yAfter?: number; spot?: Spot }

interface AgentData { id: string; name: string; role: string; status: AgentStatus; task: string; color: string; lastActive: string | null; reason: string }
interface Agent3D {
  data: AgentData; group: THREE.Group; body: THREE.Group; lightMat: THREE.MeshBasicMaterial; shirt: THREE.MeshLambertMaterial;
  legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  book: THREE.Mesh; hit: THREE.Mesh; ring: THREE.Mesh; tag: Sprite2D; zzz: THREE.Sprite; dots: THREE.Sprite; excl: THREE.Sprite;
  spot: Spot | null; path: Waypoint[]; floor: FloorNo; lastNode: string; pose: Pose; atSpot: boolean;
  deskIdx: number; since: number | null; phase: number;
  /** Claude Code CLI is a tool, not a person: rendered as a floating energy orb instead of a body. */
  orb?: Orb;
}
/** One orbiting ember (units: orb radii, like the reference's R-relative maths). */
interface Ember { a: number; rad: number; spd: number; dy: number; vy: number; size: number; max: number; life: number; fl: number }
/** One smoke tendril: an arc of soft blobs on the tilted orbit plane. */
interface Tendril { a0: number; span: number; r0: number; shrink: number; speed: number; width: number; phase: number; wob: number; alpha: number }
/** A particle layer: one buffer drawn twice (behind the orb, then in front of it). */
interface OrbLayer { geo: THREE.BufferGeometry; pos: Float32Array; col: Float32Array; size: Float32Array; back: THREE.Points; front: THREE.Points }
interface Orb {
  state: ToolStatus; float: THREE.Group; plane: THREE.Mesh; mat: THREE.ShaderMaterial; fallback: THREE.MeshBasicMaterial | null;
  glow: THREE.Sprite; fx: THREE.Group; embers: Ember[]; tendrils: Tendril[]; emberLayer: OrbLayer; smokeLayer: OrbLayer;
  fxMats: THREE.ShaderMaterial[]; textures: THREE.Texture[]; light: THREE.PointLight;
  pulse: number; spin: number; time: number; tagClock: number;
}
/** Claude CLI orb: floats in the Lantai 1 lobby, between the meeting room's glass wall (x=-5) and the stairs (x~0..4). */
const ORB_POS = { x: -2.4, z: 3.9 };
const ORB_Y = 1.6;   // centre height (about a character's shoulder)
const ORB_R = 0.5;   // glass sphere radius (1u across, roughly one character)
const ORB_EMBERS = 80, ORB_TENDRILS = 16, ORB_SEG = 14;
const TAU = Math.PI * 2;

/* Clay/glass orb shaders, ported from the reference orb.html (WebGL1 full-screen quad -> Three.js billboard).
   Changes vs. the reference FS: uv comes from vUv (-1..1 across the plane) instead of gl_FragCoord/uRes, uRes is
   gone, and the 2-pixel edge AA uses fwidth(r) instead of 2.0/px. Everything else is verbatim. gl_FragColor /
   texture2D keep working: ShaderMaterial (glslVersion unset) maps them onto GLSL ES 3.00 for WebGL2. */
const ORB_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ORB_FS = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i=0;i<5;i++){ v += a*noise(p); p = m*p; a *= 0.5; }
  return v;
}
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  float r = length(uv);
  float aa = 2.0*fwidth(r); // derivative taken before the early return (needs uniform control flow)
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  float t = uTime;
  float z = sqrt(max(0.0, 1.0 - r*r));
  vec3 n = vec3(uv, z);

  vec2 p = uv/(0.5 + z*0.5);
  p = rot(t*0.07)*p*1.55;
  float sw = 1.3/(1.0 + dot(p,p)*0.55);
  p = rot(sw*(0.9*sin(t*0.27) + t*0.18))*p;

  vec2 q  = vec2(fbm(p + vec2(0.0, t*0.12)), fbm(p + vec2(5.2,1.3) - t*0.10));
  vec2 rr = vec2(fbm(p + 3.0*q + vec2(1.7,9.2) + t*0.15), fbm(p + 3.0*q + vec2(8.3,2.8) - t*0.13));
  float f = fbm(p + 3.5*rr);

  vec3 deep = vec3(0.10, 0.035, 0.02);
  vec3 mid  = vec3(0.70, 0.31, 0.19);
  vec3 hot  = vec3(1.0, 0.74, 0.56);
  vec3 col = mix(deep, mid, smoothstep(0.22, 0.72, f));
  col = mix(col, hot, smoothstep(0.62, 0.95, f)*0.65);

  float veins = pow(1.0 - abs(sin(f*13.0 + rr.x*6.0)), 7.0);
  col += veins*vec3(0.98, 0.58, 0.40)*0.38*smoothstep(0.3, 0.75, length(q));

  float dark = smoothstep(0.46, 0.72, fbm(p*1.25 - rr*2.0 + t*0.05));
  col *= mix(1.0, 0.32, dark);

  float sr = length(uv);
  float sa = atan(uv.y, uv.x);
  float sn = fbm(vec2(sa*1.2, sr*6.0 - t*0.6));
  float phase = 2.0*sa - 15.0*sr + t*1.1 + (sn - 0.5)*0.9;
  float arm = smoothstep(0.72, 1.0, sin(phase));
  float smask = smoothstep(0.44, 0.26, sr)*smoothstep(0.02, 0.07, sr);
  float core = exp(-sr*sr*260.0);
  float flick = 0.62 + 0.18*sin(t*2.1) + 0.1*sin(t*5.3 + 1.7) + uPulse*0.6;
  float sigil = arm*smask*(1.0 - sr*1.4);
  vec3 sigCol = mix(vec3(0.96, 0.52, 0.34), vec3(1.0, 0.9, 0.78), core + arm*0.25*smask);
  col = mix(col, sigCol, clamp(sigil*1.3 + core, 0.0, 1.0)*clamp(flick, 0.0, 1.0));
  float halo = exp(-sr*3.4);
  col += vec3(0.85, 0.42, 0.26)*halo*0.32*flick;

  vec3 L = normalize(vec3(0.45, 0.6, 0.7));
  col *= 0.55 + 0.5*max(dot(n, L), 0.0);
  float fres = pow(1.0 - z, 2.4);
  col *= mix(1.0, 0.6, smoothstep(0.55, 1.0, r));
  col += vec3(0.85, 0.42, 0.29)*fres*0.95;
  col += vec3(0.60, 0.25, 0.15)*smoothstep(0.2, 1.0, -uv.y)*fres*0.7;

  vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hv), 0.0), 70.0);
  col += vec3(1.0, 0.94, 0.88)*spec*0.85;
  float gloss = smoothstep(0.38, 0.0, length((uv - vec2(0.22, 0.58))*vec2(1.0, 2.1)));
  col += vec3(1.0, 0.80, 0.68)*gloss*0.16;
  float crescent = smoothstep(0.035, 0.0, abs(r - 0.93))*smoothstep(0.1, 0.7, uv.y + uv.x*0.3);
  col += vec3(1.0, 0.75, 0.60)*crescent*0.22;

  col *= 1.0 + uPulse*0.55;
  col = col/(1.0 + col*0.3);

  float alpha = smoothstep(1.0, 1.0 - aa, r);
  gl_FragColor = vec4(col*alpha, alpha);
}`;
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
/** Corner floor lamps: off-ish by day, warm glow at night. */
const LAMP = { bulbDay: 0xd4b85a, bulbNight: 0xfff5c0, light: 0xffd580, dayI: 0.05, nightI: 0.6, dist: 5, decay: 1.5 };

const C = {
  wall: 0xece4d2, part: 0xe0d7c3, slab: 0xd9cfba, wood: 0xc48a55, woodDark: 0x8a5a34, deskTop: 0xeadcc0, metal: 0x2c2f36,
  white: 0xf5f4ef, glassSolid: 0x9fd6ee, grass: 0x69ab47, pave: 0xc4bba8, paveEdge: 0xaea592, road: 0x3b3e44, leaf: 0x3f9a45, leaf2: 0x2f8040,
  trunk: 0x7a5230, sofaBlue: 0x4f6fa8, sofaOrange: 0xe08a4a, sofaGreen: 0x5e9c7a, carpetRed: 0x8e3a34, navy: 0x2f3f7a, tile: 0xdfe7e8,
  kitchen: 0xe9e3d6, bedCarpet: 0x8394b8, sage: 0xa9b98f, rug: 0x7fa3b5, rugWarm: 0xc8744f, deck: 0xa98d6e, pot: 0xb86a45, pants: 0x2f3644,
};
const SKINS = [0xf1c9a5, 0xd9a273, 0xa8754f, 0xf5d6b8, 0x8d5a3b, 0xe3b48c];
const HAIRS = [0x2b2320, 0x5a3a22, 0x1c1c1c, 0x8a5a34, 0x3a2a22, 0xc98a3c];
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const SPEED = 2.4;
const N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2, S = 0;
// Reference light values (r128 legacy units); multiplied by PI for r187 physical lights.
const THEME = {
  night: { bg: 0x131b2b, hemi: 0.42, hemiColor: 0xaab9e6, sun: 0.3, sunColor: 0xbfd0ff },
  day: { bg: 0xbfe6f7, hemi: 0.72, hemiColor: 0xffffff, sun: 0.62, sunColor: 0xfff3dd },
};
const VIEWS: Record<Mode, { t: number[]; o: number[] }> = {
  f1: { t: [0, 0.4, 0.8], o: [8, 22, 27] }, f2: { t: [0, 3.4, 1.6], o: [8, 23, 28] }, all: { t: [0, 5.6, -0.6], o: [11, 27, 39] },
};

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
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
const hex6 = (n: number) => "#" + n.toString(16).padStart(6, "0");
/** Roster icon for Claude CLI: a glowing orb (radial gradient, bright centre fading to transparent). */
function drawOrbFace(state: ToolStatus): string {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#1c1f26"; g.fillRect(0, 0, 64, 64);
  const col = state === "working" ? CLAUDE_COLOR : state === "idle" ? "#8B6914" : "#5A5A5A";
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, state === "working" ? "#FFE2BF" : col); grad.addColorStop(0.3, col); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = state === "working" ? 1 : 0.7;
  g.fillStyle = grad; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
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
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 500);
  private controls: OrbitControls;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private world = new THREE.Group();
  private F1 = new THREE.Group();
  private F2 = new THREE.Group();
  private floors: Record<FloorNo, THREE.Group>;
  private walls: Wall[] = [];
  private labels: THREE.Sprite[] = [];
  private animators: Animator[] = [];
  private deskScreens: THREE.MeshLambertMaterial[] = [];
  /** Corner floor lamps (5 per floor), switched by setTimeOfDay(). */
  private lampLights: THREE.PointLight[] = [];
  private lampBulbs: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private spots: Spot[] = [];
  private G: Record<FloorNo, Record<string, GNode>> = { 1: {}, 2: {} };
  private mats = new Map<string, THREE.MeshLambertMaterial>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private rnd = mulberry32(11);
  private woodCanvas: HTMLCanvasElement;
  private GLASS: THREE.MeshLambertMaterial;
  private HIT = new THREE.MeshBasicMaterial({ visible: false });
  private tmpQ = new THREE.Quaternion();

  private agents: Agent3D[] = [];
  private byId = new Map<string, Agent3D>();
  private selected: Agent3D | null = null;
  /** focus() before the agent's first state push: applied when it is added. */
  private pendingFocus: string | null = null;
  private showLabels = true;
  private mode: Mode = "all";
  private f2Target = new THREE.Vector3(0, 11.2, -3);
  private tween: { ft: THREE.Vector3; fp: THREE.Vector3; tt: THREE.Vector3; tp: THREE.Vector3; k: number } | null = null;
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

  // DOM: roster + detail panel (the reference's right-hand panel), owned by the scene.
  private ui: { root: HTMLElement; toggle: HTMLButtonElement; title: HTMLElement; tally: HTMLElement; list: HTMLUListElement; detail: HTMLElement; dl: HTMLDListElement; dName: HTMLElement };
  private sidebarOpen = readSidebarOpen();
  /** Roster face icons (data URLs), keyed by everything that changes the drawing. */
  private faces = new Map<string, string>();

  constructor(private host: HTMLElement, opts: SceneOptions = {}) {
    this.opts = opts;
    this.reduce = !!opts.reducedMotion;
    this.prevColorManagement = THREE.ColorManagement.enabled;
    THREE.ColorManagement.enabled = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);

    this.camera.position.set(12, 30, 40);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47; this.controls.minDistance = 7; this.controls.maxDistance = 150;
    this.controls.addEventListener("start", this.onControlsStart);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa9b8a0, 0.72 * Math.PI);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff3dd, 0.62 * Math.PI));
    sun.position.set(-16, 34, 20); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 110 });
    sun.shadow.bias = -0.0006; sun.shadow.radius = 2;
    this.scene.add(sun);

    this.GLASS = this.M(0xa9d8ec, { transparent: true, opacity: 0.35 });
    this.woodCanvas = this.makeWoodCanvas();
    this.scene.add(this.world, this.F1, this.F2);
    this.floors = { 1: this.F1, 2: this.F2 };
    this.buildF1();
    this.buildF2();
    this.buildWorld();

    this.ui = this.buildPanel();
    this.applyTheme();
    this.F2.position.copy(this.f2Target);
    const v = this.viewFor("all");
    this.controls.target.copy(v.t); this.camera.position.copy(v.p);
    this.setMode("all", true);

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
  get activePreset(): Preset { return MODE_PRESET[this.mode]; }
  /** [floor 1 visible, floor 2 visible]. */
  get visibleFloors(): [boolean, boolean] { return [true, this.F2.visible]; }
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
    if (meta.color && meta.color !== d.color) { d.color = meta.color; a.shirt.color.set(meta.color); changed = true; }
    if (STATUS[status] && status !== prev) {
      d.status = status; a.since = Date.now(); a.lightMat.color.set(STATUS[status].color);
      if (a.orb) { this.applyOrb(a); this.deskGlow(a); } else this.go(a, this.pickSpot(a));
      changed = true;
    }
    if (changed) this.drawTag(a);
    this.dirty = true;
  }

  /** Claude Code CLI (a tool, not a Hermes profile) as an extra agent with its own desk. */
  setRobotState(state: ToolStatus, label: string) {
    const status: AgentStatus = state === "working" ? "working" : state === "idle" ? "idle" : "offline";
    this.setAgentState(CLAUDE_AGENT_ID, status, "Claude Code CLI", label, { role: "Coding tool", color: CLAUDE_COLOR, desk: 4 });
  }

  /** Remove every agent whose id is not in `ids` (e.g. a profile that disappeared from the API). */
  retainAgents(ids: Iterable<string>) {
    const keep = new Set(ids);
    for (const a of [...this.agents]) if (!keep.has(a.data.id)) this.removeAgent(a);
  }
  agentIds(): string[] { return this.agents.map((a) => a.data.id); }

  preset(p: Preset) { this.setMode(PRESET_MODE[p] ?? "all"); }
  focus(id: string) {
    if (this.byId.has(id)) { this.pendingFocus = null; this.select(id); } else this.pendingFocus = id;
  }
  setLabels(on: boolean) { this.showLabels = on; this.applyLabels(); }

  setTimeOfDay(tod: TimeOfDay, _opts?: { instant?: boolean }) { this.tod = tod; this.applyTheme(); }

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
      if (m.isMesh || (o as THREE.Sprite).isSprite) {
        if (m.isMesh) kill(m.geometry);
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => { kill((x as THREE.MeshBasicMaterial).map); kill(x); });
      }
    });
    this.geos.forEach(kill); this.mats.forEach(kill); kill(this.HIT);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    c.remove();
    this.ui.root.remove(); this.ui.toggle.remove();
    THREE.ColorManagement.enabled = this.prevColorManagement;
  }

  // ================================================================== primitives
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
  private cyl(p: THREE.Object3D, rt: number, rb: number, h: number, x: number, y: number, z: number, c: Col, seg = 10) {
    const m = new THREE.Mesh(this.geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), this.asMat(c));
    m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
  }
  private ico(p: THREE.Object3D, r: number, x: number, y: number, z: number, c: Col) {
    const m = new THREE.Mesh(this.geo(`i${r}`, () => new THREE.IcosahedronGeometry(r, 0)), this.asMat(c));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
  }
  private plane(p: THREE.Object3D, w: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; p.add(m); return m;
  }
  private grp(p: THREE.Object3D, x: number, z: number, rot = 0, y = 0) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; p.add(g); return g;
  }
  private glow(c: number) { return new THREE.MeshBasicMaterial({ color: c }); }

  private makeWoodCanvas() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const x = c.getContext("2d")!, rnd = this.rnd;
    const tones = ["#c68d58", "#bd8450", "#cb945f", "#b97f4b", "#c28a54"];
    for (let r = 0; r < 8; r++) {
      let px = -Math.floor(rnd() * 90);
      while (px < 256) {
        const w = 70 + Math.floor(rnd() * 80);
        x.fillStyle = tones[Math.floor(rnd() * tones.length)]; x.fillRect(px, r * 32, w, 32);
        x.fillStyle = "rgba(90,55,25,.35)"; x.fillRect(px + w - 1, r * 32, 1.5, 32); px += w;
      }
      x.fillStyle = "rgba(90,55,25,.3)"; x.fillRect(0, r * 32, 256, 1.5);
    }
    return c;
  }
  /** Canvas-drawn wood grain floor material (reference woodMat()). */
  private woodMat(rx: number, rz: number) {
    const t = new THREE.CanvasTexture(this.woodCanvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz);
    return new THREE.MeshLambertMaterial({ map: t });
  }
  private textSprite(w: number, h: number, sx: number, sy: number): Sprite2D {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(sx, sy, 1); sp.renderOrder = 20;
    return { c, tex, sp };
  }
  private roomLabel(F: THREE.Group, text: string, x: number, z: number, y = 2.5) {
    const s = this.textSprite(384, 72, 3.6, 0.675), g = s.c.getContext("2d")!;
    g.font = "600 30px " + FONT;
    const tw = g.measureText(text).width + 44;
    g.fillStyle = "rgba(255,255,255,.8)"; rr(g, (384 - tw) / 2, 10, tw, 52, 26); g.fill();
    g.fillStyle = "#1d2933"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 192, 37);
    s.tex.needsUpdate = true; s.sp.position.set(x, y, z); s.sp.userData.floor = F === this.F1 ? 1 : 2; F.add(s.sp); this.labels.push(s.sp);
  }

  // ================================================================== architecture
  private makeWall(F: THREE.Group, side: "N" | "S" | "W" | "E", H: number, y0: number, gaps: number[][] = []): Wall {
    const cfg = { N: [0, -6.125, 0, 24.5, 0, -1], S: [0, 6.125, Math.PI, 24.5, 0, 1], W: [-12.125, 0, Math.PI / 2, 12, -1, 0], E: [12.125, 0, -Math.PI / 2, 12, 1, 0] }[side];
    const tall = this.grp(F, cfg[0], cfg[1], cfg[2]), low = this.grp(F, cfg[0], cfg[1], cfg[2]);
    const L = cfg[3], cuts = [-L / 2];
    gaps.forEach((g) => cuts.push(g[0], g[1])); cuts.push(L / 2);
    for (let i = 0; i < cuts.length; i += 2) {
      const a = cuts[i], b = cuts[i + 1]; if (b - a < 0.01) continue;
      this.box(tall, b - a, H - y0, 0.25, (a + b) / 2, y0, 0, C.wall); this.box(low, b - a, 0.5 - y0, 0.25, (a + b) / 2, y0, 0, C.wall);
    }
    gaps.forEach((g) => this.box(tall, g[1] - g[0], H - 2.1, 0.25, (g[0] + g[1]) / 2, 2.1, 0, C.wall));
    const w = { tall, low, nx: cfg[4], nz: cfg[5] }; this.walls.push(w); return w;
  }
  private win(wg: THREE.Group, lx: number, y: number, w: number, h: number) {
    this.box(wg, w + 0.16, h + 0.16, 0.3, lx, y - 0.08, 0, C.white); this.box(wg, w, h, 0.33, lx, y, 0, C.glassSolid); this.box(wg, 0.05, h, 0.35, lx, y, 0, C.white);
  }
  private ac(wg: THREE.Group, lx: number) { this.box(wg, 1.0, 0.3, 0.24, lx, 2.4, 0.24, C.white); this.box(wg, 0.8, 0.03, 0.02, lx, 2.44, 0.365, 0xc9c9c4); }
  private tv(wg: THREE.Group, lx: number, y: number, w: number, h: number) {
    this.box(wg, w + 0.1, h + 0.1, 0.07, lx, y - 0.05, 0.16, C.metal);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.glow(0x58b6e8)); m.position.set(lx, y + h / 2, 0.2); wg.add(m);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.5, h * 0.12), this.glow(0xd9f1ff)); b.position.set(lx - w * 0.15, y + h * 0.7, 0.202); wg.add(b);
    const b2 = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.08), this.glow(0x8fd0f2)); b2.position.set(lx - w * 0.05, y + h * 0.45, 0.202); wg.add(b2);
    const bx = lx - w * 0.05;
    this.animators.push((_dt, t) => { b2.position.x = bx + Math.sin(t * 0.7 + bx) * w * 0.08; b2.scale.x = 0.7 + Math.sin(t * 1.3 + bx) * 0.3; });
  }
  private part(F: THREE.Group, x1: number, z1: number, x2: number, z2: number, h = 1.3, c: Col = C.part) {
    const hz = Math.abs(x2 - x1) > Math.abs(z2 - z1), len = hz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    return this.box(F, hz ? len : 0.14, h, hz ? 0.14 : len, (x1 + x2) / 2, 0, (z1 + z2) / 2, c);
  }
  private glassPart(F: THREE.Group, x1: number, z1: number, x2: number, z2: number) {
    const hz = Math.abs(x2 - x1) > Math.abs(z2 - z1), len = hz ? Math.abs(x2 - x1) : Math.abs(z2 - z1), cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    this.box(F, hz ? len : 0.12, 0.2, hz ? 0.12 : len, cx, 0, cz, C.metal); this.box(F, hz ? len : 0.05, 1.7, hz ? 0.05 : len, cx, 0.2, cz, this.GLASS);
    this.box(F, hz ? len : 0.1, 0.07, hz ? 0.1 : len, cx, 1.9, cz, C.metal);
  }
  private rail(F: THREE.Group, x1: number, z1: number, x2: number, z2: number, h = 0.95) {
    const hz = Math.abs(x2 - x1) > Math.abs(z2 - z1), len = hz ? Math.abs(x2 - x1) : Math.abs(z2 - z1), cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    this.box(F, hz ? len : 0.07, 0.06, hz ? 0.07 : len, cx, h, cz, C.metal);
    const n = Math.max(1, Math.round(len / 1.3));
    for (let i = 0; i <= n; i++) { const k = i / n; this.box(F, 0.06, h, 0.06, x1 + (x2 - x1) * k, 0, z1 + (z2 - z1) * k, C.metal); }
    this.box(F, hz ? len : 0.03, h - 0.22, hz ? 0.03 : len, cx, 0.12, cz, this.GLASS);
  }

  // ================================================================== furniture
  private desk(F: THREE.Group, x: number, z: number) {
    const g = this.grp(F, x, z, 0);
    this.box(g, 1.5, 0.06, 0.75, 0, 0.69, 0, C.deskTop);
    [[-0.68, -0.3], [0.68, -0.3], [-0.68, 0.3], [0.68, 0.3]].forEach((p) => this.box(g, 0.06, 0.69, 0.06, p[0], 0, p[1], C.metal));
    this.box(g, 0.26, 0.02, 0.16, 0, 0.75, -0.18, C.metal); this.box(g, 0.05, 0.2, 0.05, 0, 0.77, -0.18, C.metal);
    this.box(g, 0.74, 0.44, 0.04, 0, 0.9, -0.16, C.metal);
    const sm = new THREE.MeshLambertMaterial({ color: 0x11161d, emissive: 0x000000 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.38), sm); s.position.set(0, 1.12, -0.137); g.add(s);
    this.box(g, 0.44, 0.02, 0.14, 0, 0.75, 0.16, 0x3d434d); this.box(g, 0.08, 0.02, 0.11, 0.36, 0.75, 0.16, 0x3d434d);
    this.deskScreens.push(sm);
  }
  private chair(F: THREE.Group, x: number, z: number, rot: number, c: Col = 0x30343c) {
    const g = this.grp(F, x, z, rot);
    this.cyl(g, 0.26, 0.26, 0.04, 0, 0, 0, C.metal, 8); this.cyl(g, 0.04, 0.04, 0.34, 0, 0.04, 0, C.metal, 6);
    this.box(g, 0.46, 0.07, 0.46, 0, 0.36, 0, c); this.box(g, 0.44, 0.5, 0.06, 0, 0.45, -0.26, c);
  }
  private sofa(F: THREE.Group, x: number, z: number, rot: number, len: number, c: Col) {
    const g = this.grp(F, x, z, rot);
    this.box(g, len, 0.3, 0.86, 0, 0.12, 0, c); this.box(g, len, 0.5, 0.2, 0, 0.3, -0.33, c);
    this.box(g, 0.16, 0.44, 0.86, -len / 2 + 0.08, 0.16, 0, c); this.box(g, 0.16, 0.44, 0.86, len / 2 - 0.08, 0.16, 0, c);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => this.box(g, 0.08, 0.12, 0.08, s[0] * (len / 2 - 0.1), 0, s[1] * 0.35, C.metal));
  }
  private plant(F: THREE.Group, x: number, z: number, s = 1) {
    const g = this.grp(F, x, z, this.rnd() * 6); g.scale.setScalar(s);
    this.cyl(g, 0.22, 0.16, 0.36, 0, 0, 0, C.white, 8); this.ico(g, 0.36, 0, 0.68, 0, C.leaf); this.ico(g, 0.24, 0.14, 0.98, 0.06, C.leaf2);
  }
  private tree(P: THREE.Group, x: number, z: number, s = 1, alt = 0) {
    const g = this.grp(P, x, z, this.rnd() * 6, -0.15); g.scale.setScalar(s);
    this.cyl(g, 0.18, 0.26, 1.7, 0, 0, 0, C.trunk, 6); this.ico(g, 1.5, 0, 2.7, 0, alt ? C.leaf2 : C.leaf); this.ico(g, 1.0, 0.5, 3.7, 0.25, alt ? C.leaf : C.leaf2);
  }
  private coffeeTable(F: THREE.Group, x: number, z: number, w: number, d: number) {
    this.box(F, w, 0.06, d, x, 0.34, z, C.woodDark);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => this.box(F, 0.06, 0.34, 0.06, x + s[0] * (w / 2 - 0.08), 0, z + s[1] * (d / 2 - 0.08), C.metal));
  }
  private shelf(F: THREE.Group, x: number, z: number, w: number) {
    const g = this.grp(F, x, z, 0), rnd = this.rnd;
    this.box(g, w, 1.95, 0.08, 0, 0, -0.14, C.woodDark); this.box(g, 0.07, 1.95, 0.36, -w / 2 + 0.035, 0, 0, C.woodDark); this.box(g, 0.07, 1.95, 0.36, w / 2 - 0.035, 0, 0, C.woodDark);
    const cols = [0xc9483e, 0x3d6fb4, 0xe2b23c, 0x4f9a6b, 0x8a5cb0, 0xe9e2d2, 0x2f3644, 0xd9773c];
    for (let r = 0; r < 5; r++) {
      this.box(g, w - 0.1, 0.05, 0.34, 0, r * 0.47, 0, C.woodDark); if (r === 4) break;
      let px = -w / 2 + 0.12;
      while (px < w / 2 - 0.3) {
        const bw = 0.1 + rnd() * 0.12, bh = 0.24 + rnd() * 0.14;
        if (rnd() < 0.14) { px += 0.2; continue; }
        this.box(g, bw - 0.015, bh, 0.24, px + bw / 2, r * 0.47 + 0.05, 0.02, cols[Math.floor(rnd() * cols.length)]); px += bw;
      }
    }
  }
  /** Standing corner lamp: base, pole, open cone shade, glowing bulb + a point light (night only). */
  private floorLamp(F: THREE.Group, x: number, z: number) {
    const g = this.grp(F, x, z, 0);
    this.box(g, 0.3, 0.08, 0.3, 0, 0, 0, C.metal);
    this.cyl(g, 0.04, 0.04, 1.6, 0, 0.08, 0, C.metal, 8);
    const shade = new THREE.Mesh(this.geo("lampShade", () => new THREE.CylinderGeometry(0.06, 0.3, 0.3, 16, 1, true)),
      this.M(0xe8d5b0, { side: THREE.DoubleSide }));
    shade.position.y = 1.55; shade.castShadow = true; g.add(shade);
    const bulb = new THREE.Mesh(this.geo("lampBulb", () => new THREE.SphereGeometry(0.08, 12, 8)), new THREE.MeshBasicMaterial({ color: LAMP.bulbDay }));
    bulb.position.y = 1.44; g.add(bulb);
    const light = new THREE.PointLight(LAMP.light, LAMP.dayI * Math.PI, LAMP.dist, LAMP.decay); light.position.y = 1.36; g.add(light);
    this.lampBulbs.push(bulb); this.lampLights.push(light);
  }
  private toilet(F: THREE.Group) {
    this.box(F, 4.4, 0.02, 3.7, 9.8, 0.003, 4.1, C.tile);
    this.part(F, 7.5, 2.2, 12, 2.2, 1.7); this.part(F, 7.5, 2.2, 7.5, 3.2, 1.7); this.part(F, 7.5, 4.3, 7.5, 6, 1.7);
    this.box(F, 0.42, 0.38, 0.55, 11.25, 0, 4.9, C.white); this.box(F, 0.5, 0.06, 0.6, 11.25, 0.38, 4.9, 0xe4e4de); this.box(F, 0.5, 0.55, 0.2, 11.25, 0.3, 5.3, C.white);
    this.box(F, 0.16, 0.7, 0.16, 9.3, 0, 2.5, C.white); this.box(F, 0.7, 0.14, 0.46, 9.3, 0.7, 2.5, C.white); this.box(F, 0.5, 0.03, 0.3, 9.3, 0.82, 2.5, 0xbfd9e2);
    this.box(F, 0.6, 0.55, 0.03, 9.3, 1.05, 2.29, 0xbfe3ef);
    this.box(F, 0.3, 0.4, 0.3, 11.5, 0, 2.6, 0x8f9aa3);
  }
  private stool(F: THREE.Group, x: number, z: number) {
    this.cyl(F, 0.2, 0.2, 0.05, x, 0.57, z, C.woodDark, 10); this.cyl(F, 0.03, 0.03, 0.57, x, 0, z, C.metal, 6); this.cyl(F, 0.18, 0.2, 0.03, x, 0, z, C.metal, 10);
  }
  private bunk(F: THREE.Group, x: number, z: number) {
    const g = this.grp(F, x, z, 0);
    [[-0.58, -1.08], [0.58, -1.08], [-0.58, 1.08], [0.58, 1.08]].forEach((p) => this.box(g, 0.09, 1.95, 0.09, p[0], 0, p[1], C.woodDark));
    [0.26, 1.31].forEach((y, i) => {
      this.box(g, 1.2, 0.12, 2.2, 0, y, 0, C.woodDark); this.box(g, 1.1, 0.14, 2.08, 0, y + 0.12, 0, C.white);
      this.box(g, 0.7, 0.1, 0.4, 0, y + 0.26, -0.78, 0xe9eef5); this.box(g, 1.12, 0.06, 1.1, 0, y + 0.26, 0.48, i ? 0x5e9c7a : 0x4f6fa8);
    });
    this.box(g, 1.2, 0.3, 0.06, 0, 1.6, -1.08, C.woodDark);
    this.box(g, 0.05, 1.5, 0.05, 0.34, 0, 1.17, C.metal); this.box(g, 0.05, 1.5, 0.05, 0.62, 0, 1.17, C.metal);
    [0.35, 0.7, 1.05].forEach((y) => this.box(g, 0.3, 0.04, 0.05, 0.48, y, 1.17, C.metal));
  }

  // ================================================================== path graph + spots
  private node(f: FloorNo, id: string, x: number, z: number) { this.G[f][id] = { id, x, z, adj: [] }; }
  private link(f: FloorNo, ...ids: string[]) {
    for (let i = 0; i < ids.length - 1; i++) { const a = this.G[f][ids[i]], b = this.G[f][ids[i + 1]]; a.adj.push(b.id); b.adj.push(a.id); }
  }
  /** Dijkstra over the floor's walk graph (reference route()). */
  private route(f: FloorNo, a: string, b: string): GNode[] {
    const g = this.G[f];
    if (!g[a] || !g[b]) return [];
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
  private spot(floor: FloorNo, room: string, use: string | string[], x: number, z: number, rot: number, pose: Pose, nd: string, o: { y?: number; pri?: number } = {}) {
    const s: Spot = { id: "s" + this.spots.length, floor, room, use: ([] as string[]).concat(use), x, z, rot, pose, node: nd, y: o.y || 0, pri: o.pri || 0, by: null };
    this.spots.push(s); return s;
  }

  // ================================================================== Lantai 1
  private buildF1() {
    const F = this.F1;
    this.box(F, 24, 0.15, 12, 0, -0.15, 0, C.slab); this.plane(F, 24, 12, 0, 0.002, 0, this.woodMat(8, 4));
    const wn = this.makeWall(F, "N", 3.0, -0.15), ww = this.makeWall(F, "W", 3.0, -0.15), we = this.makeWall(F, "E", 3.0, -0.15);
    this.makeWall(F, "S", 3.0, -0.15, [[-6.5, -5]]);
    this.win(wn.tall, -10, 1.3, 1.9, 1.0); this.win(wn.tall, -6.8, 1.3, 1.9, 1.0); this.win(wn.tall, -3.4, 1.3, 1.5, 1.0); this.ac(wn.tall, -8.4);
    const ck = this.cyl(wn.tall, 0.22, 0.22, 0.05, -5.05, 2.2, 0.15, C.white, 16); ck.rotation.x = Math.PI / 2;
    const clk = this.grp(wn.tall, -5.05, 0.19, 0, 2.225), hh = new THREE.Group(), mh = new THREE.Group(); clk.add(hh); clk.add(mh);
    this.box(hh, 0.03, 0.11, 0.02, 0, 0, 0, C.metal); this.box(mh, 0.02, 0.16, 0.02, 0, 0, 0, C.metal);
    this.animators.push(() => {
      const d = new Date();
      hh.rotation.z = -((d.getHours() % 12) / 12 + d.getMinutes() / 720) * Math.PI * 2;
      mh.rotation.z = -(d.getMinutes() / 60 + d.getSeconds() / 3600) * Math.PI * 2;
    });
    this.tv(wn.tall, 2.5, 1.0, 2.2, 1.2); this.win(wn.tall, 0.2, 1.3, 1.1, 1.0); this.win(wn.tall, 4.9, 1.3, 1.1, 1.0); this.ac(wn.tall, 2.5);
    this.win(wn.tall, 8.3, 1.5, 1.5, 0.9); this.win(wn.tall, 10.2, 1.5, 1.5, 0.9);
    this.tv(ww.tall, -3.3, 1.0, 2.0, 1.1); this.win(ww.tall, 3.2, 1.3, 1.8, 1.0);
    this.win(we.tall, -2.6, 1.3, 1.8, 1.0); this.win(we.tall, 4.1, 1.8, 0.9, 0.5);

    /* ruang kerja: 2 rows x 5 desks (reference has 4 per row; widened to 10 so the 4 Hermes agents,
       Claude Code CLI and the 4 OpenClaw agents each get their own desk, plus one spare). */
    const cols = [-10.6, -8.75, -6.9, -5.05, -3.2];
    [-4.0, -1.0].forEach((rz) => cols.forEach((x) => { this.desk(F, x, rz - 0.62); this.chair(F, x, rz, N); }));
    cols.forEach((x, i) => { this.node(1, "wa" + i, x, -3.1); this.node(1, "wb" + i, x, -0.15); });
    this.node(1, "wae", -1.9, -3.1); this.node(1, "wbe", -1.9, -0.15);
    this.link(1, ...cols.map((_, i) => "wa" + i), "wae"); this.link(1, ...cols.map((_, i) => "wb" + i), "wbe"); this.link(1, "wae", "wbe");
    cols.forEach((x, i) => this.spot(1, "Ruang Kerja", "desk", x, -4.0, N, "type", "wa" + i));
    cols.forEach((x, i) => this.spot(1, "Ruang Kerja", "desk", x, -1.0, N, "type", "wb" + i));
    this.plant(F, -11.5, -5.5, 1.05); this.plant(F, -1.6, -5.4, 1.1);
    this.box(F, 0.5, 0.9, 1.4, -11.75, 0, -2.6, 0xd9d3c4); this.box(F, 0.34, 0.3, 0.34, -11.75, 0.9, -2.9, 0x3d434d);
    this.roomLabel(F, "Ruang Kerja", -6.8, -5.2, 3.0);

    /* ruang meeting */
    this.box(F, 6.86, 0.02, 5.36, -8.5, 0.003, 3.25, C.carpetRed);
    this.part(F, -12, 0.5, -5, 0.5); this.glassPart(F, -5, 0.5, -5, 2.5); this.glassPart(F, -5, 3.7, -5, 6);
    this.box(F, 3.6, 0.07, 1.3, -8.6, 0.67, 3.3, C.woodDark); this.box(F, 0.5, 0.67, 0.5, -9.8, 0, 3.3, C.metal); this.box(F, 0.5, 0.67, 0.5, -7.4, 0, 3.3, C.metal);
    this.box(F, 0.3, 0.02, 0.22, -8.2, 0.74, 3.2, 0xf2e36b);
    [-9.8, -8.6, -7.4].forEach((x) => { this.chair(F, x, 2.2, S); this.chair(F, x, 4.4, N); });
    this.node(1, "Min", -5.8, 3.1); this.node(1, "Mout", -4.2, 3.1); this.node(1, "Mn", -6.2, 1.35); this.node(1, "MnA", -8.6, 1.35);
    this.node(1, "Mw", -11.1, 1.35); this.node(1, "Ms", -6.2, 5.3); this.node(1, "MsA", -8.6, 5.3);
    this.link(1, "Mout", "Min", "Mn", "MnA", "Mw"); this.link(1, "Min", "Ms", "MsA");
    [-9.8, -8.6, -7.4].forEach((x) => { this.spot(1, "Ruang Meeting", "meeting", x, 2.2, S, "sit", "MnA"); this.spot(1, "Ruang Meeting", "meeting", x, 4.4, N, "sit", "MsA"); });
    this.spot(1, "Ruang Meeting", "meeting", -11.1, 3.3, E, "stand", "Mw", { pri: 1 }); this.spot(1, "Ruang Meeting", "meeting", -6.0, 4.3, W, "stand", "Min", { pri: 1 });
    this.plant(F, -5.6, 5.5);
    this.roomLabel(F, "Ruang Meeting", -8.6, 3.3);

    /* ruang tamu */
    this.part(F, -1, -6, -1, -1.5);
    this.box(F, 5.0, 0.02, 3.3, 2.5, 0.003, -3.3, C.rug);
    this.sofa(F, 2.5, -1.5, N, 2.7, C.sofaBlue); this.sofa(F, 0.0, -4.2, E, 0.95, C.sofaOrange); this.sofa(F, 5.0, -4.2, W, 0.95, C.sofaBlue);
    this.coffeeTable(F, 2.5, -3.4, 1.2, 0.6); this.box(F, 0.16, 0.14, 0.16, 2.3, 0.4, -3.4, C.white);
    this.box(F, 2.4, 0.45, 0.42, 2.5, 0, -5.75, C.woodDark); this.plant(F, 5.4, -5.4, 1.1);
    // fish tank + animated fish
    this.box(F, 1.5, 0.72, 0.5, 2.5, 0.45, -5.75, this.GLASS); this.box(F, 1.44, 0.08, 0.44, 2.5, 0.46, -5.75, 0xd9c9a0);
    this.box(F, 1.44, 0.5, 0.44, 2.5, 0.54, -5.75, 0x3fa6d8, { transparent: true, opacity: 0.3 });
    this.ico(F, 0.1, 2.0, 0.6, -5.75, 0x5e9c7a); this.ico(F, 0.08, 2.95, 0.58, -5.72, 0x5e9c7a);
    ([[0xe4572e, 0.5, 0], [0xe2a91a, 0.75, 2], [0x3d7fd9, 0.6, 4]] as const).forEach((f) => {
      const fg = this.grp(F, 2.5, -5.75, 0, 0.8);
      this.box(fg, 0.14, 0.08, 0.05, 0, -0.04, 0, f[0]); this.box(fg, 0.06, 0.08, 0.03, -0.09, -0.04, 0, f[0]);
      this.animators.push((_dt, t) => {
        fg.position.x = 2.5 + Math.sin(t * f[1] + f[2]) * 0.55; fg.position.y = 0.8 + Math.sin(t * f[1] * 2.3 + f[2]) * 0.12;
        fg.rotation.y = Math.cos(t * f[1] + f[2]) > 0 ? 0 : Math.PI;
      });
    });
    this.node(1, "hubW", -3, 1.3); this.node(1, "hubC", 2, 1.3); this.node(1, "hubE", 6.5, 1.3); this.link(1, "hubW", "hubC", "hubE"); this.link(1, "wbe", "hubW", "Mout");
    this.node(1, "Tw", 0.4, -0.3); this.node(1, "Tw2", 0.4, -2.6); this.node(1, "Tin", 2.5, -2.6); this.node(1, "Te", 4.5, -2.6); this.link(1, "hubC", "Tw", "Tw2", "Tin", "Te");
    [1.7, 2.5, 3.3].forEach((x) => this.spot(1, "Ruang Tamu", "waiting", x, -1.56, N, "sit", "Tin"));
    this.spot(1, "Ruang Tamu", "waiting", 0.06, -4.2, E, "sit", "Tw2"); this.spot(1, "Ruang Tamu", "waiting", 4.94, -4.2, W, "sit", "Te");
    this.spot(1, "Ruang Tamu", "waiting", 4.7, -0.4, N, "stand", "hubC", { pri: 1 }); this.spot(1, "Ruang Tamu", "waiting", 5.3, -2.6, W, "stand", "Te", { pri: 1 });
    this.spot(1, "Ruang Tamu", "waiting", -0.3, -2.6, E, "stand", "Tw2", { pri: 1 });
    this.roomLabel(F, "Ruang Tamu", 2.5, -3.4);

    /* island hangout */
    this.part(F, 6, -6, 6, -2.5);
    this.box(F, 5.93, 0.02, 7, 9.035, 0.003, -2.5, C.kitchen);
    this.box(F, 4.2, 0.86, 0.6, 8.9, 0, -5.7, C.white); this.box(F, 4.3, 0.06, 0.66, 8.9, 0.86, -5.7, C.woodDark);
    this.box(F, 0.8, 1.8, 0.7, 11.55, 0, -5.6, 0xc9d1d6); this.box(F, 0.04, 0.5, 0.04, 11.22, 0.9, -5.23, C.metal);
    this.box(F, 0.34, 0.4, 0.3, 7.6, 0.92, -5.7, C.metal);
    for (let i = 0; i < 3; i++) { // coffee machine steam
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
      const st = new THREE.Mesh(this.geo("i0.05", () => new THREE.IcosahedronGeometry(0.05, 0)), mat); F.add(st);
      this.animators.push((_dt, t) => {
        const f = (t * 0.35 + i / 3) % 1;
        st.position.set(7.6 + Math.sin(t * 2 + i) * 0.05, 1.36 + f * 0.55, -5.7); mat.opacity = 0.55 * (1 - f); st.scale.setScalar(0.7 + f);
      });
    }
    this.box(F, 0.1, 0.12, 0.1, 8.1, 0.92, -5.65, C.white); this.box(F, 0.1, 0.12, 0.1, 8.3, 0.92, -5.75, 0xc9483e);
    this.box(F, 0.7, 0.04, 0.4, 9.9, 0.92, -5.7, 0xaab4ba);
    this.box(F, 3.0, 0.88, 1.0, 9, 0, -2.5, 0x4b5d6b); this.box(F, 3.3, 0.07, 1.3, 9, 0.88, -2.5, C.white);
    this.box(F, 0.3, 0.06, 0.3, 8.4, 0.95, -2.5, 0xe2b23c); this.box(F, 0.12, 0.14, 0.12, 9.6, 0.95, -2.4, C.white);
    [8, 9, 10].forEach((x) => {
      this.stool(F, x, -1.5);
      const lg = this.grp(F, x, -2.5, 0); this.box(lg, 0.02, 0.75, 0.02, 0, 2.25, 0, C.metal); this.cyl(lg, 0.08, 0.26, 0.24, 0, 2.02, 0, 0xe2b23c, 8);
    });
    this.node(1, "Is", 9, -0.7); this.node(1, "Iw", 6.9, -0.7); this.node(1, "Iw2", 6.9, -3.7); this.link(1, "hubE", "Is", "Iw", "Iw2"); this.link(1, "hubE", "Iw");
    [8, 9, 10].forEach((x) => this.spot(1, "Island Hangout", "idle", x, -1.5, N, "sit", "Is", { y: 0.17 }));
    this.spot(1, "Island Hangout", "idle", 8.3, -3.7, S, "lean", "Iw2", { pri: 1 }); this.spot(1, "Island Hangout", "idle", 9.7, -3.7, S, "lean", "Iw2", { pri: 1 });
    this.plant(F, 11.4, 0.4, 1.1);
    this.roomLabel(F, "Island Hangout", 9, -2.6);

    /* toilet */
    this.toilet(F); this.roomLabel(F, "Toilet", 9.8, 4.2, 2.2);
    this.node(1, "WCo", 6.7, 3.75); this.link(1, "hubE", "WCo");

    /* tangga */
    const steps = 12, run = 0.33, rise = 3.2 / steps;
    for (let i = 0; i < steps; i++) this.box(F, run + 0.03, 0.08, 2.0, 4.0 - (i + 0.5) * run, (i + 1) * rise - 0.08, 3.75, C.wood);
    const ang = -Math.atan2(3.2, 3.96);
    [2.78, 4.72].forEach((z) => {
      const s = this.box(F, 5.2, 0.22, 0.08, 2.02, 1.3, z, C.woodDark); s.rotation.z = ang;
      const h = this.box(F, 5.2, 0.06, 0.06, 2.02, 2.42, z, C.metal); h.rotation.z = ang;
      for (let k = 0; k < 5; k++) { const px = 3.8 - k * 0.9, py = ((4.0 - px) / 3.96) * 3.2; this.box(F, 0.05, 0.9, 0.05, px, py, z, C.metal); }
    });
    this.plant(F, 0.7, 5.35); this.plant(F, 1.6, 5.4, 0.9); this.plant(F, 2.5, 5.35);
    this.box(F, 1.3, 0.03, 0.7, 5.75, 0.003, 5.4, 0x6b5a48);
    this.node(1, "S1", 4.8, 3.75); this.link(1, "hubE", "S1", "WCo");

    /* corner lamps (nudged off the plants, partitions and the toilet from the nominal corners) */
    this.floorLamp(F, -10.85, -5.65); // Ruang Kerja, back-left
    this.floorLamp(F, 5.7, -3.3);     // Ruang Tamu, right side (back-right corner holds a plant)
    this.floorLamp(F, -10.5, 5.5);    // front-left
    this.floorLamp(F, 11.6, -1.3);    // Island Hangout, right side
    this.floorLamp(F, -11.65, 0.0);   // left side mid, just north of the meeting-room partition
  }

  // ================================================================== Lantai 2
  private buildF2() {
    const F = this.F2;
    [[-12, 0, -6, 6], [4.2, 12, -6, 6], [0, 4.2, -6, 2.6], [0, 4.2, 4.9, 6]].forEach((r) => {
      const w = r[1] - r[0], d = r[3] - r[2], cx = (r[0] + r[1]) / 2, cz = (r[2] + r[3]) / 2;
      this.box(F, w, 0.2, d, cx, -0.2, cz, C.slab); this.plane(F, w, d, cx, 0.002, cz, this.woodMat(w / 3, d / 3));
    });
    const H = 2.8;
    const wn = this.makeWall(F, "N", H, -0.2), ww = this.makeWall(F, "W", H, -0.2), we = this.makeWall(F, "E", H, -0.2);
    this.makeWall(F, "S", H, -0.2, [[5.6, 7]]);
    this.win(wn.tall, -10.3, 1.2, 1.7, 1.0); this.win(wn.tall, -7.1, 1.2, 1.7, 1.0); this.ac(wn.tall, -8.7); this.ac(wn.tall, -1);
    this.win(wn.tall, 7.6, 1.3, 1.6, 1.0); this.win(wn.tall, 10.3, 1.3, 1.6, 1.0);
    this.win(ww.tall, -3.0, 1.1, 2.2, 1.1); this.win(ww.tall, 3.2, 1.2, 1.4, 1.0);
    this.tv(we.tall, -4.3, 1.0, 1.9, 1.05); this.win(we.tall, -0.9, 1.2, 1.4, 1.0); this.win(we.tall, 4.1, 1.7, 0.9, 0.5);

    /* pembatas bukaan tangga */
    this.rail(F, 0, 2.6, 4.2, 2.6); this.rail(F, 0, 4.9, 4.2, 4.9); this.rail(F, 4.2, 2.6, 4.2, 4.9);
    this.node(2, "S2", -0.8, 3.75); this.node(2, "h2a", -4.7, 1.3); this.node(2, "h2b", -0.8, 1.3); this.node(2, "h2c", 5, 1.3);
    this.link(2, "h2a", "h2b", "h2c"); this.link(2, "S2", "h2b");
    this.plant(F, -0.5, 5.4, 1.1); this.plant(F, 4.9, 5.4); this.box(F, 1.6, 0.42, 0.5, 6.2, 0, 5.55, C.woodDark);
    this.box(F, 0.4, 1.0, 0.4, 7.0, 0, 1.9, C.white); this.cyl(F, 0.15, 0.15, 0.34, 7.0, 1.0, 1.9, 0x8fc7e8, 10);

    /* kamar tidur */
    this.box(F, 6.43, 0.02, 5.93, -8.79, 0.003, -3.04, C.bedCarpet);
    this.part(F, -12, 0, -5.5, 0, 1.5); this.part(F, -5.5, -6, -5.5, -1.6, 1.5); this.part(F, -5.5, -0.4, -5.5, 0, 1.5);
    const bx = [-11.1, -9.55, -8.0, -6.45];
    bx.forEach((x, i) => { this.bunk(F, x, -4.8); this.node(2, "bd" + i, x, -3.0); });
    this.link(2, "bd0", "bd1", "bd2", "bd3"); this.node(2, "Bin", -6.3, -1.0); this.node(2, "Bout", -4.7, -1.0); this.link(2, "bd3", "Bin", "Bout", "h2a");
    bx.forEach((x, i) => this.spot(2, "Kamar Tidur", "sleep", x, -4.15, S, "lie", "bd" + i, { y: 0.69 }));
    bx.forEach((x, i) => this.spot(2, "Kamar Tidur", "sleep", x, -4.15, S, "lie", "bd" + i, { y: 1.74, pri: 1 }));
    this.box(F, 0.6, 1.9, 1.7, -11.62, 0, -1.2, C.woodDark); this.box(F, 0.03, 1.7, 0.03, -11.3, 0.1, -1.2, C.metal);
    this.cyl(F, 0.05, 0.14, 0.9, -5.95, 0, -2.3, C.metal, 8); this.cyl(F, 0.12, 0.22, 0.26, -5.95, 0.9, -2.3, 0xf2e3a8, 8);
    this.roomLabel(F, "Kamar Tidur", -8.8, -3.2, 2.9);

    /* sofa baca */
    this.box(F, 5.4, 0.02, 3.6, -1.3, 0.003, -3.2, C.rugWarm);
    this.shelf(F, -3.6, -5.78, 2.4); this.shelf(F, -1.1, -5.78, 2.4); this.shelf(F, 1.4, -5.78, 2.4);
    this.sofa(F, -4.8, -3.2, E, 2.4, C.sofaGreen); this.sofa(F, 1.9, -2.2, W, 0.95, C.sofaOrange); this.sofa(F, 1.9, -4.2, W, 0.95, C.sofaOrange);
    this.coffeeTable(F, -1.4, -3.2, 1.4, 0.8); this.box(F, 0.3, 0.05, 0.22, -1.6, 0.4, -3.1, 0xc9483e); this.box(F, 0.28, 0.05, 0.2, -1.57, 0.45, -3.12, 0x3d6fb4);
    this.cyl(F, 0.03, 0.03, 1.5, -5.05, 0, -4.85, C.metal, 6); this.cyl(F, 0.14, 0.24, 0.3, -5.05, 1.5, -4.85, 0xf2e3a8, 8); this.cyl(F, 0.2, 0.2, 0.04, -5.05, 0, -4.85, C.metal, 8);
    this.node(2, "R1", -3.3, -1.0); this.node(2, "R2", -3.3, -3.2); this.node(2, "R3", 0.6, -1.0); this.node(2, "R4", 0.6, -3.2);
    this.link(2, "h2a", "R1", "R2"); this.link(2, "h2b", "R1", "R3", "R4"); this.link(2, "h2b", "R3"); this.link(2, "Bout", "R1");
    this.spot(2, "Sofa Baca", "idle", -4.74, -3.8, E, "read", "R2"); this.spot(2, "Sofa Baca", "idle", -4.74, -2.6, E, "read", "R2");
    this.spot(2, "Sofa Baca", "idle", 1.84, -2.2, W, "read", "R4"); this.spot(2, "Sofa Baca", "idle", 1.84, -4.2, W, "read", "R4");
    this.roomLabel(F, "Sofa Baca", -1.3, -3.3);

    /* ruang game */
    this.part(F, 3.5, -6, 3.5, -2);
    this.box(F, 8.43, 0.02, 6.93, 7.79, 0.003, -2.54, C.navy);
    this.box(F, 2.7, 0.06, 1.5, 8.3, 0.7, -1.2, 0x2d6fb5); this.box(F, 2.7, 0.065, 0.03, 8.3, 0.7, -1.2, C.white); this.box(F, 0.03, 0.16, 1.6, 8.3, 0.76, -1.2, 0xf5f4ef);
    [[-1.1, -0.55], [1.1, -0.55], [-1.1, 0.55], [1.1, 0.55]].forEach((p) => this.box(F, 0.07, 0.7, 0.07, 8.3 + p[0], 0, -1.2 + p[1], C.metal));
    ([[4.6, 0xc9483e], [5.6, 0x3d6fb4]] as const).forEach((a) => { // arcade cabinets
      const g = this.grp(F, a[0], -5.5, 0);
      this.box(g, 0.75, 1.75, 0.7, 0, 0, 0, a[1]); this.box(g, 0.75, 0.12, 0.3, 0, 0.85, 0.45, C.metal);
      const mat = this.glow(0x7de0c0), s = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), mat); s.position.set(0, 1.3, 0.352); g.add(s);
      const k = a[0];
      this.animators.push((_dt, t) => { mat.color.setHSL(0.43 + Math.sin(t * 0.9 + k) * 0.06, 0.7, 0.55 + (Math.sin(t * 11 + k) > 0.8 ? 0.12 : 0)); });
      this.box(g, 0.75, 0.2, 0.72, 0, 1.6, 0.02, 0xf2e36b);
    });
    this.sofa(F, 9.6, -4.3, E, 2.2, C.sofaBlue); this.box(F, 0.42, 0.4, 2.0, 11.72, 0, -4.3, C.woodDark); this.box(F, 0.3, 0.08, 0.4, 11.7, 0.4, -4.0, C.metal);
    this.ico(F, 0.42, 7.1, 0.42, -5.3, 0xe08a4a); this.ico(F, 0.36, 7.95, 0.36, -5.45, 0x5e9c7a);
    this.node(2, "G1", 5, -0.3); this.node(2, "G2", 5.2, -3.4); this.node(2, "G4", 8.3, -2.9); this.node(2, "G6", 10.9, -2.9); this.node(2, "G5", 10.9, -4.3);
    this.link(2, "h2c", "G1", "G2", "G4", "G6", "G5");
    const ppA = this.spot(2, "Ruang Game", "break", 6.55, -1.2, E, "play", "G1"), ppB = this.spot(2, "Ruang Game", "break", 10.05, -1.2, W, "play", "G6");
    const ball = this.ico(F, 0.05, 8.3, 1.0, -1.2, 0xf5f4ef); ball.castShadow = false;
    this.animators.push((_dt, t) => { // ping-pong ball only when both players are at the table
      const on = !!(ppA.by && ppA.by.atSpot && ppB.by && ppB.by.atSpot);
      ball.visible = on;
      if (on) ball.position.set(8.3 + Math.sin(t * 3.2) * 1.25, 0.95 + Math.abs(Math.sin(t * 6.4)) * 0.35, -1.2 + Math.sin(t * 1.1) * 0.3);
    });
    this.spot(2, "Ruang Game", "break", 4.6, -4.72, N, "play", "G2"); this.spot(2, "Ruang Game", "break", 5.6, -4.72, N, "play", "G2");
    this.spot(2, "Ruang Game", "break", 9.66, -4.85, E, "game", "G5"); this.spot(2, "Ruang Game", "break", 9.66, -3.75, E, "game", "G5");
    this.roomLabel(F, "Ruang Game", 7.9, -2.7);

    /* tempat istirahat */
    this.box(F, 6.43, 0.02, 5.86, -8.79, 0.003, 3.07, C.sage);
    const bb1 = this.ico(F, 0.6, -10.6, 0.32, 1.5, 0xe08a4a); bb1.scale.y = 0.62;
    const bb2 = this.ico(F, 0.6, -8.9, 0.32, 1.3, 0x8a5cb0); bb2.scale.y = 0.62;
    [-11.0, -9.5].forEach((x) => { this.box(F, 0.9, 0.22, 2.0, x, 0.1, 4.2, C.white); this.box(F, 0.9, 0.1, 2.0, x, 0, 4.2, C.woodDark); this.box(F, 0.7, 0.1, 0.4, x, 0.32, 3.45, 0xe9eef5); });
    this.coffeeTable(F, -7.9, 4.6, 0.8, 0.8); this.cyl(F, 0.1, 0.08, 0.14, -7.9, 0.4, 4.6, C.white, 8);
    this.plant(F, -11.4, 0.6, 1.2); this.plant(F, -6.1, 0.6, 1.0);
    this.node(2, "Rest", -7.2, 2.9); this.node(2, "BalIn", -6.3, 5.3); this.node(2, "BalOut", -6.3, 7.3);
    this.link(2, "h2a", "Rest", "BalIn", "BalOut"); this.link(2, "h2a", "BalIn");
    this.spot(2, "Tempat Istirahat", ["idle", "break"], -10.6, 1.5, 0.7, "sit", "Rest", { y: 0.12 }); this.spot(2, "Tempat Istirahat", ["idle", "break"], -8.9, 1.3, 0.4, "sit", "Rest", { y: 0.12 });
    this.spot(2, "Tempat Istirahat", ["idle", "break"], -11.0, 4.95, S, "lie", "Rest", { y: 0.5 }); this.spot(2, "Tempat Istirahat", ["idle", "break"], -9.5, 4.95, S, "lie", "Rest", { y: 0.5 });
    this.roomLabel(F, "Tempat Istirahat", -8.8, 3.0);

    /* balkon */
    this.box(F, 9.5, 0.2, 2.65, -6.25, -0.2, 7.575, C.slab); this.box(F, 9.5, 0.02, 2.65, -6.25, 0, 7.575, C.deck);
    this.rail(F, -11, 8.85, -1.5, 8.85, 1.0); this.rail(F, -11, 6.3, -11, 8.85, 1.0); this.rail(F, -1.5, 6.3, -1.5, 8.85, 1.0);
    this.chair(F, -10.0, 7.4, S, 0xf5f4ef); this.cyl(F, 0.3, 0.3, 0.05, -9.1, 0.5, 7.5, C.woodDark, 10); this.cyl(F, 0.04, 0.04, 0.5, -9.1, 0, 7.5, C.metal, 6);
    this.box(F, 1.6, 0.4, 0.4, -2.6, 0, 7.0, C.white); this.ico(F, 0.3, -3.1, 0.6, 7.0, C.leaf); this.ico(F, 0.34, -2.5, 0.65, 7.0, C.leaf2); this.ico(F, 0.26, -2.0, 0.58, 7.0, C.leaf);
    this.spot(2, "Balkon", "idle", -7.9, 8.4, S, "lean", "BalOut"); this.spot(2, "Balkon", "idle", -4.2, 8.4, S, "lean", "BalOut"); this.spot(2, "Balkon", "idle", -10.0, 7.4, S, "sit", "BalOut");
    this.roomLabel(F, "Balkon", -6.3, 7.6, 2.0);

    this.toilet(F); this.roomLabel(F, "Toilet", 9.8, 4.2, 2.2);

    /* corner lamps */
    this.floorLamp(F, -11.75, -3.0); // Kamar Tidur (bunks fill the back wall)
    this.floorLamp(F, 3.05, -5.6);   // Sofa Baca, back-right past the shelves
    this.floorLamp(F, 11.0, -5.6);   // Ruang Game
    this.floorLamp(F, -7.6, 5.6);    // beside the balcony door (not in it)
    this.floorLamp(F, -11.7, 2.6);   // Tempat Istirahat
  }

  // ================================================================== outdoor
  private buildWorld() {
    const P = this.world;
    const g = this.box(P, 160, 0.4, 160, 0, -0.55, 0, C.grass); g.castShadow = false;
    this.box(P, 30, 0.06, 4.6, 0, -0.16, 9.4, C.pave); this.box(P, 30, 0.07, 0.25, 0, -0.16, 11.7, C.paveEdge);
    this.box(P, 1.8, 0.06, 1.1, 5.75, -0.16, 6.7, C.pave);
    this.box(P, 3.2, 0.06, 13, -14.6, -0.16, 3.0, C.pave);
    this.box(P, 160, 0.05, 7, 0, -0.17, 15.4, C.road);
    for (let x = -40; x <= 40; x += 5) this.box(P, 2.2, 0.01, 0.16, x, -0.115, 15.4, 0xe9e2b4);
    [[-15, -10, 1.1, 0], [-5, -11, 1, 1], [4, -10.5, 1.15, 0], [12, -11, 1, 1], [-18.5, -3, 1, 1], [-18, 6, 1.1, 0], [16.5, -5, 1.05, 0], [18, 7.5, 1, 1],
      [-13, 9.6, 0.8, 1], [11, 9.4, 0.85, 0], [-24, -12, 1.3, 0], [24, -10, 1.2, 1]].forEach((t) => this.tree(P, t[0], t[1], t[2], t[3]));
    [[-7, 10.9], [7, 10.9]].forEach((l) => { // street lamps
      this.cyl(P, 0.07, 0.09, 3.4, l[0], -0.15, l[1], C.metal, 6); this.box(P, 1.0, 0.06, 0.08, l[0] + 0.45, 3.2, l[1], C.metal);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.2), this.glow(0xfff0b8)); b.position.set(l[0] + 0.85, 3.17, l[1]); P.add(b);
    });
    { // park bench
      const b = this.grp(P, 12.5, 8.3, 0);
      [-0.3, 0, 0.3].forEach((z) => this.box(b, 2.0, 0.06, 0.22, 0, 0.42, z, C.woodDark));
      [-0.85, 0.85].forEach((x) => this.box(b, 0.06, 0.42, 0.75, x, 0, 0, C.metal));
      this.box(b, 2.0, 0.4, 0.06, 0, 0.5, -0.42, C.woodDark);
    }
    { // food cart
      const k = this.grp(P, -17.6, 8.6, 0.35);
      this.box(k, 1.6, 0.9, 1.0, 0, 0, 0, 0xd2302c); this.box(k, 1.8, 0.08, 1.2, 0, 0.9, 0, C.woodDark);
      [-0.75, 0.75].forEach((x) => { this.box(k, 0.06, 1.1, 0.06, x, 0.98, -0.5, C.metal); this.box(k, 0.06, 1.1, 0.06, x, 0.98, 0.5, C.metal); });
      this.box(k, 2.0, 0.12, 1.4, 0, 2.08, 0, 0xd2302c); [-0.7, 0, 0.7].forEach((x) => this.box(k, 0.5, 0.125, 1.42, x, 2.075, 0, 0xffffff));
      this.box(k, 0.5, 0.3, 0.4, -0.4, 0.98, 0, 0x3d434d); this.cyl(k, 0.1, 0.12, 0.22, 0.4, 0.98, 0.1, 0xaab4ba, 8);
      [-0.5, 0.5].forEach((x) => { const w = this.cyl(k, 0.24, 0.24, 0.1, x, 0.05, 0.6, 0x1c1c1c, 10); w.rotation.x = Math.PI / 2; });
    }
    for (let i = 0; i < 4; i++) { // clouds
      const c = this.grp(P, -34 + i * 19, -22 + (i % 2) * 16, 0, 17 + i * 1.4);
      [[0, 0, 0, 2.2], [1.8, 0.3, 0.4, 1.6], [-1.7, 0.2, -0.3, 1.5], [0.6, 0.9, -0.4, 1.3]].forEach((b) => {
        const m = this.ico(c, b[3], b[0], b[1], b[2], 0xffffff); m.scale.y = 0.55; m.castShadow = false;
      });
      this.animators.push((dt) => { c.position.x += (0.5 + i * 0.12) * dt; if (c.position.x > 60) c.position.x = -60; });
    }
    { // flock of birds
      const flock = this.grp(P, 0, 0, 0, 12);
      for (let i = 0; i < 5; i++) {
        const b = this.grp(flock, Math.cos(i * 1.3) * 2.4, Math.sin(i * 1.3) * 2.4, 0, (i % 2) * 0.6);
        this.box(b, 0.5, 0.04, 0.12, -0.25, 0, 0, 0x2c2f36); this.box(b, 0.5, 0.04, 0.12, 0.25, 0, 0, 0x2c2f36);
      }
      this.animators.push((_dt, t) => {
        flock.position.set(Math.cos(t * 0.18) * 24, 13 + Math.sin(t * 0.5) * 0.8, Math.sin(t * 0.18) * 22 - 2); flock.rotation.y = -t * 0.18;
        flock.children.forEach((b, i) => { const f = Math.sin(t * 9 + i) * 0.55; b.children[0].rotation.z = 0.3 + f; b.children[1].rotation.z = -0.3 - f; });
      });
    }
    const car = (c: number, z: number, dir: number, off: number, v: number) => {
      const g = this.grp(P, 0, z, dir > 0 ? 0 : Math.PI, -0.1);
      this.box(g, 2.2, 0.55, 1.1, 0, 0.25, 0, c); this.box(g, 1.2, 0.5, 1.0, -0.1, 0.8, 0, c); this.box(g, 1.1, 0.32, 1.04, -0.1, 0.86, 0, 0x9fd6ee);
      [[-0.7, -0.56], [0.7, -0.56], [-0.7, 0.56], [0.7, 0.56]].forEach((w) => { const m = this.cyl(g, 0.25, 0.25, 0.16, w[0], 0.1, w[1], 0x1c1c1c, 10); m.rotation.x = Math.PI / 2; });
      const hl = new THREE.Mesh(this.geo("hl", () => new THREE.BoxGeometry(0.06, 0.14, 0.3)), this.glow(0xfff0b8)); hl.position.set(1.1, 0.55, 0.3); g.add(hl);
      const hl2 = hl.clone(); hl2.position.z = -0.3; g.add(hl2);
      this.animators.push((_dt, t) => { g.position.x = dir * (((t * v + off) % 110) - 55); });
    };
    car(0xe4572e, 14.0, 1, 0, 6); car(0x3d7fd9, 14.0, 1, 55, 6); car(0xf5f4ef, 16.8, -1, 20, 5);
    const npc = (z: number, shirt: number, x0: number, dir0: number, extra: "cup" | "bag") => { // pedestrians
      let dir = dir0;
      const g = this.grp(P, x0, z, 0), b = new THREE.Group(); g.add(b);
      const shm = this.M(shirt);
      this.box(b, 0.44, 0.48, 0.26, 0, 0.45, 0, shm);
      const sk = dir > 0 ? 0xd9a273 : 0xf1c9a5, hr = dir > 0 ? 0x2b2320 : 0x8a5a34;
      this.box(b, 0.36, 0.34, 0.34, 0, 0.95, 0, sk); this.box(b, 0.4, 0.12, 0.38, 0, 1.25, 0, hr); this.box(b, 0.4, 0.24, 0.1, 0, 1.03, -0.16, hr);
      const limb = (x: number, y: number, w: number, h: number, d: number, c: Col) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); b.add(pv); this.box(pv, w, h, d, 0, -h, 0, c); return pv; };
      const lL = limb(-0.11, 0.45, 0.17, 0.45, 0.19, C.pants), lR = limb(0.11, 0.45, 0.17, 0.45, 0.19, C.pants);
      const aL = limb(-0.29, 0.91, 0.13, 0.42, 0.15, shm), aR = limb(0.29, 0.91, 0.13, 0.42, 0.15, shm);
      if (extra === "cup") this.cyl(aR, 0.05, 0.04, 0.12, 0, -0.44, 0.08, 0xf5f4ef, 8);
      if (extra === "bag") this.box(aL, 0.3, 0.32, 0.1, -0.02, -0.75, 0, 0x8a5a34);
      const ph = this.rnd() * 6;
      this.animators.push((dt, t) => {
        g.position.x += 1.1 * dir * dt; if (g.position.x > 14) dir = -1; if (g.position.x < -14) dir = 1;
        g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        const sw = Math.sin(t * 8 + ph) * 0.6;
        lL.rotation.x = sw; lR.rotation.x = -sw; aL.rotation.x = -sw * 0.7; aR.rotation.x = extra === "cup" ? -1.0 : sw * 0.7;
        b.position.y = Math.abs(Math.sin(t * 8 + ph)) * 0.05;
      });
    };
    npc(10.3, 0x2f9e6f, -6, 1, "cup"); npc(8.6, 0xd9488f, 9, -1, "bag");
    [[-12.9, 6.9], [-9, 6.9], [1.5, 6.9], [9.5, 6.9], [12.8, -3], [-12.9, -6.9]].forEach((b) => this.ico(P, 0.55, b[0], 0.15, b[1], C.leaf2));
  }

  // ================================================================== agents
  private drawTag(a: Agent3D, pulse?: number) {
    const g = a.tag.c.getContext("2d")!;
    g.clearRect(0, 0, 320, 72); g.font = "600 27px " + FONT;
    const name = a.data.name, tw = Math.min(300, g.measureText(name).width + 62), x = (320 - tw) / 2;
    g.fillStyle = "rgba(22,28,36,.86)"; rr(g, x, 12, tw, 48, 24); g.fill();
    if (a === this.selected) { g.strokeStyle = "#ffffff"; g.lineWidth = 3.5; rr(g, x + 2, 14, tw - 4, 44, 22); g.stroke(); }
    g.fillStyle = STATUS[a.data.status].color;
    if (pulse !== undefined) { // expanding ring around the dot (working orb)
      g.globalAlpha = 0.55 * (1 - pulse); g.beginPath(); g.arc(x + 25, 36, 9 + pulse * 8, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    }
    g.beginPath(); g.arc(x + 25, 36, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffffff"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(name, x + 42, 38, tw - 56);
    a.tag.tex.needsUpdate = true;
  }

  private buildAgent(d: AgentData, deskIdx: number): Agent3D {
    if (d.id === CLAUDE_AGENT_ID) return this.buildOrb(d, deskIdx);
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
    const tag = this.textSprite(320, 72, 2.8, 0.63); tag.sp.renderOrder = 30; tag.sp.position.set(0, 2.0, 0); g.add(tag.sp);
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
      dots: bubble("…", "rgba(255,255,255,.95)", "#f2a91e"), excl: bubble("!", "#ef4b4b", "#ffffff"),
      spot: null, path: [], floor: 1, lastNode: "hubC", pose: "stand", atSpot: false, deskIdx, since: null, phase: Math.random() * 6,
    };
    hit.userData.agent = a;
    this.drawTag(a);
    return a;
  }

  private toolState(s: AgentStatus): ToolStatus { return s === "working" ? "working" : s === "idle" ? "idle" : "unknown"; }
  /** Claude Code CLI as the clay/glass orb from the reference: a camera-facing shader billboard, back glow,
      smoke tendrils + orbiting embers (drawn behind and in front of the glass), and a warm point light. */
  private buildOrb(d: AgentData, deskIdx: number): Agent3D {
    this.hookShaderErrors();
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const float = new THREE.Group(); float.position.y = ORB_Y; g.add(float);

    const mat = new THREE.ShaderMaterial({
      vertexShader: ORB_VS, fragmentShader: ORB_FS, defines: { CLAUDE_ORB: 1 },
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.FrontSide, premultipliedAlpha: true,
    });
    const plane = new THREE.Mesh(this.geo("orbPlane", () => new THREE.PlaneGeometry(1, 1)), mat);
    plane.scale.setScalar(ORB_R * 2); plane.renderOrder = 2; float.add(plane);

    // Back glow ("pendaran"): reference gradient from 0.85 R to 2.1 R.
    const glowTex = gradientTexture(128, [[0, "rgba(217,119,87,1)"], [0.45, "rgba(160,72,45,0.37)"], [1, "rgba(110,45,25,0)"]], 0.85 / 2.1);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.3 }));
    glow.scale.setScalar(ORB_R * 2 * 2.1); glow.renderOrder = 1; float.add(glow);

    // Ember sprite = the reference's glow sprite; smoke = a soft round puff tinted per point.
    const emberTex = gradientTexture(64, [[0, "rgba(255,236,218,1)"], [0.12, "rgba(240,152,108,0.95)"], [0.38, "rgba(217,119,87,0.35)"], [1, "rgba(140,60,30,0)"]]);
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
    const light = new THREE.PointLight(0xff8c00, 0, 4, 2); float.add(light);
    const hit = this.box(g, 1.1, 1.3, 1.1, 0, ORB_Y - 0.65, 0, this.HIT); hit.castShadow = false; hit.receiveShadow = false;
    const ring = new THREE.Mesh(this.geo("ring", () => new THREE.RingGeometry(0.5, 0.64, 28)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false; ring.renderOrder = 5; g.add(ring);
    const tag = this.textSprite(320, 72, 2.8, 0.63); tag.sp.renderOrder = 30; tag.sp.position.set(0, ORB_Y + ORB_R + 0.45, 0); g.add(tag.sp);
    // Person-only parts (limbs, bubbles) are inert stand-ins: orbs never walk, pose or use them.
    const stub = new THREE.Sprite(); stub.visible = false; g.add(stub);
    const a: Agent3D = {
      data: d, group: g, body, lightMat: new THREE.MeshBasicMaterial(), shirt: new THREE.MeshLambertMaterial(),
      legL: new THREE.Group(), legR: new THREE.Group(), armL: new THREE.Group(), armR: new THREE.Group(),
      book: hit, hit, ring, tag, zzz: stub, dots: stub, excl: stub,
      spot: null, path: [], floor: 1, lastNode: "hubW", pose: "stand", atSpot: false, deskIdx, since: null, phase: 0,
      orb: {
        state: "unknown", float, plane, mat, fallback: null, glow, fx, embers, tendrils, emberLayer, smokeLayer,
        fxMats, textures: [emberTex, smokeTex], light, pulse: 0, spin: 0, time: 0, tagClock: 0,
      },
    };
    hit.userData.agent = a;
    this.applyOrb(a);
    this.stepOrb(a, 0, 0); // fill the particle buffers before the first render
    this.drawTag(a);
    return a;
  }
  /** Route GL compile/link errors: a failing orb shader swaps to a plain glowing disc instead of rendering nothing. */
  private hookShaderErrors() {
    if (this.renderer.debug.onShaderError) return;
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      console.error("[office3d] shader error", gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
      if ((gl.getShaderSource(fs) ?? "").includes("CLAUDE_ORB")) for (const a of this.agents) if (a.orb) this.orbFallback(a);
    };
  }
  private orbFallback(a: Agent3D) {
    const o = a.orb!; if (o.fallback) return;
    // Same as the reference's 2D fallback: an offset radial gradient disc.
    const tex = gradientTexture(128, [[0, "#ffd2b8"], [0.25, "#d97757"], [0.75, "#6b2d1a"], [0.97, "#c46a4c"], [1, "rgba(196,106,76,0)"]]);
    o.textures.push(tex);
    o.fallback = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    o.plane.material = o.fallback; o.fx.visible = false; o.fx.userData.off = true;
    console.warn("[office3d] Claude CLI orb shader failed to compile; using the simple glowing disc");
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
    o.mat.uniforms.uTime.value = T; o.mat.uniforms.uPulse.value = P;

    if (!this.reduce && o.state !== "unknown") o.float.position.y = ORB_Y + (working ? Math.sin(T * 2.4) * 0.14 : Math.sin(T * 1.25) * 0.05);
    o.plane.scale.setScalar(ORB_R * 2 * (1 + 0.012 * Math.sin(T * 1.25) + P * 0.035));
    // Billboard: cancel the parents' rotation, then take the camera's.
    o.float.getWorldQuaternion(this.tmpQ).invert();
    o.plane.quaternion.copy(this.tmpQ).multiply(this.camera.quaternion);
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
    const nDesks = this.deskScreens.length;
    let desk = meta.desk;
    if (desk === undefined || desk < 0 || desk >= nDesks || used.has(desk)) {
      desk = [...Array(nDesks).keys()].find((i) => !used.has(i)) ?? this.agents.length % nDesks;
    }
    const d: AgentData = {
      id, name: name || id, role: meta.role ?? "", status: STATUS[status] ? status : "idle", task: task ?? "",
      color: meta.color || "#6b7785", lastActive: meta.lastActive ?? null, reason: meta.reason ?? "",
    };
    const a = this.buildAgent(d, desk);
    this.agents.push(a); this.byId.set(id, a);
    if (a.orb) { // floats in the Lantai 1 lobby; never walks. Its desk stays reserved (screen glows while working).
      const ds = this.spots.filter((x) => x.use[0] === "desk"), s = ds[a.deskIdx % ds.length];
      this.claim(a, s); a.floor = 1; this.F1.add(a.group);
      a.group.position.set(ORB_POS.x, 0, ORB_POS.z); a.atSpot = true; this.deskGlow(a);
    } else {
      const s = this.pickSpot(a);
      if (s) this.place(a, s);
    }
    if (this.pendingFocus === id) { this.pendingFocus = null; this.select(id); }
    this.dirty = true;
  }

  private removeAgent(a: Agent3D) {
    if (a.spot && a.spot.by === a) a.spot.by = null;
    a.atSpot = false; this.deskGlow(a);
    a.group.parent?.remove(a.group);
    a.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Sprite).isSprite) { const sm = m.material as THREE.SpriteMaterial; sm.map?.dispose(); sm.dispose(); }
    });
    a.shirt.dispose(); a.lightMat.dispose(); (a.ring.material as THREE.Material).dispose();
    if (a.orb) {
      const o = a.orb; // glow sprite material/map are disposed by the sprite traversal above
      [o.mat, ...o.fxMats, ...(o.fallback ? [o.fallback] : [])].forEach((m) => m.dispose());
      o.textures.forEach((t) => t.dispose()); o.emberLayer.geo.dispose(); o.smokeLayer.geo.dispose(); o.light.dispose();
    }
    this.agents = this.agents.filter((x) => x !== a); this.byId.delete(a.data.id);
    if (this.selected === a) this.selected = null;
    this.dirty = true;
  }

  private setPose(a: Agent3D, p: Pose) {
    a.pose = p; a.body.position.y = 0; a.body.rotation.y = 0; a.dots.visible = false; a.excl.visible = false;
    const sit = p === "sit" || p === "type" || p === "read" || p === "game";
    a.body.rotation.x = p === "lie" ? -Math.PI / 2 : 0;
    a.legL.rotation.x = a.legR.rotation.x = sit ? -Math.PI / 2 : 0;
    const arm = p === "type" || p === "game" ? -1.15 : p === "read" ? -0.9 : p === "lean" ? -0.75 : 0;
    a.armL.rotation.x = a.armR.rotation.x = arm;
    a.book.visible = p === "read"; a.zzz.visible = p === "lie";
    if (p === "lie") { a.tag.sp.position.set(0, 0.95, -0.7); a.zzz.position.set(0.25, 0.75, -1.25); } else a.tag.sp.position.set(0, 2.0, 0);
  }
  private deskGlow(a: Agent3D) {
    const m = this.deskScreens[a.deskIdx]; if (!m) return;
    const on = a.orb ? a.data.status === "working" : a.atSpot && a.spot && a.spot.use[0] === "desk";
    m.emissive.setHex(on ? (a.data.status === "error" ? 0xd03a3a : 0x3fa6ee) : 0x000000);
  }
  private pickSpot(a: Agent3D): Spot | null {
    const use = STATUS[a.data.status].use;
    if (use === "desk") { const ds = this.spots.filter((s) => s.use[0] === "desk"); return ds[a.deskIdx % ds.length]; }
    if (a.spot && a.spot.use.indexOf(use) >= 0) return a.spot;
    let free = this.spots.filter((s) => s.use.indexOf(use) >= 0 && !s.by);
    if (!free.length) free = this.spots.filter((s) => s.use.indexOf("idle") >= 0 && !s.by);
    if (!free.length) return a.spot;
    const best = Math.min(...free.map((s) => s.pri));
    // Deterministic per agent (the reference picks at random), so a reload doesn't reshuffle rooms.
    const cands = free.filter((s) => s.pri === best);
    return cands[hashStr(a.data.id) % cands.length];
  }
  private claim(a: Agent3D, s: Spot | null) {
    if (a.spot && a.spot !== s && a.spot.by === a) a.spot.by = null;
    a.spot = s; if (s) s.by = a;
  }
  private place(a: Agent3D, s: Spot) {
    this.claim(a, s); a.floor = s.floor; this.floors[s.floor].add(a.group);
    a.group.position.set(s.x, s.y, s.z); a.group.rotation.y = s.rot; a.lastNode = s.node; a.path = []; a.atSpot = true;
    this.setPose(a, s.pose); this.deskGlow(a);
  }
  private go(a: Agent3D, s: Spot | null) {
    if (!s) return;
    if (a.spot === s && (a.atSpot || a.path.length)) { this.deskGlow(a); return; }
    this.claim(a, s); if (a.atSpot) a.group.position.y = 0; a.atSpot = false; this.deskGlow(a); this.setPose(a, "walk");
    if (this.reduce) { this.place(a, s); this.dirty = true; return; }
    const path: Waypoint[] = [];
    const add = (n: GNode) => path.push({ x: n.x, z: n.z, y: 0, node: n.id });
    if (a.floor === s.floor) this.route(a.floor, a.lastNode, s.node).forEach(add);
    else if (a.floor === 1) {
      this.route(1, a.lastNode, "S1").forEach(add);
      path.push({ x: 4.0, z: 3.75, y: 0 }, { x: 0.1, z: 3.75, y: 3.2, switchTo: 2, yAfter: 0 });
      this.route(2, "S2", s.node).forEach(add);
    } else {
      this.route(2, a.lastNode, "S2").forEach(add);
      path.push({ x: 0.1, z: 3.75, y: 0, switchTo: 1, yAfter: 3.2 }, { x: 4.0, z: 3.75, y: 0 });
      this.route(1, "S1", s.node).forEach(add);
    }
    path.push({ x: s.x, z: s.z, y: 0, spot: s });
    a.path = path;
  }
  private reach(a: Agent3D, wp: Waypoint) {
    if (wp.node) a.lastNode = wp.node;
    if (wp.switchTo) {
      a.floor = wp.switchTo; this.floors[a.floor].add(a.group); a.group.position.y = wp.yAfter ?? 0;
      a.lastNode = wp.switchTo === 2 ? "S2" : "S1"; this.dirty = true;
    }
    if (wp.spot) {
      a.group.rotation.y = wp.spot.rot; a.group.position.y = wp.spot.y; a.atSpot = true;
      this.setPose(a, wp.spot.pose); this.deskGlow(a); this.dirty = true;
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
    if (a.pose === "stand" || a.pose === "lean" || a.pose === "sit") a.body.rotation.y = Math.sin(t * 0.5 + a.phase) * 0.18; else a.body.rotation.y = 0;
    if (a.pose === "type") {
      const e = st === "error";
      a.armL.rotation.x = -1.15 + (e ? 0 : Math.sin(ph * 1.7) * 0.07); a.armR.rotation.x = -1.15 + (e ? 0 : Math.cos(ph * 1.9) * 0.07);
      a.body.rotation.z = e ? Math.sin(ph * 0.8) * 0.04 : 0;
    } else if (a.pose === "play") { a.armR.rotation.x = -0.9 + Math.sin(ph * 0.7) * 0.6; a.armL.rotation.x = -0.3; }
    else if (a.pose === "game") { a.armL.rotation.x = -1.1 + Math.sin(ph) * 0.05; a.armR.rotation.x = -1.1 + Math.cos(ph) * 0.05; }
    else if (a.pose === "lie") a.zzz.position.y = 0.75 + Math.sin(ph * 0.25) * 0.08;
    if (a.pose !== "type") a.body.rotation.z = 0;
  }
  private locText(a: Agent3D) {
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
    root.append(header, list, detail);
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
    // The default views leave room for the panel on wide screens; slide the camera by that same
    // margin (keeping any user orbit) so the scene re-centres in the full-width canvas.
    if (this.wide()) {
      const d = new THREE.Vector3(open ? 2.6 : -2.6, 0, 0), base = this.tween;
      const t = (base ? base.tt : this.controls.target).clone().add(d), p = (base ? base.tp : this.camera.position).clone().add(d);
      this.flyTo(t, p);
    }
  }
  private faceIcon(a: Agent3D) {
    const orb = a.orb ? a.orb.state : null;
    const skin = hex6(SKINS[a.deskIdx % SKINS.length]), hair = hex6(HAIRS[(a.deskIdx * 5 + 2) % HAIRS.length]);
    const key = orb ? "orb:" + orb : skin + hair + a.data.color;
    let url = this.faces.get(key);
    if (url === undefined) { url = orb ? drawOrbFace(orb) : drawFace(skin, hair, a.data.color); this.faces.set(key, url); }
    return url;
  }
  private renderRoster() {
    const { title, tally, list } = this.ui;
    title.textContent = this.agents.length + " agent";
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
    // Desk order = team order (Hermes 0-3, Claude CLI 4, OpenClaw 5-8), independent of fetch order.
    [...this.agents].sort((x, y) => x.deskIdx - y.deskIdx).forEach((a) => {
      const li = el("li"), b = el("button"); b.type = "button";
      if (a === this.selected) b.setAttribute("aria-current", "true");
      const av = el("span", "o3d-avatar"), face = el("img"); face.src = this.faceIcon(a); face.alt = ""; face.draggable = false;
      av.style.background = a.orb ? "#1c1f26" : a.data.color; av.appendChild(face);
      if (a.orb) b.classList.add("o3d-orb", "o3d-orb-" + a.orb.state);
      const st = el("i"); st.style.background = STATUS[a.data.status].color; av.appendChild(st);
      const oc = a.data.id.startsWith("openclaw:");
      const fw = el("span", "o3d-fw " + (oc ? "badge-openclaw" : "badge-hermes"), oc ? "OC" : "H");
      fw.title = oc ? "OpenClaw agent" : "Hermes agent";
      const nm = el("span", "o3d-name"); nm.append(fw, el("span", "truncate", a.data.name));
      const who = el("span", "o3d-who"); who.appendChild(nm);
      const sm = el("small", "", STATUS[a.data.status].label); sm.style.color = STATUS[a.data.status].color; who.appendChild(sm);
      b.append(av, who, el("span", "o3d-where", this.locText(a)));
      b.addEventListener("click", () => { this.select(a.data.id); this.opts.onSelect?.(a.data.id); });
      li.appendChild(b); list.appendChild(li);
    });
    list.scrollTop = keepY; list.scrollLeft = keepX;
    this.renderDetail();
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

  // ================================================================== camera / floors
  private wide() { return this.host.clientWidth > 780; }
  private viewFor(m: Mode) {
    const v = VIEWS[m], asp = this.camera.aspect || 1.6, f = Math.min(3.2, Math.max(1, 1.4 / asp));
    const t = new THREE.Vector3(v.t[0] + (this.wide() && this.sidebarOpen ? 2.6 : 0), v.t[1] - (this.wide() ? 0 : (m === "all" ? 1.5 : 1.2) * f), v.t[2]);
    return { t, p: new THREE.Vector3(t.x + v.o[0] * f, t.y + v.o[1] * f, t.z + v.o[2] * f) };
  }
  private flyTo(t: THREE.Vector3, p: THREE.Vector3) {
    if (this.reduce) { this.controls.target.copy(t); this.camera.position.copy(p); this.tween = null; return; }
    this.tween = { ft: this.controls.target.clone(), fp: this.camera.position.clone(), tt: t, tp: p, k: 0 };
  }
  private setMode(m: Mode, keepCam = false) {
    this.mode = m;
    this.F2.visible = m !== "f1";
    if (m === "all") this.f2Target.set(0, 11.2, -3); else this.f2Target.set(0, 3.2, 0);
    if (this.reduce || m === "f1") this.F2.position.copy(this.f2Target);
    this.applyLabels();
    if (!keepCam) { const v = this.viewFor(m); this.flyTo(v.t, v.p); }
  }
  private applyLabels() {
    this.labels.forEach((l) => { l.visible = this.showLabels && !(this.mode === "f2" && l.userData.floor === 1); });
  }
  private select(id: string | null) {
    const prev = this.selected;
    this.selected = id === null || id === undefined ? null : this.byId.get(String(id)) ?? null;
    if (prev) { prev.ring.visible = false; this.drawTag(prev); }
    const a = this.selected;
    if (a) {
      a.ring.visible = true; this.drawTag(a);
      if (this.mode === "f1" && a.floor === 2) { this.setMode("f2", true); this.opts.onPresetChange?.("lounge"); }
      else if (this.mode === "f2" && a.floor === 1) { this.setMode("f1", true); this.opts.onPresetChange?.("workspace"); }
      const base = a.floor === 2 ? this.f2Target : new THREE.Vector3(0, 0, 0), lp = a.group.position;
      const t = new THREE.Vector3(base.x + lp.x, base.y + lp.y + 0.8, base.z + lp.z);
      const off = this.camera.position.clone().sub(this.controls.target);
      off.setLength(Math.max(Math.min(off.length(), 24), 13));
      this.flyTo(t, t.clone().add(off));
    }
    this.dirty = true;
  }

  // ================================================================== theme
  private applyTheme() {
    const v = THEME[this.tod === "night" ? "night" : "day"];
    this.scene.background = new THREE.Color(v.bg);
    this.hemi.intensity = v.hemi * Math.PI; this.hemi.color.setHex(v.hemiColor);
    this.sun.intensity = v.sun * Math.PI; this.sun.color.setHex(v.sunColor);
    const isNight = this.tod === "night";
    this.lampLights.forEach((l) => { l.intensity = (isNight ? LAMP.nightI : LAMP.dayI) * Math.PI; });
    this.lampBulbs.forEach((b) => { b.material.color.setHex(isNight ? LAMP.bulbNight : LAMP.bulbDay); });
  }

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
    const hits = this.ray.intersectObjects(this.agents.filter((a) => a.floor === 1 || this.F2.visible).map((a) => a.hit), false);
    const a = hits.length ? (hits[0].object.userData.agent as Agent3D) : null;
    this.select(a ? a.data.id : null);
    if (a) this.opts.onSelect?.(a.data.id);
  };
  private resize = () => {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };
  private updateWalls() {
    const dx = this.camera.position.x - this.controls.target.x, dz = this.camera.position.z - this.controls.target.z, l = Math.hypot(dx, dz) || 1;
    for (const w of this.walls) { const lowOn = (dx * w.nx + dz * w.nz) / l > 0.15; w.tall.visible = !lowOn; w.low.visible = lowOn; }
  }
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    // Reference caps dt at 0.05 s; 0.25 keeps walking real-time on slow (software-GL) machines.
    const dt = Math.min(Math.max(0, (now - this.last) / 1000), 0.25); this.last = now;
    this.elapsed += dt;
    const t = this.elapsed;
    this.F2.position.lerp(this.f2Target, Math.min(1, dt * 5));
    if (this.tween) {
      const tw = this.tween; tw.k = Math.min(1, tw.k + dt / 0.7);
      const k = tw.k, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.controls.target.lerpVectors(tw.ft, tw.tt, e); this.camera.position.lerpVectors(tw.fp, tw.tp, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update(); this.updateWalls();
    for (const a of this.agents) { if (a.orb) this.stepOrb(a, dt, t); else this.stepAgent(a, dt, t); a.tag.sp.visible = !(this.mode === "f2" && a.floor === 1); }
    if (!this.reduce) for (const fn of this.animators) fn(dt, t);
    else if (this.animators.length) this.animators[0](dt, t); // clock hands only
    this.detailClock += dt;
    if (this.detailClock > 1) { this.detailClock = 0; if (this.selected) this.renderDetail(); }
    if (this.dirty) { this.dirty = false; this.renderRoster(); }
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrame) { this.firstFrame = true; this.opts.onFirstFrame?.(); }
  };
}
