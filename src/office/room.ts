// Static rooms + furniture for the two-floor office (Susi spec 2, 3, 6, 9; tech plan 2.2).
// Each floor merges every static box into ONE vertex-colored mesh (StaticBatch). Only parts whose
// emissive changes (screens, LED strips, laptop, TV, lamp shade) are separate glow meshes.
// Floor 1 is built in LOCAL coordinates (floor surface = 0); its group sits at y = FLOOR_H.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BENCH, DESKS, FLOOR_H, STAIR, ZONE_LABELS } from "./layout";

const DEG = Math.PI / 180;
type V3 = [number, number, number];

export class StaticBatch {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();
  get count() { return this.parts.length; }

  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string, rot?: V3, parent?: THREE.Matrix4) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.e.set(...(rot ?? [0, 0, 0]));
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
    if (parent) this.m.premultiply(parent);
    g.applyMatrix4(this.m);
    this.c.set(hex); // converted to linear working space
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = this.c.r; col[i * 3 + 1] = this.c.g; col[i * 3 + 2] = this.c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }

  build(name: string): THREE.Mesh {
    const merged = mergeGeometries(this.parts, false)!;
    this.parts.forEach((g) => g.dispose());
    this.parts = [];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.userData.boxes = merged.attributes.position.count / 24;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** Transform for a piece placed at (x, z) on the floor and turned by yaw. */
const at = (x: number, z: number, yaw = 0, y = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));

/** A mesh whose emissive is driven by state. */
export interface Glow {
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
}
function glowBox(group: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, base: string): Glow {
  const mat = new THREE.MeshLambertMaterial({ color: base, flatShading: true, emissive: 0x000000 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return { mesh, mat };
}

function label(text: string, cls: string, pos: V3): CSS2DObject {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.set(...pos);
  return o;
}

// =====================================================================================
// Shared furniture
// =====================================================================================
export interface DeskProps {
  screen: Glow;
  strip: Glow;
  laptopScreen?: Glow;
}

function desk(batch: StaticBatch, dyn: THREE.Group, id: string, agentHex: string): DeskProps {
  const { x: px, z: pz } = DESKS[id];
  const lead = id === "default";
  const dw = lead ? 2.4 : 2, dd = lead ? 1.1 : 1;
  const mx = id === "bagas_dev_lead" ? -0.4 : id === "susi_uiux" ? -0.35 : 0;
  // Desk top + legs
  batch.box(dw, 0.1, dd, px, 2.2, pz + 1.1, "#3A4356");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    batch.box(0.1, 2.15, 0.1, px + sx * (dw / 2 - 0.05), 1.075, pz + 1.1 + sz * (dd / 2 - 0.05), "#2A3242");
  }
  batch.box(dw * 0.9, 0.08, 0.02, px, 2.05, pz + 1.61, agentHex); // desk front stripe (spec 9.2 NEW)
  // Monitor (bezel static; screen + back strip dynamic)
  batch.box(0.2, 0.1, 0.2, px + mx, 2.3, pz + 1.45, "#111827");
  batch.box(0.08, 0.35, 0.08, px + mx, 2.45, pz + 1.47, "#111827");
  batch.box(1, 1, 0.1, px + mx, 2.85, pz + 1.45, "#111827");
  const screen = glowBox(dyn, 0.9, 0.9, 0.01, px + mx, 2.85, pz + 1.395, "#0F172A");
  const strip = glowBox(dyn, 0.6, 0.06, 0.02, px + mx, 3.25, pz + 1.51, "#1F2937");
  chair(batch, px, pz, 0, agentHex);

  const out: DeskProps = { screen, strip };
  if (id === "bagas_dev_lead") {
    const lx = px + 0.55, lz = pz + 1.1 - 0.05;
    batch.box(0.8, 0.05, 0.55, lx, 2.275, lz, "#9CA3AF");
    const hinge = new THREE.Group();
    hinge.position.set(lx, 2.3, lz + 0.275);
    hinge.rotation.x = 15 * DEG; // tilted back, screen facing Bagas (−Z)
    dyn.add(hinge);
    out.laptopScreen = glowBox(hinge, 0.8, 0.5, 0.04, 0, 0.25, -0.02, "#4B5563");
  }
  if (id === "susi_uiux") {
    const bx = px + 0.6, bz = pz + 1.1 - 0.1;
    batch.box(0.6, 0.05, 0.45, bx, 2.275, bz, "#F5E6D3");
    const dots: [number, number, string][] = [[-0.15, -0.1, "#38BDF8"], [0, -0.12, "#84CC16"], [0.15, -0.1, "#F5C542"], [0.1, 0.1, "#F472B6"]];
    dots.forEach(([dx, dz, c]) => batch.box(0.1, 0.04, 0.1, bx + dx, 2.32, bz + dz, c));
    batch.box(0.05, 0.05, 0.5, px + 0.15, 2.275, pz + 0.85, "#E8EAF0", [0, 35 * DEG, 0]);
  }
  return out;
}

/** Office chair (spec 9.2) at (x, z) facing yaw; back on the side opposite the facing. */
function chair(batch: StaticBatch, x: number, z: number, yaw: number, stripe: string) {
  const M = at(x, z, yaw);
  batch.box(1, 0.1, 1, 0, 0.95, 0, "#2B2F3A", undefined, M);
  batch.box(0.15, 0.9, 0.15, 0, 0.45, 0, "#2B2F3A", undefined, M);
  batch.box(0.8, 0.08, 0.8, 0, 0.04, 0, "#2B2F3A", undefined, M);
  batch.box(1, 1.3, 0.1, 0, 1.65, -0.55, "#2B2F3A", undefined, M);
  batch.box(0.9, 0.15, 0.02, 0, 2.2, -0.49, stripe, undefined, M);
}

export interface BenchProps { screen: Glow; strip: Glow; leds: Glow[] }

/** Claude Code CLI bench, origin BENCH (spec 9.3). Offsets are the old bench's, relative to its old origin. */
function bench(batch: StaticBatch, dyn: THREE.Group): BenchProps {
  const [cx, cz] = BENCH;
  batch.box(3, 0.1, 1.2, cx, 1.2, cz, "#4B5563");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.box(0.12, 1.15, 0.12, cx + sx * 1.4, 0.575, cz + sz * 0.5, "#374151");
  // Keyboard with 3 rows of key ridges
  batch.box(1.2, 0.08, 0.4, cx, 1.29, cz - 0.2, "#1F2937");
  for (let r = 0; r < 3; r++) batch.box(1.1, 0.03, 0.06, cx, 1.345, cz - 0.33 + r * 0.12, "#374151");
  // Terminal console, tilted back 20°
  const tilt = new THREE.Matrix4().compose(new THREE.Vector3(cx, 1.6, cz + 0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(-20 * DEG, 0, 0)), new THREE.Vector3(1, 1, 1));
  batch.box(1.4, 0.6, 0.08, 0, 0, 0, "#111827", undefined, tilt);
  batch.box(0.3, 0.3, 0.1, 0, -0.35, 0.05, "#111827", undefined, tilt);
  const term = new THREE.Group();
  term.position.set(cx, 1.6, cz + 0.4);
  term.rotation.x = -20 * DEG;
  dyn.add(term);
  const screen = glowBox(term, 1.3, 0.5, 0.01, 0, 0, -0.045, "#0F172A");
  const strip = glowBox(term, 0.6, 0.05, 0.02, 0, 0.22, 0.05, "#1F2937");
  // Server stack with LED strips
  const sx = cx - 1.4, sz = cz - 0.05;
  batch.box(0.8, 0.6, 0.8, sx, 0.3, sz, "#1F2937");
  batch.box(0.8, 0.6, 0.8, sx, 0.9, sz, "#1F2937");
  const leds = [0.4, 1.0].map((y) => glowBox(dyn, 0.5, 0.04, 0.02, sx, y, cz + 0.36, "#374151"));
  // Tool wall: pegboard + 6 tool silhouettes (one Claude orange) + second rack (spec 2.B)
  batch.box(4.0, 2.4, 0.08, 16, 3.2, -13.94, "#2E3444");
  const tools: [number, number, number, string][] = [[0.12, 0.9, 14.6, "#9CA3AF"], [0.3, 0.6, 15.2, "#9CA3AF"], [0.5, 0.7, 15.9, "#F97316"], [0.15, 1.0, 16.6, "#9CA3AF"], [0.4, 0.6, 17.1, "#9CA3AF"], [0.2, 0.8, 17.6, "#9CA3AF"]];
  tools.forEach(([w, h, x, c]) => batch.box(w, h, 0.04, x, 3.3, -13.88, c));
  batch.box(0.8, 1.8, 0.8, 18.8, 0.9, -13.2, "#1F2937");
  return { screen, strip, leds };
}

/** Existing plant(): a pot + stack of green cubes. y0 lets it stand on any surface. */
function plant(batch: StaticBatch, ox: number, oz: number, s: number) {
  const P = (x: number, y: number, z: number): V3 => [ox + (x - 9) * s, y * s, oz + (z + 9) * s];
  const b = (w: number, h: number, d: number, p: V3, c: string) => batch.box(w * s, h * s, d * s, ...p, c);
  b(0.8, 0.6, 0.8, P(9, 0.3, -9), "#7A4E2D");
  b(0.7, 0.05, 0.7, P(9, 0.6, -9), "#3B2A1E");
  b(0.2, 0.8, 0.2, P(9, 1.0, -9), "#3F6B2A");
  b(0.7, 0.7, 0.7, P(9, 1.7, -9), "#2F855A");
  b(0.5, 0.5, 0.5, P(9.35, 1.35, -8.8), "#38A169");
  b(0.5, 0.5, 0.5, P(8.7, 1.5, -9.25), "#38A169");
  b(0.4, 0.4, 0.4, P(9, 2.2, -8.95), "#48BB78");
}

/** Post-and-rail run (spec 3.B railing) along x (axis "x": z fixed) or along z (axis "z": x fixed). */
function railing(batch: StaticBatch, axis: "x" | "z", fixed: number, from: number, to: number, cap: string) {
  const len = to - from, mid = (from + to) / 2;
  const put = (w: number, h: number, y: number, c: string, along: number, l: number) =>
    axis === "x" ? batch.box(l, h, w, along, y, fixed, c) : batch.box(w, h, l, fixed, y, along, c);
  const n = Math.max(1, Math.round(len / 1.4));
  for (let i = 0; i <= n; i++) put(0.15, 2.1, 1.05, "#3D4559", from + (len * i) / n, 0.15);
  put(0.3, 0.12, 2.16, cap, mid, len);
  put(0.08, 0.08, 1.1, "#3D4559", mid, len);
  put(0.1, 0.15, 0.075, "#2E3444", mid, len);
}

// =====================================================================================
// Staircase (spec 6.1 / 9.8). World coordinates, y 0 → 6. Lives in the Floor 0 batch so it stays
// visible in the Workspace cutaway (Floor 1 hidden).
// =====================================================================================
export function buildStairs(b: StaticBatch) {
  const { x, steps, rise, tread, width, frontZ } = STAIR;
  const slope = Math.atan((steps * rise) / (steps * tread)); // 35.54°
  const run = Math.hypot(steps * rise, steps * tread);         // 10.32
  const midZ = frontZ - (steps * tread) / 2;                    // 8.2
  for (let i = 0; i < steps; i++) {
    const top = rise * (i + 1);
    const zc = frontZ - tread * i - tread / 2;
    b.box(width, top, tread, x, top / 2, zc, i % 2 ? "#343C4D" : "#3A4356");          // solid stacked block
    b.box(width, 0.04, 0.08, x, top + 0.01, frontZ - tread * i - 0.04, "#4A5A8A");   // nosing strip
  }
  b.box(0.12, 0.6, run, -17.1, 3.0, midZ, "#2E3444", [slope, 0, 0]);                 // open-side stringer
  for (const i of [1, 4, 7, 10, 11]) b.box(0.1, 2.0, 0.1, -17.25, rise * (i + 1) + 1.0, frontZ - tread * i - tread / 2, "#4A5266");
  b.box(0.1, 0.1, run, -17.25, 5.0, midZ, "#4A5266", [slope, 0, 0]);                  // sloped handrail
  b.box(width, 0.02, 1.4, x, 0.01, 13.2, "#2E3444");                                   // bottom landing pad
}

// =====================================================================================
// Floor 0 · Workspace (spec 2)
// =====================================================================================
export interface FloorBuild { group: THREE.Group; staticMesh: THREE.Mesh; dynamic: THREE.Group; labels: CSS2DObject[] }

export interface Floor0 extends FloorBuild {
  desks: Record<string, DeskProps>;
  bench: BenchProps;
  meetingScreen: Glow;
  deskLabels: Record<string, CSS2DObject>;
}

export function buildFloor0(agentHex: Record<string, string>): Floor0 {
  const b = new StaticBatch();
  const dyn = new THREE.Group();
  dyn.name = "floor0-dynamic";

  // ---- D. Structure ----
  b.box(40, 0.2, 28, 0, -0.1, 0, "#161B26");                // floor plate
  b.box(40.3, 5.7, 0.3, 0, 2.85, -14.15, "#232A38");         // back wall (carries the slab)
  b.box(0.3, 5.7, 28.3, -20.15, 2.85, 0, "#1E2431");         // left wall
  b.box(40, 0.25, 0.05, 0, 0.125, -13.98, "#2E3444");        // skirting
  b.box(0.05, 0.25, 28, -19.98, 0.125, 0, "#2E3444");
  for (const [x, z] of [[-20, 14], [0, 14], [20, 14], [20, 0], [20, -14]]) b.box(0.6, 5.7, 0.6, x, 2.85, z, "#2E3444");

  // ---- A. Meeting Room ----
  b.box(11.8, 0.02, 10.8, -14, 0.01, -8.5, "#1C2333");       // carpet
  b.box(7.0, 0.15, 2.6, -14, 2.2, -8.5, "#3F4A5E");          // conference table
  b.box(0.6, 2.125, 1.6, -16.5, 1.06, -8.5, "#2A3242");
  b.box(0.6, 2.125, 1.6, -11.5, 1.06, -8.5, "#2A3242");
  b.box(2.0, 0.02, 0.3, -14, 2.285, -8.5, "#2E3444");
  // 8 chairs; M2/M5/M7 knocked ±10° and pushed out 0.2 ("last meeting" still life)
  const seats: [number, number, number, number][] = [
    [-18.1, -8.5, Math.PI / 2, 0], [-14.0, -10.4, 0, 10], [-14.0, -6.6, Math.PI, 0], [-16.2, -10.4, 0, 0],
    [-16.2, -6.6, Math.PI, -10], [-11.8, -10.4, 0, 0], [-11.8, -6.6, Math.PI, 10], [-9.9, -8.5, -Math.PI / 2, 0],
  ];
  seats.forEach(([x, z, yaw, knock]) => {
    const push = knock ? 0.2 : 0;
    chair(b, x - Math.sin(yaw) * push, z - Math.cos(yaw) * push, yaw + knock * DEG, "#3D4559");
  });
  // Whiteboard on the back wall
  b.box(5.2, 2.6, 0.05, -14, 3.4, -13.97, "#6B7285");
  b.box(5.0, 2.4, 0.06, -14, 3.4, -13.93, "#E8EAF0");
  b.box(5.0, 0.08, 0.25, -14, 2.15, -13.85, "#6B7285");
  ["#A78BFA", "#38BDF8", "#84CC16", "#F472B6", "#F97316"].forEach((c, i) => b.box(0.4, 0.4, 0.02, -15.8 + i * 0.9, 3.6 + (i % 2) * 0.6, -13.89, c));
  [[-14.6, 2.9], [-13.2, 2.7], [-14.0, 2.5]].forEach(([x, y]) => b.box(1.6, 0.06, 0.02, x, y, -13.89, "#3D4559"));
  // Wall screen (left wall, facing +x): body static, screen glow (standby)
  b.box(0.1, 2.2, 4.0, -19.88, 3.2, -8.5, "#111827");
  const meetingScreen = glowBox(dyn, 0.02, 2.0, 3.8, -19.82, 3.2, -8.5, "#0F172A");
  meetingScreen.mat.emissive.set("#1E293B").multiplyScalar(0.15);
  // Half partitions with doorways + caps
  const part = (w: number, d: number, x: number, z: number) => { b.box(w, 1.2, d, x, 0.6, z, "#2A3242"); b.box(w, 0.08, d, x, 1.24, z, "#3A4356"); };
  part(0.3, 8.0, -8, -10); part(0.3, 1.0, -8, -3.5);         // east (door z -6..-4)
  part(5.0, 0.3, -17.5, -3); part(5.0, 0.3, -10.5, -3);      // south (door x -15..-13)
  // Frame posts (skip doorways) + top beams: "glass office" without transparency
  for (const z of [-13.5, -11.5, -9.5, -7.5, -6, -4, -3]) b.box(0.15, 4.4, 0.15, -8, 2.2, z, "#3D4559");
  for (const x of [-19, -17, -15, -13, -11, -9]) b.box(0.15, 4.4, 0.15, x, 2.2, -3, "#3D4559");
  b.box(0.15, 0.15, 11, -8, 4.4, -8.5, "#3D4559");
  b.box(12, 0.15, 0.15, -14, 4.4, -3, "#3D4559");
  // Still life: 2 mugs, 3 paper sheets
  b.box(0.15, 0.2, 0.15, -15.2, 2.375, -9.3, "#E8EAF0");
  b.box(0.15, 0.2, 0.15, -12.6, 2.375, -7.8, "#E8EAF0");
  [[-16.2, -9.2, 10], [-13.4, -7.9, -15], [-11.9, -9.0, 5]].forEach(([x, z, r]) => b.box(0.5, 0.01, 0.7, x, 2.28, z, "#A3A9B8", [0, r * DEG, 0]));
  plant(b, -19.0, -4.0, 0.8);

  // ---- B. Individual desks ----
  b.box(16.8, 0.02, 10.8, 2.5, 0.01, -8.5, "#161B26");
  const desks: Record<string, DeskProps> = {};
  Object.keys(DESKS).forEach((id) => { desks[id] = desk(b, dyn, id, agentHex[id] ?? "#6B7285"); });
  b.box(14, 1.4, 0.8, 3, 0.7, -13.5, "#2A3242");             // back-wall cabinets
  ["#6B5B95", "#3E6A85", "#5C7A3A", "#8A5A75", "#6B7285", "#8A6A4A"].forEach((c, i) => b.box(0.3, 0.6, 0.5, -2.5 + i * 2.2, 1.7, -13.5, c));
  // B2. Claude tool bench corner
  b.box(7.8, 0.02, 10.8, 16, 0.01, -8.5, "#1A1E28");
  const benchProps = bench(b, dyn);
  plant(b, -5.2, -13.2, 1.0);
  plant(b, 19.2, -4.0, 0.8);

  // ---- C. Open work area ----
  b.box(26, 0.02, 14, 7, 0.01, 7, "#1A2130");
  b.box(26, 0.02, 0.12, 7, 0.02, 0.06, "#1F4D4A"); b.box(26, 0.02, 0.12, 7, 0.02, 13.94, "#1F4D4A");
  b.box(0.12, 0.02, 14, -5.94, 0.02, 7, "#1F4D4A"); b.box(0.12, 0.02, 14, 19.94, 0.02, 7, "#1F4D4A");
  for (const x of [2, 6]) {                                    // standing desks
    b.box(2.2, 0.1, 1.0, x, 2.6, 4.6, "#3A4356");
    b.box(0.12, 2.55, 0.8, x - 0.95, 1.275, 4.6, "#2A3242");
    b.box(0.12, 2.55, 0.8, x + 0.95, 1.275, 4.6, "#2A3242");
    b.box(0.8, 0.06, 0.55, x, 2.68, 4.6, "#9CA3AF");
  }
  b.box(6.0, 0.12, 2.0, 4, 2.2, 10, "#3F4A5E");               // hot-desk table
  b.box(0.5, 2.14, 1.4, 1.6, 1.07, 10, "#2A3242");
  b.box(0.5, 2.14, 1.4, 6.4, 1.07, 10, "#2A3242");
  for (const x of [2, 4, 6]) {                                 // stools (north side)
    b.box(0.9, 0.1, 0.9, x, 0.95, 8.6, "#2B2F3A");
    b.box(0.15, 0.9, 0.15, x, 0.45, 8.6, "#2B2F3A");
    b.box(0.7, 0.06, 0.7, x, 0.03, 8.6, "#2B2F3A");
  }
  b.box(4.2, 2.6, 0.06, 12, 3.2, 5.94, "#6B7285");            // mobile whiteboard
  b.box(4.0, 2.4, 0.1, 12, 3.2, 6.0, "#E8EAF0");
  for (const x of [10.2, 13.8]) { b.box(0.12, 2.0, 0.12, x, 1.0, 6, "#6B7285"); b.box(0.12, 0.08, 1.2, x, 0.04, 6, "#6B7285"); }
  b.box(1.2, 2.2, 5.0, 18.6, 1.1, 10, "#2A3242");             // coffee bar
  b.box(1.4, 0.08, 5.2, 18.6, 2.24, 10, "#3F4A5E");
  b.box(0.6, 0.8, 0.5, 18.6, 2.68, 9, "#111827");
  for (const z of [10.2, 10.6, 11.0]) b.box(0.15, 0.2, 0.15, 18.6, 2.38, z, "#E8EAF0");
  plant(b, -5.2, 13.2, 1.0);
  plant(b, 19.2, 13.2, 1.0);
  plant(b, 9.0, 13.2, 0.8);

  // ---- D. Stair lobby ----
  b.box(11.8, 0.02, 14.8, -14, 0.01, 6.5, "#181D29");
  b.box(0.8, 1.6, 0.8, -10, 0.8, 12, "#6B7285");             // water cooler
  b.box(0.6, 0.7, 0.6, -10, 1.95, 12, "#7DD3FC");
  plant(b, -9.5, 1.5, 1.0);
  plant(b, -12.0, 13.2, 0.8);
  buildStairs(b);

  const group = new THREE.Group();
  group.name = "floor-0";
  const staticMesh = b.build("floor0-static");
  group.add(staticMesh, dyn);

  // CSS2D: zone labels, stair sign, desk name labels (no draw calls)
  const labels = ZONE_LABELS.filter((l) => l.floor === 0).map((l) => label(l.text, "zonelabel", l.pos));
  labels.push(label("↑ Floor 1 · Lounge", "zonelabel sign", [-18.45, 2.6, 13.6]));
  const deskLabels: Record<string, CSS2DObject> = {};
  Object.entries(DESKS).forEach(([id, d]) => {
    deskLabels[id] = label(`${d.name}'s desk`, "desklabel", [d.x, 3.9, d.z + 1.45]);
    deskLabels[id].visible = false;
    group.add(deskLabels[id]);
  });
  group.add(...labels);
  return { group, staticMesh, dynamic: dyn, labels, desks, bench: benchProps, meetingScreen, deskLabels };
}

// =====================================================================================
// Floor 1 · Lounge (spec 3). All coordinates LOCAL (world y = local y + FLOOR_H).
// =====================================================================================
export interface Floor1 extends FloorBuild { tv: Glow; lamp: Glow }

export function buildFloor1(): Floor1 {
  const b = new StaticBatch();
  const dyn = new THREE.Group();
  dyn.name = "floor1-dynamic";

  // ---- D. Structure: slab with the stairwell notch x[-20,-16.9] z[4,14] open ----
  b.box(36.9, 0.3, 28, 1.55, -0.15, 0, "#1C1826");
  b.box(3.1, 0.3, 18, -18.45, -0.15, -5.0, "#1C1826");
  b.box(32.3, 4.0, 0.3, -4, 2.0, -14.15, "#221E2E");         // back wall (interior only)
  b.box(0.3, 4.0, 28.3, -20.15, 2.0, 0, "#1F1B2A");          // left wall
  railing(b, "x", 13.85, -16.9, 12, "#4A5266");               // front guard rail
  railing(b, "z", -16.75, 4.0, 14, "#4A5266");                // stairwell side (back edge z=4 stays open)
  // Slab edge trim. Spec runs it x -20..20, but the notch leaves x < -16.9 open, so it starts there.
  b.box(36.9, 0.12, 0.05, 1.55, -0.06, 14.0, "#3D4559");
  b.box(0.05, 0.12, 28, 20.0, -0.06, 0, "#3D4559");
  b.box(3.0, 0.02, 3.0, -18.5, 0.01, 2.5, "#2E3444");         // stair landing plate

  // ---- A. TV corner ----
  b.box(9.0, 0.02, 8.0, -15.0, 0.01, -7.5, "#2A2236");
  b.box(1.0, 1.0, 5.0, -19.4, 0.5, -7.0, "#2A2438");          // TV cabinet
  b.box(0.25, 0.2, 2.4, -19.35, 1.1, -7.0, "#111827");        // soundbar
  b.box(0.15, 2.4, 4.2, -19.82, 2.9, -7.0, "#111827");        // TV body
  const tv = glowBox(dyn, 0.02, 2.2, 4.0, -19.73, 2.9, -7.0, "#0F172A");
  for (const z of [-10.05, -3.95]) {                           // media shelves flanking the TV (task brief)
    b.box(0.7, 2.4, 0.7, -19.6, 1.2, z, "#2A2438");
    for (const y of [0.8, 1.6]) b.box(0.72, 0.05, 0.72, -19.6, y, z, "#3A3348");
    b.box(0.2, 0.35, 0.5, -19.3, 0.99, z, "#6B5B95");
    b.box(0.2, 0.3, 0.4, -19.3, 1.78, z, "#4C6A5A");
  }
  // Main 3-seat sofa facing the TV (-x)
  b.box(1.1, 0.5, 4.8, -12.2, 0.25, -7.0, "#3B3355");
  b.box(0.3, 0.9, 4.8, -11.5, 0.95, -7.0, "#463C66");
  b.box(1.1, 0.7, 0.25, -12.2, 0.35, -9.525, "#463C66");
  b.box(1.1, 0.7, 0.25, -12.2, 0.35, -4.475, "#463C66");
  // Loveseat against the back, facing +z (L-shape with the sofa)
  b.box(3.2, 0.5, 1.1, -15.5, 0.25, -12.3, "#3B3355");
  b.box(3.2, 0.9, 0.3, -15.5, 0.95, -13.0, "#463C66");
  b.box(0.25, 0.7, 1.1, -17.225, 0.35, -12.3, "#463C66");
  b.box(0.25, 0.7, 1.1, -13.775, 0.35, -12.3, "#463C66");
  // Coffee table, popcorn, remote
  b.box(1.6, 0.1, 2.6, -15.6, 0.55, -7.0, "#5A4632");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, 0.5, 0.1, -15.6 + sx * 0.7, 0.25, -7.0 + sz * 1.2, "#4A3826");
  b.box(0.5, 0.2, 0.5, -15.6, 0.7, -7.4, "#F5C542");
  b.box(0.15, 0.05, 0.4, -15.3, 0.625, -6.4, "#111827");
  plant(b, -19.2, -3.2, 0.9);
  plant(b, -19.2, -13.2, 0.9);

  // ---- B. Balcony ----
  b.box(8.0, 0.04, 28, 16, 0.02, 0, "#3A3128");
  for (let x = 13; x <= 19; x++) b.box(0.08, 0.045, 28, x, 0.0225, 0, "#2E2620");
  // Frame wall at x = 12 with doorways z[0,3] and z[8,11]
  for (const z of [-14, -12, -10, -8, -6, -4, -2, 0, 3, 5.5, 8, 11, 12.5, 14]) b.box(0.2, 4.0, 0.2, 12, 2.0, z, "#3D4559");
  b.box(0.2, 0.2, 28, 12, 4.0, 0, "#3D4559");
  b.box(0.25, 0.3, 14, 12, 0.15, -7, "#3D4559");
  b.box(0.25, 0.3, 5, 12, 0.15, 5.5, "#3D4559");
  b.box(0.25, 0.3, 3, 12, 0.15, 12.5, "#3D4559");
  // Warm cap rail on the three outdoor edges
  railing(b, "z", 19.85, -14, 14, "#7A5A3C");
  railing(b, "x", -13.85, 12, 20, "#7A5A3C");
  railing(b, "x", 13.85, 12, 20, "#7A5A3C");
  // String lights along the frame-wall beam
  b.box(0.02, 0.02, 28, 12.15, 3.9, 0, "#1F2937");
  for (let z = -13; z <= 13; z += 2) b.box(0.12, 0.12, 0.12, 12.15, 3.8, z, "#F5C542");
  // Planters
  for (const z of [-10.5, 10.0]) {
    b.box(0.9, 0.8, 3.0, 19.2, 0.4, z, "#4A3826");
    ([[0.9, -1.0, "#2F855A"], [0.7, 0.0, "#38A169"], [0.8, 1.0, "#48BB78"]] as [number, number, string][])
      .forEach(([s, dz, c]) => b.box(s, s, s, 19.2, 0.8 + s / 2, z + dz, c));
  }
  // Bistro set at (16, 7)
  b.box(1.2, 0.08, 1.2, 16, 1.5, 7, "#A3A9B8");
  b.box(0.15, 1.45, 0.15, 16, 0.73, 7, "#6B7285");
  b.box(0.7, 0.06, 0.7, 16, 0.03, 7, "#6B7285");
  for (const [x, yaw] of [[14.9, Math.PI / 2], [17.1, -Math.PI / 2]]) {
    const M = at(x, 7, yaw);
    b.box(0.9, 0.1, 0.9, 0, 0.95, 0, "#6B7285", undefined, M);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.08, 0.9, 0.08, sx * 0.38, 0.45, sz * 0.38, "#6B7285", undefined, M);
    b.box(0.9, 1.0, 0.08, 0, 1.5, -0.41, "#6B7285", undefined, M);
  }
  // Night skyline east of the balcony (base at world y 0 → local -FLOOR_H)
  const blocks: [number, number, number, number][] = [ // x, z, w, h
    [30, -11, 3, 10], [34.5, -9, 4, 14], [31, -4.5, 2.5, 7], [36.5, -2, 3, 16],
    [30.5, 2.5, 3.5, 9], [35, 5.5, 3, 12], [31.5, 9.5, 3, 6.5], [37, 11, 3.5, 11],
  ];
  blocks.forEach(([x, z, w, h], i) => {
    b.box(w, h, 3, x, h / 2 - FLOOR_H, z, i % 2 ? "#121722" : "#151A26");
    const wins = 2 + (i % 3);
    for (let k = 0; k < wins; k++) {
      const wy = h * (0.35 + 0.5 * ((k * 0.37 + i * 0.21) % 1)) - FLOOR_H;
      const wz = z + ((k % 2 ? 1 : -1) * (0.3 + 0.25 * k)) % (1.2);
      b.box(0.02, 0.4, 0.3, x - w / 2 - 0.01, wy, wz, (i + k) % 3 ? "#F5C542" : "#7DD3FC");
    }
  });

  // ---- C. Rest / Nap room ----
  b.box(13.8, 0.02, 9.8, 3, 0.01, -9, "#17141F");
  b.box(11, 0.02, 4, 3, 0.02, -6.2, "#241D30");
  b.box(0.3, 2.0, 10, -4, 1.0, -9, "#2A2438");                // west partition
  // South bookshelf wall with doorway x[1.5, 3.5]
  const books = ["#8394AE", "#6B5B95", "#7A5A3C", "#4C6A5A"];
  ([[5.5, -1.25], [6.5, 6.75]] as [number, number][]).forEach(([w, cx], run) => {
    b.box(w, 2.0, 0.6, cx, 1.0, -4, "#2A2438");
    for (const y of [0.6, 1.2, 1.8]) b.box(w, 0.06, 0.62, cx, y, -4, "#3A3348");
    const n = run ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const shelf = [0.6, 1.2][i % 2];
      const bw = 0.2 + (i % 3) * 0.05;
      b.box(bw, 0.45, 0.4, cx - w / 2 + 0.5 + i * ((w - 1) / n), shelf + 0.255, -3.75, books[(i + run) % 4]);
    }
  });
  // Curtain strip on the back wall behind the daybeds (task brief)
  b.box(13.0, 0.08, 0.08, 3, 3.75, -13.9, "#3D4559");
  for (let i = 0; i < 13; i++) b.box(1.0, 2.2, 0.06 + (i % 2) * 0.04, -2.5 + i, 2.6, -13.92 + (i % 2) * 0.02, i % 2 ? "#3A2E4F" : "#33294A");
  // 3 daybeds, head end at the back wall
  for (const cx of [-1.0, 3.0, 7.0]) {
    const cz = -11.0;
    b.box(2.8, 0.5, 5.6, cx, 0.25, cz, "#2A2438");
    b.box(2.4, 0.2, 5.4, cx - 0.15, 0.6, cz, "#2F3A55");
    b.box(0.3, 0.9, 5.6, cx + 1.25, 0.95, cz, "#3B3355");
    b.box(2.8, 1.0, 0.3, cx, 0.5, -13.65, "#3B3355");
    b.box(1.4, 0.25, 0.9, cx - 0.15, 0.825, -12.6, "#A3A9B8");
    b.box(2.2, 0.12, 1.2, cx - 0.15, 0.76, -9.0, "#4C3A7A");
  }
  for (const x of [1.0, 5.0]) {                                // side tables + mini lamps (dim corner lamps)
    b.box(0.8, 1.0, 0.8, x, 0.5, -12.8, "#4A3826");
    b.box(0.2, 0.3, 0.2, x, 1.15, -12.8, "#3D4559");
    b.box(0.3, 0.3, 0.3, x, 1.45, -12.8, "#F5C542");
  }
  b.box(0.1, 3.2, 0.1, 9.2, 1.6, -13.2, "#3D4559");            // floor lamp
  b.box(0.6, 0.06, 0.6, 9.2, 0.03, -13.2, "#3D4559");
  const lamp = glowBox(dyn, 0.7, 0.6, 0.7, 9.2, 3.3, -13.2, "#F5C542");
  lamp.mat.emissive.set("#FFB86B").multiplyScalar(0.6);
  plant(b, -3.2, -13.2, 0.7);
  plant(b, 9.2, -5.0, 0.7);

  // ---- Commons ----
  b.box(17, 0.02, 17, 3.5, 0.01, 5.5, "#1C1826");
  b.box(10, 0.02, 8, 3, 0.02, 5, "#2A2236");
  ([[1.0, 7.0, 0, "#3B3355"], [4.0, 8.0, -0.3, "#4C3A7A"]] as [number, number, number, string][]).forEach(([x, z, yaw, c]) => {
    const M = at(x, z, yaw);
    b.box(1.6, 0.5, 1.6, 0, 0.25, 0, c, undefined, M);
    b.box(1.6, 0.6, 0.5, 0, 0.55, -0.55, c, undefined, M);
  });
  b.box(1.4, 0.35, 1.0, 2.5, 0.175, 9.9, "#5A4632");          // low table (task brief)
  b.box(0.3, 0.12, 0.3, 2.2, 0.41, 9.8, "#E8EAF0");
  // Hammock stand + hook (task brief), clear of the BAL-3 route at x 8
  for (const x of [5.0, 9.6]) { b.box(0.15, 3.0, 0.15, x, 1.5, 12.6, "#4A3826"); b.box(0.12, 0.25, 0.12, x, 2.9, 12.4, "#9CA3AF"); }
  b.box(4.4, 0.1, 0.1, 7.3, 0.05, 12.6, "#4A3826");
  b.box(3.6, 0.1, 1.0, 7.3, 1.3, 12.6, "#7A5A3C");
  plant(b, 11.0, -2.5, 1.0);
  plant(b, -4.5, 13.0, 1.0);

  const group = new THREE.Group();
  group.name = "floor-1";
  group.position.y = FLOOR_H;
  const staticMesh = b.build("floor1-static");
  group.add(staticMesh, dyn);
  const labels = ZONE_LABELS.filter((l) => l.floor === 1).map((l) => label(l.text, "zonelabel", l.pos));
  labels.push(label("Floor 1 · Lounge", "zonelabel sign", [-18.5, 2.4, 2.5]));
  group.add(...labels);
  return { group, staticMesh, dynamic: dyn, labels, tv, lamp };
}
