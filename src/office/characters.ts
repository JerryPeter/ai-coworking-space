// Minecraft-style characters (spec 7.1–7.5). BoxGeometry + MeshLambertMaterial(flatShading), no
// textures. Each character is a root Group with pivot groups; animation only moves pivots.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { DESKS, FLOOR_H, loungeSpotFor, ROBOT_POS } from "./layout";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export type HumanState = "working" | "reviewing" | "idle" | "offline" | "unknown";
export type RobotState = "running" | "not_running" | "unknown";

// ---------- shared geometry cache (one geometry instance per unique size) ----------
export class GeoCache {
  private map = new Map<string, THREE.BoxGeometry>();
  get(w: number, h: number, d: number) {
    const k = `${w},${h},${d}`;
    let g = this.map.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); this.map.set(k, g); }
    return g;
  }
  dispose() { this.map.forEach((g) => g.dispose()); this.map.clear(); }
}

type Role = "normal" | "accessory" | "eye" | "antenna" | "prompt" | "led";
interface MatRec {
  mat: THREE.MeshLambertMaterial;
  base: THREE.Color;      // base color (linear)
  emis: THREE.Color;      // base emissive * intensity
  role: Role;
  cur: THREE.Color;       // displayed color (lerped)
  curE: THREE.Color;      // displayed emissive before hover (lerped)
}

const tmpC = new THREE.Color();
const tmpE = new THREE.Color();
const tmpH = new THREE.Color();
const BLACK = new THREE.Color(0, 0, 0);

function approach(dt: number, rate = 5) { return 1 - Math.exp(-dt * rate); }
function easeInOut(p: number) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
function wrapAngle(a: number) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

// ---------- "?" box (spec 7.4) ----------
const Q_BITMAP = [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."];
function questionBox(geo: GeoCache, mk: (hex: string, role?: Role, e?: string, ei?: number) => THREE.MeshLambertMaterial) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo.get(0.6, 0.6, 0.6), mk("#6B7280")));
  const glyphMat = mk("#E8EAF0", "normal", "#E8EAF0", 0.3);
  for (const side of [1, -1]) {
    Q_BITMAP.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch !== "#") return;
      const m = new THREE.Mesh(geo.get(0.08, 0.08, 0.02), glyphMat);
      m.position.set((c - 2) * 0.09 * side, (3 - r) * 0.09, side * 0.31);
      g.add(m);
    }));
  }
  g.scale.setScalar(0.001);
  g.visible = false;
  return g;
}

export interface CharacterOpts { id: string; index: number; agentHex: string; reducedMotion: boolean }

abstract class BaseCharacter {
  id: string;
  index: number;
  root = new THREE.Group();
  mats: MatRec[] = [];
  meshes: THREE.Mesh[] = [];
  agentColor: THREE.Color;
  hovered = false;
  qbox!: THREE.Group;
  qScale = 0;
  tag: CSS2DObject;
  tagEl: HTMLDivElement;
  reducedMotion: boolean;
  protected geo: GeoCache;

  constructor(o: CharacterOpts, geo: GeoCache) {
    this.id = o.id;
    this.index = o.index;
    this.geo = geo;
    this.reducedMotion = o.reducedMotion;
    this.agentColor = new THREE.Color(o.agentHex);
    this.root.name = `char-${o.id}`;
    this.tagEl = document.createElement("div");
    this.tagEl.className = "nametag";
    this.tag = new CSS2DObject(this.tagEl);
  }

  protected mat(hex: string, role: Role = "normal", emissive?: string, intensity = 0): THREE.MeshLambertMaterial {
    // One material instance per (color, part role) per character, so lerps never leak.
    const key = `${hex}|${role}|${emissive ?? ""}|${intensity}`;
    const existing = this.mats.find((m) => m.mat.userData.key === key);
    if (existing) return existing.mat;
    const mat = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    mat.userData.key = key;
    const base = new THREE.Color(hex);
    const emis = emissive ? new THREE.Color(emissive).multiplyScalar(intensity) : new THREE.Color(0, 0, 0);
    mat.emissive.copy(emis);
    this.mats.push({ mat, base, emis, role, cur: base.clone(), curE: emis.clone() });
    return mat;
  }

  protected box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
    const m = new THREE.Mesh(this.geo.get(w, h, d), mat);
    m.position.set(x, y, z);
    m.userData.charId = this.id;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  protected finishQBox(y: number) {
    this.qbox = questionBox(this.geo, (hex, role, e, ei) => this.mat(hex, role, e, ei));
    this.qbox.position.y = y;
    this.qbox.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.charId = this.id; this.meshes.push(o as THREE.Mesh); } });
    this.root.add(this.qbox);
  }

  /** Lerp displayed colors toward the targets for the given gray/dim factors. */
  protected applyColors(dt: number, target: (r: MatRec, outC: THREE.Color, outE: THREE.Color) => void, instant: boolean) {
    const a = instant ? 1 : approach(dt, 4.5);
    for (const r of this.mats) {
      target(r, tmpC, tmpE);
      r.cur.lerp(tmpC, a);
      r.curE.lerp(tmpE, a);
      r.mat.color.copy(r.cur);
      r.mat.emissive.copy(r.curE);
      if (this.hovered) r.mat.emissive.add(tmpH.copy(this.agentColor).multiplyScalar(0.12)); // hover: +agent color at 0.12
    }
  }

  protected updateQBox(dt: number, t: number, show: boolean) {
    const target = show ? 1 : 0;
    if (this.reducedMotion) this.qScale = target;
    else this.qScale += Math.sign(target - this.qScale) * Math.min(Math.abs(target - this.qScale), dt / 0.3);
    this.qbox.visible = this.qScale > 0.01;
    this.qbox.scale.setScalar(Math.max(0.001, this.qScale));
    if (this.qbox.visible && !this.reducedMotion) {
      this.qbox.rotation.y += 0.6 * dt;
      this.qbox.position.y = this.qBaseY + 0.05 * Math.sin((TAU * t) / 2);
    }
  }
  protected qBaseY = 0;

  setTag(name: string, status: string, dot: string, dim: boolean) {
    this.tagEl.innerHTML = "";
    const d = document.createElement("span");
    d.style.cssText = `width:8px;height:8px;border-radius:${this instanceof Robot ? "2px" : "50%"};background:${dot};display:inline-block`;
    const n = document.createElement("span");
    n.textContent = name;
    const s = document.createElement("span");
    s.className = "st";
    s.textContent = `· ${status}`;
    this.tagEl.append(d, n, s);
    this.tagEl.classList.toggle("dim", dim);
  }

  setHover(h: boolean) {
    this.hovered = h;
    this.tagEl.classList.toggle("hover", h);
  }

  headWorld(out = new THREE.Vector3()) { return this.root.localToWorld(out.set(0, this.headY(), 0)); }
  abstract headY(): number;
  abstract update(dt: number, time: number, instant?: boolean): void;

  dispose() {
    this.mats.forEach((r) => r.mat.dispose());
    this.tagEl.remove();
  }
}

// =====================================================================================
// Humanoid
// =====================================================================================
interface HumanLook {
  shirt: string; pants: string; hair: string;
  build: (c: Human, head: THREE.Group, body: THREE.Group) => void;
  hideEyes?: boolean;
  noHairTop?: boolean;
  longBack?: boolean;
}

const LOOKS: Record<string, HumanLook> = {
  default: {
    shirt: "#A78BFA", pants: "#4C3A7A", hair: "#2B1D14",
    build: (c, head, body) => {
      const gold = c.matPublic("#F5C542", "accessory", "#F5C542", 0.15);
      c.boxPublic(head, 1.1, 0.18, 0.1, 0, 1.2, 0.5, gold);
      c.boxPublic(head, 1.1, 0.18, 0.1, 0, 1.2, -0.5, gold);
      c.boxPublic(head, 0.1, 0.18, 1.1, 0.5, 1.2, 0, gold);
      c.boxPublic(head, 0.1, 0.18, 1.1, -0.5, 1.2, 0, gold);
      for (const x of [-0.48, 0.48]) for (const z of [-0.48, 0.48]) c.boxPublic(head, 0.14, 0.2, 0.14, x, 1.38, z, gold);
      c.boxPublic(body, 0.2, 0.2, 0.04, -0.25, 3.05, 0.27, c.matPublic("#F5C542", "accessory", "#F5C542", 0.15)); // lead pin
    },
  },
  pratama_cto: {
    shirt: "#38BDF8", pants: "#1E4E6B", hair: "#1A1A1A", hideEyes: true,
    build: (c, head, body) => {
      c.boxPublic(head, 1.05, 0.15, 0.1, 0, 0.88, 0.5, c.matPublic("#1A1A1A"));
      const frame = c.matPublic("#111827");
      c.boxPublic(head, 0.9, 0.08, 0.04, 0, 0.62, 0.53, frame);
      const lens = c.matPublic("#BAE6FD", "accessory", "#38BDF8", 0.25);
      c.boxPublic(head, 0.3, 0.22, 0.03, 0.22, 0.55, 0.53, lens);
      c.boxPublic(head, 0.3, 0.22, 0.03, -0.22, 0.55, 0.53, lens);
      c.boxPublic(head, 0.04, 0.06, 0.5, 0.52, 0.62, 0.28, frame);
      c.boxPublic(head, 0.04, 0.06, 0.5, -0.52, 0.62, 0.28, frame);
      c.boxPublic(body, 1.1, 0.2, 0.55, 0, 3.45, -0.05, c.matPublic("#0EA5E9")); // hoodie hood rim
    },
  },
  bagas_dev_lead: {
    shirt: "#84CC16", pants: "#3F6212", hair: "#3A2A1E", noHairTop: true,
    build: (c, head) => {
      c.boxPublic(head, 1.08, 0.3, 1.08, 0, 1.1, 0, c.matPublic("#1F2937"));
      c.boxPublic(head, 0.7, 0.08, 0.45, 0, 0.98, -0.72, c.matPublic("#84CC16")); // brim points backward
    },
  },
  susi_uiux: {
    shirt: "#F472B6", pants: "#831843", hair: "#4A2C1F", longBack: true,
    build: (c, head) => {
      const hair = c.matPublic("#4A2C1F");
      c.boxPublic(head, 0.08, 0.7, 0.9, 0.52, 0.55, -0.05, hair);
      c.boxPublic(head, 0.08, 0.7, 0.9, -0.52, 0.55, -0.05, hair);
      const beret = c.matPublic("#BE185D");
      const b = c.boxPublic(head, 1.1, 0.2, 1.1, 0.08, 1.15, 0, beret);
      b.rotation.z = -10 * DEG;
      c.boxPublic(head, 0.15, 0.12, 0.15, 0.08, 1.31, 0, beret);
    },
  },
};

type Loc = "desk" | "lounge";
type Phase = "sit" | "rise" | "walk" | "lower";

export class Human extends BaseCharacter {
  hipL = new THREE.Group(); hipR = new THREE.Group();
  shL = new THREE.Group(); shR = new THREE.Group();
  neck = new THREE.Group();
  state: HumanState = "unknown";
  private loc: Loc = "desk";        // where the character is (or is heading when walking)
  private phase: Phase = "sit";
  private p = 0;                    // progress for rise/lower
  private path: THREE.Vector2[] = [];
  private next = 0;
  private pos = new THREE.Vector2();
  private yaw = 0;
  private hip = -90 * DEG;
  private armBase = 0;
  private initialized = false;

  matPublic(hex: string, role: Role = "normal", e?: string, ei = 0) { return this.mat(hex, role, e, ei); }
  boxPublic(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) { return this.box(parent, w, h, d, x, y, z, m); }

  constructor(o: CharacterOpts, geo: GeoCache) {
    super(o, geo);
    const look = LOOKS[o.id];
    const shirt = this.mat(look.shirt), pants = this.mat(look.pants), skin = this.mat("#D4A373"), hair = this.mat(look.hair);
    // Legs (pivot at hip)
    this.hipL.position.set(-0.25, 1.5, 0); this.hipR.position.set(0.25, 1.5, 0);
    this.box(this.hipL, 0.5, 1.5, 0.5, 0, -0.75, 0, pants);
    this.box(this.hipR, 0.5, 1.5, 0.5, 0, -0.75, 0, pants);
    // Body
    this.box(this.root, 1.0, 2.0, 0.5, 0, 2.5, 0, shirt);
    // Arms (pivot at shoulder)
    this.shL.position.set(-0.75, 3.25, 0); this.shR.position.set(0.75, 3.25, 0);
    this.box(this.shL, 0.5, 1.5, 0.5, 0, -0.5, 0, shirt);
    this.box(this.shR, 0.5, 1.5, 0.5, 0, -0.5, 0, shirt);
    // Head (pivot at neck); head-local coordinates are in the neck group's space.
    this.neck.position.set(0, 3.5, 0);
    this.box(this.neck, 1, 1, 1, 0, 0.5, 0, skin);
    if (!look.hideEyes) {
      const eye = this.mat("#1F2937");
      this.box(this.neck, 0.15, 0.15, 0.02, 0.22, 0.55, 0.51, eye);
      this.box(this.neck, 0.15, 0.15, 0.02, -0.22, 0.55, 0.51, eye);
    }
    this.box(this.neck, 0.3, 0.08, 0.02, 0, 0.25, 0.51, this.mat("#9C6644"));
    if (!look.noHairTop) this.box(this.neck, 1.05, 0.25, 1.05, 0, 1.0, 0, hair);
    if (look.longBack) this.box(this.neck, 1.05, 1.1, 0.15, 0, 0.45, -0.5, hair);
    else this.box(this.neck, 1.05, 0.5, 0.1, 0, 0.7, -0.5, hair);
    look.build(this, this.neck, this.root);
    this.root.add(this.hipL, this.hipR, this.shL, this.shR, this.neck);
    this.qBaseY = 5.15;
    this.finishQBox(5.15);
    this.tag.position.set(0, 5.4, 0);
    this.root.add(this.tag);
  }

  headY() { return 4.0; } // head center, root-local

  // Interim (task 1): desk from DESKS, lounge spot on Floor 1. Replaced by spots/poses in task 3.
  private seat(loc: Loc) {
    const d = DESKS[this.id], l = loungeSpotFor(this.id);
    return loc === "desk" ? { x: d.x, z: d.z, y: -0.25, yaw: 0 } : { x: l.x, z: l.z, y: FLOOR_H - 0.75, yaw: l.yaw };
  }

  private buildPath(from: Loc, to: Loc): THREE.Vector2[] {
    const d = DESKS[this.id], l = loungeSpotFor(this.id);
    const pts: [number, number][] = [[d.x, d.z], d.exit, [l.x, l.z]];
    const v = pts.map(([x, z]) => new THREE.Vector2(x, z));
    return from === "desk" && to === "lounge" ? v : v.reverse();
  }

  setState(state: HumanState) {
    this.state = state;
    const want: Loc = state === "idle" ? "lounge" : "desk";
    if (!this.initialized || this.reducedMotion) {
      // Initial load (and reduced motion): appear at the destination, no walking.
      this.initialized = true;
      this.loc = want; this.phase = "sit"; this.p = 1;
      const st = this.seat(want);
      this.pos.set(st.x, st.z); this.yaw = st.yaw; this.hip = -90 * DEG;
      this.root.position.set(st.x, st.y, st.z);
      this.update(0, 0, true);
      return;
    }
    if (want === this.loc) return; // already there or already heading there
    if (this.phase === "sit") {
      this.path = this.buildPath(this.loc, want); this.next = 1;
      this.loc = want; this.phase = "rise"; this.p = 0;
    } else if (this.phase === "lower") {
      // Was sitting down at the old loc; stand back up and leave.
      this.path = this.buildPath(this.loc, want); this.next = 1;
      this.loc = want; this.phase = "rise"; this.p = 1 - this.p;
    } else if (this.phase === "rise") {
      // Changed mind while standing up: sit back down where we are.
      this.loc = want; this.phase = "lower"; this.p = 1 - this.p;
    } else {
      // New state arrived mid-walk: reverse from the current position along the path walked (no teleport).
      this.loc = want;
      this.reverse();
    }
  }

  private reverse() {
    const passed = this.path.slice(0, this.next).reverse();
    this.path = [this.pos.clone(), ...passed];
    this.next = 1;
  }

  update(dt: number, time: number, instant = false) {
    const t = time + this.index * 0.37;
    const rm = this.reducedMotion;
    const st = this.seat(this.loc);
    let walking = false;

    if (this.phase === "rise") {
      this.p = Math.min(1, this.p + dt / 0.3);
      const from = this.seat(this.loc === "desk" ? "lounge" : "desk");
      const e = easeInOut(this.p);
      this.root.position.y = THREE.MathUtils.lerp(from.y, 0, e);
      this.hip = THREE.MathUtils.lerp(-90 * DEG, 0, e);
      if (this.p >= 1) { this.phase = "walk"; }
    } else if (this.phase === "walk") {
      walking = true;
      this.root.position.y = 0;
      this.hip = 0;
      let step = 4 * dt; // 4 u/s
      while (step > 0 && this.next < this.path.length) {
        const target = this.path[this.next];
        const dx = target.x - this.pos.x, dz = target.y - this.pos.y;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4) {
          const desired = Math.atan2(dx, dz);
          this.yaw += wrapAngle(desired - this.yaw) * Math.min(1, dt / 0.15);
        }
        if (dist <= step) { this.pos.copy(target); this.next += 1; step -= dist; }
        else { this.pos.x += (dx / dist) * step; this.pos.y += (dz / dist) * step; step = 0; }
      }
      if (this.next >= this.path.length) { this.phase = "lower"; this.p = 0; }
    } else if (this.phase === "lower") {
      this.p = Math.min(1, this.p + dt / 0.3);
      const e = easeInOut(this.p);
      this.root.position.y = THREE.MathUtils.lerp(0, st.y, e);
      this.hip = THREE.MathUtils.lerp(0, -90 * DEG, e);
      this.yaw += wrapAngle(st.yaw - this.yaw) * Math.min(1, dt / 0.15);
      if (this.p >= 1) { this.phase = "sit"; this.yaw = st.yaw; }
    } else {
      this.root.position.y = st.y;
      this.hip = -90 * DEG;
      this.pos.set(st.x, st.z);
      this.yaw = st.yaw;
    }
    this.root.position.x = this.pos.x;
    this.root.position.z = this.pos.y;
    this.root.rotation.y = this.yaw;

    // Limbs: the base pose is smoothed; the oscillation is added unfiltered so amplitudes match the spec.
    const seatedHere = this.phase === "sit";
    let base = 0, oscL = 0, oscR = 0, headX = 0, headY = 0, neckY = 3.5, legSwing = 0;
    if (walking && !rm) {
      const s = Math.sin((TAU * t) / 0.6);
      legSwing = 30 * DEG * s;
      oscL = 20 * DEG * s; oscR = -20 * DEG * s;   // arms opposite to legs
    } else if (seatedHere && this.state === "working") {
      base = -60 * DEG;
      const s = rm ? 0 : Math.sin((TAU * t) / 0.5);
      oscL = 15 * DEG * s; oscR = -15 * DEG * s;
      headX = rm ? 0 : 3 * DEG * Math.sin((TAU * t) / 1);
    } else if (seatedHere && this.state === "reviewing") {
      base = -50 * DEG;
      headY = rm ? 0 : 10 * DEG * Math.sin((TAU * t) / 3);
      headX = 8 * DEG;
    } else if (seatedHere && this.state === "idle") {
      neckY = 3.5 + (rm ? 0 : 0.05 * Math.sin((TAU * t) / 2));
    }
    const k = instant ? 1 : approach(dt, 12);
    this.armBase += (base - this.armBase) * k;
    this.shL.rotation.x = this.armBase + oscL;
    this.shR.rotation.x = this.armBase + oscR;
    this.hipL.rotation.x = this.hip + legSwing;
    this.hipR.rotation.x = this.hip - legSwing;
    // Head: oscillating motions (working nod, reviewing scan) are set directly; settling is smoothed.
    const headDirect = seatedHere && (this.state === "working" || this.state === "reviewing") && !rm;
    this.neck.rotation.x = headDirect && this.state === "working" ? headX : this.neck.rotation.x + (headX - this.neck.rotation.x) * k;
    this.neck.rotation.y = headDirect && this.state === "reviewing" ? headY : this.neck.rotation.y + (headY - this.neck.rotation.y) * k;
    this.neck.position.y = neckY;

    // Colors (spec 7.3): idle = base × 0.8; offline = gray setScalar(0.4), accessory emissive off.
    const state = this.state;
    this.applyColors(dt, (r, c, e) => {
      if (state === "offline") { c.setScalar(0.4); e.copy(BLACK); return; }
      c.copy(r.base);
      e.copy(r.emis);
      if (state === "idle") c.multiplyScalar(0.8);
    }, instant);

    this.updateQBox(dt, t, state === "unknown");
    this.tag.position.y = this.qScale > 0.5 ? 6.05 : 5.4;
  }
}

// =====================================================================================
// Claude Code CLI robot (spec 7.2 table)
// =====================================================================================
export class Robot extends BaseCharacter {
  state: RobotState = "unknown";
  shL = new THREE.Group(); shR = new THREE.Group();
  private led!: THREE.MeshLambertMaterial;
  private armBase = 0;
  private prompt!: THREE.Mesh;

  constructor(o: CharacterOpts, geo: GeoCache) {
    super(o, geo);
    const r = this.root;
    this.box(r, 1.2, 0.4, 0.9, 0, 0.2, 0, this.mat("#374151"));
    const wheel = this.mat("#1F2937");
    this.box(r, 0.15, 0.3, 0.95, 0.62, 0.2, 0, wheel);
    this.box(r, 0.15, 0.3, 0.95, -0.62, 0.2, 0, wheel);
    this.box(r, 1.2, 1.2, 0.8, 0, 1.0, 0, this.mat("#F97316"));
    this.box(r, 0.6, 0.4, 0.02, 0, 1.05, 0.41, this.mat("#C2410C"));
    this.led = this.mat("#1F2937", "led");
    this.box(r, 0.1, 0.1, 0.02, 0.18, 1.15, 0.42, this.led);
    const arm = this.mat("#9CA3AF");
    this.shL.position.set(-0.75, 1.45, 0); this.shR.position.set(0.75, 1.45, 0);
    this.box(this.shL, 0.3, 0.9, 0.3, 0, -0.3, 0, arm);
    this.box(this.shR, 0.3, 0.9, 0.3, 0, -0.3, 0, arm);
    r.add(this.shL, this.shR);
    this.box(r, 1.0, 0.8, 0.8, 0, 2.0, 0, this.mat("#2B2F3A"));
    this.box(r, 0.8, 0.5, 0.02, 0, 2.0, 0.41, this.mat("#111827"));
    const eye = this.mat("#FDBA74", "eye", "#FDBA74", 1.0);
    this.box(r, 0.15, 0.15, 0.02, 0.2, 2.05, 0.42, eye);
    this.box(r, 0.15, 0.15, 0.02, -0.2, 2.05, 0.42, eye);
    this.prompt = this.box(r, 0.25, 0.05, 0.02, 0, 1.85, 0.42, this.mat("#FDBA74", "prompt", "#FDBA74", 1.0));
    this.box(r, 0.08, 0.5, 0.08, 0, 2.65, 0, arm);
    this.box(r, 0.2, 0.2, 0.2, 0, 3.0, 0, this.mat("#F97316", "antenna", "#F97316", 1.0));
    r.position.set(...ROBOT_POS);
    this.qBaseY = 3.55;
    this.finishQBox(this.qBaseY);
    this.tag.position.set(0, 3.7, 0);
    r.add(this.tag);
  }

  headY() { return 2.0; }

  setState(s: RobotState) { this.state = s; }

  update(dt: number, time: number, instant = false) {
    const t = time + this.index * 0.37;
    const rm = this.reducedMotion;
    const running = this.state === "running";
    const s = running && !rm ? Math.sin((TAU * t) / 0.3) : 0;
    const k = instant ? 1 : approach(dt, 12);
    this.armBase += ((running ? -80 * DEG : 0) - this.armBase) * k;
    this.shL.rotation.x = this.armBase + 20 * DEG * s;
    this.shR.rotation.x = this.armBase - 20 * DEG * s;
    this.prompt.visible = !running || rm || Math.floor(t / 0.5) % 2 === 0;
    const pulse = running && !rm ? 0.75 + 0.25 * Math.sin((TAU * t) / 1) : 1;
    const state = this.state;
    this.applyColors(dt, (r, c, e) => {
      if (state === "not_running") {
        c.setScalar(0.45);
        e.copy(BLACK);
        return;
      }
      c.copy(r.base);
      e.copy(r.emis);
      if (r.role === "antenna") e.multiplyScalar(pulse);
      if (r.role === "led") { if (running) { c.set("#22C55E"); e.set("#22C55E"); } else e.copy(BLACK); }
    }, instant);
    this.updateQBox(dt, t, state === "unknown");
    this.tag.position.y = this.qScale > 0.5 ? 4.45 : 3.7;
  }
}

export type Character = Human | Robot;
