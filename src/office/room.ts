// Static room + furniture (spec 7.5). Every static box is merged into ONE vertex-colored mesh;
// only parts whose emissive changes with state (screens, LED strips, laptop) stay separate.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const DEG = Math.PI / 180;

export class StaticBatch {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();

  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string, rot?: [number, number, number], parent?: THREE.Matrix4) {
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

  build(): THREE.Mesh {
    const merged = mergeGeometries(this.parts, false)!;
    this.parts.forEach((g) => g.dispose());
    this.parts = [];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = "room-static";
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

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

export interface DeskProps {
  screen: Glow;
  strip: Glow;
  laptopScreen?: Glow;
}

export const SEATS: Record<string, { p: [number, number]; exit: [number, number]; lounge: [number, number]; face: number }> = {
  default:        { p: [-5.0, -6.0], exit: [-3.5, -6.0], lounge: [4.0, -7.0], face: 0 },
  pratama_cto:    { p: [-8.0, -1.5], exit: [-6.5, -1.5], lounge: [7.0, -7.0], face: 0 },
  bagas_dev_lead: { p: [-5.0, -1.5], exit: [-3.5, -1.5], lounge: [2.5, -4.8], face: Math.PI / 2 },
  susi_uiux:      { p: [-2.0, -1.5], exit: [-3.5, -1.5], lounge: [8.5, -4.8], face: -Math.PI / 2 },
};

function desk(batch: StaticBatch, dyn: THREE.Group, id: string, agentHex: string): DeskProps {
  const [px, pz] = SEATS[id].p;
  const lead = id === "default";
  const dw = lead ? 2.4 : 2, dd = lead ? 1.1 : 1;
  const mx = id === "bagas_dev_lead" ? -0.4 : id === "susi_uiux" ? -0.35 : 0;
  // Desk top + legs
  batch.box(dw, 0.1, dd, px, 2.2, pz + 1.1, "#3A4356");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    batch.box(0.1, 2.15, 0.1, px + sx * (dw / 2 - 0.05), 1.075, pz + 1.1 + sz * (dd / 2 - 0.05), "#2A3242");
  }
  // Monitor (bezel static; screen + back strip dynamic)
  batch.box(0.2, 0.1, 0.2, px + mx, 2.3, pz + 1.45, "#111827");
  batch.box(0.08, 0.35, 0.08, px + mx, 2.45, pz + 1.47, "#111827");
  batch.box(1, 1, 0.1, px + mx, 2.85, pz + 1.45, "#111827");
  const screen = glowBox(dyn, 0.9, 0.9, 0.01, px + mx, 2.85, pz + 1.395, "#0F172A");
  const strip = glowBox(dyn, 0.6, 0.06, 0.02, px + mx, 3.25, pz + 1.51, "#1F2937");
  // Chair
  batch.box(1, 0.1, 1, px, 0.95, pz, "#2B2F3A");
  batch.box(0.15, 0.9, 0.15, px, 0.45, pz, "#2B2F3A");
  batch.box(0.8, 0.08, 0.8, px, 0.04, pz, "#2B2F3A");
  batch.box(1, 1.3, 0.1, px, 1.65, pz - 0.55, "#2B2F3A");
  batch.box(0.9, 0.15, 0.02, px, 2.2, pz - 0.49, agentHex); // seat label stripe in the agent color

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

export interface BenchProps { screen: Glow; strip: Glow; leds: Glow[] }

function bench(batch: StaticBatch, dyn: THREE.Group): BenchProps {
  const cx = -8.0, cz = -8.15;
  batch.box(3, 0.1, 1.2, cx, 1.2, cz, "#4B5563");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.box(0.12, 1.15, 0.12, cx + sx * 1.4, 0.575, cz + sz * 0.5, "#374151");
  // Keyboard with 3 rows of key ridges
  batch.box(1.2, 0.08, 0.4, cx, 1.29, -8.35, "#1F2937");
  for (let r = 0; r < 3; r++) batch.box(1.1, 0.03, 0.06, cx, 1.345, -8.48 + r * 0.12, "#374151");
  // Terminal console, tilted back 20°
  const tilt = new THREE.Matrix4().compose(new THREE.Vector3(cx, 1.6, -7.75), new THREE.Quaternion().setFromEuler(new THREE.Euler(-20 * DEG, 0, 0)), new THREE.Vector3(1, 1, 1));
  batch.box(1.4, 0.6, 0.08, 0, 0, 0, "#111827", undefined, tilt);
  batch.box(0.3, 0.3, 0.1, 0, -0.35, 0.05, "#111827", undefined, tilt);
  const term = new THREE.Group();
  term.position.set(cx, 1.6, -7.75);
  term.rotation.x = -20 * DEG;
  dyn.add(term);
  const screen = glowBox(term, 1.3, 0.5, 0.01, 0, 0, -0.045, "#0F172A");
  const strip = glowBox(term, 0.6, 0.05, 0.02, 0, 0.22, 0.05, "#1F2937");
  // Server stack with LED strips
  batch.box(0.8, 0.6, 0.8, -9.4, 0.3, -8.2, "#1F2937");
  batch.box(0.8, 0.6, 0.8, -9.4, 0.9, -8.2, "#1F2937");
  const leds = [0.4, 1.0].map((y) => glowBox(dyn, 0.5, 0.04, 0.02, -9.4, y, -7.79, "#374151"));
  return { screen, strip, leds };
}

function plant(batch: StaticBatch, ox: number, oz: number, s: number) {
  const P = (x: number, y: number, z: number): [number, number, number] => [ox + (x - 9) * s, y * s, oz + (z + 9) * s];
  const b = (w: number, h: number, d: number, at: [number, number, number], c: string) => batch.box(w * s, h * s, d * s, ...at, c);
  b(0.8, 0.6, 0.8, P(9, 0.3, -9), "#7A4E2D");
  b(0.7, 0.05, 0.7, P(9, 0.6, -9), "#3B2A1E");
  b(0.2, 0.8, 0.2, P(9, 1.0, -9), "#3F6B2A");
  b(0.7, 0.7, 0.7, P(9, 1.7, -9), "#2F855A");
  b(0.5, 0.5, 0.5, P(9.35, 1.35, -8.8), "#38A169");
  b(0.5, 0.5, 0.5, P(8.7, 1.5, -9.25), "#38A169");
  b(0.4, 0.4, 0.4, P(9, 2.2, -8.95), "#48BB78");
}

export interface Room {
  staticMesh: THREE.Mesh;
  grid: THREE.GridHelper;
  dynamic: THREE.Group;
  desks: Record<string, DeskProps>;
  bench: BenchProps;
}

export function buildRoom(agentHex: Record<string, string>): Room {
  const b = new StaticBatch();
  const dyn = new THREE.Group();
  dyn.name = "room-dynamic";

  // Floors, rug
  b.box(10, 0.2, 20, -5, -0.1, 0, "#161B26");
  b.box(10, 0.2, 20, 5, -0.1, 0, "#1C1826");
  b.box(5, 0.02, 4, 5.5, 0.01, -5.5, "#2A2236");
  // Walls
  b.box(20, 3, 0.3, 0, 1.5, -10.15, "#232A38");
  b.box(0.3, 3, 20, -10.15, 1.5, 0, "#1E2431");
  // Divider with doorway z ∈ [2, 4]
  b.box(0.3, 1.2, 12, 0, 0.6, -4, "#2A3242");
  b.box(0.3, 1.2, 6, 0, 0.6, 7, "#2A3242");
  b.box(0.3, 0.08, 12, 0, 1.24, -4, "#3A4356");
  b.box(0.3, 0.08, 6, 0, 1.24, 7, "#3A4356");

  const desks: Record<string, DeskProps> = {};
  Object.keys(SEATS).forEach((id) => { desks[id] = desk(b, dyn, id, agentHex[id] ?? "#6B7285"); });
  const benchProps = bench(b, dyn);

  // Lounge: two sofas (+Z facing), two armchairs, coffee table, mug, plants
  for (const x of [4.0, 7.0]) {
    b.box(2, 0.5, 1, x, 0.25, -7.0, "#3B3355");
    b.box(2, 0.7, 0.25, x, 0.85, -7.4, "#463C66");
    b.box(0.2, 0.6, 1, x - 1.1, 0.3, -7.0, "#463C66");
    b.box(0.2, 0.6, 1, x + 1.1, 0.3, -7.0, "#463C66");
  }
  b.box(1.2, 0.5, 1.2, 2.5, 0.25, -4.8, "#3B3355");
  b.box(0.25, 0.7, 1.2, 1.9, 0.85, -4.8, "#463C66");
  b.box(1.2, 0.5, 1.2, 8.5, 0.25, -4.8, "#3B3355");
  b.box(0.25, 0.7, 1.2, 9.1, 0.85, -4.8, "#463C66");
  b.box(2, 0.1, 1, 5.5, 0.5, -4.8, "#5A4632");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, 0.45, 0.1, 5.5 + sx * 0.9, 0.225, -4.8 + sz * 0.4, "#4A3826");
  b.box(0.15, 0.2, 0.15, 5.1, 0.65, -4.7, "#E8EAF0");
  plant(b, 9.0, -9.0, 1);
  plant(b, 1.0, 5.0, 0.7);

  const grid = new THREE.GridHelper(20, 20, 0x2a3142, 0x222938);
  grid.position.y = 0.005;
  const gm = grid.material as THREE.Material;
  gm.transparent = true;
  gm.opacity = 0.5;

  return { staticMesh: b.build(), grid, dynamic: dyn, desks, bench: benchProps };
}
