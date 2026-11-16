// Minecraft-style characters (spec 7.1–7.5). BoxGeometry + MeshLambertMaterial(flatShading), no
// textures. Each character is a root Group with pivot groups; animation only moves pivots.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { deskToLounge, DESKS, floorOfY, floorY, loungeSpotFor, ROBOT_POS, type FloorId, type LoungeSpot, type Spot } from "./layout";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export type HumanState = "working" | "reviewing" | "idle" | "offline" | "unknown";
export type RobotState = "running" | "not_running" | "unknown";

// ---------- shared geometry cache (one geometry instance per unique size) ----------
export class GeoCache {
  private map = new Map<string, THREE.BufferGeometry>();
  get(w: number, h: number, d: number) {
    const k = `${w},${h},${d}`;
    let g = this.map.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); this.map.set(k, g); }
    return g;
  }
  /** Any other shared geometry, built once per key. */
  named(key: string, make: () => THREE.BufferGeometry) {
    let g = this.map.get(key);
    if (!g) { g = make(); this.map.set(key, g); }
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
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const TV_AT: [number, number] = [-19.7, -7.0]; // TV screen center (x, z), spec 4.1 "TV look"

function approach(dt: number, rate = 5) { return 1 - Math.exp(-dt * rate); }
function easeInOut(p: number) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
function wrapAngle(a: number) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

// ---------- "?" box (spec 7.4) ----------
const Q_BITMAP = [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."];
function questionBox(geo: GeoCache, mk: (hex: string, role?: Role, e?: string, ei?: number) => THREE.MeshLambertMaterial) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo.get(0.6, 0.6, 0.6), mk("#6B7280")));
  // The "?" glyph pixels (both faces, 18 boxes) are merged into ONE cached geometry (tech plan 6.2):
  // 2 draw calls per box instead of 19.
  const glyph = geo.named("qglyph", () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      Q_BITMAP.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch === "#") parts.push(new THREE.BoxGeometry(0.08, 0.08, 0.02).translate((c - 2) * 0.09 * side, (3 - r) * 0.09, side * 0.31));
      }));
    }
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    return merged;
  });
  g.add(new THREE.Mesh(glyph, mk("#E8EAF0", "normal", "#E8EAF0", 0.3)));
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

  private tagArgs: [string, string, string, boolean] | null = null;
  protected activity: string | null = null;
  setTag(name: string, status: string, dot: string, dim: boolean) {
    const same = this.tagArgs && this.tagArgs.join("|") === [name, status, dot, dim].join("|");
    this.tagArgs = [name, status, dot, dim];
    if (!same) this.renderTag();
  }
  protected renderTag() {
    if (!this.tagArgs) return;
    const [name, status, dot, dim] = this.tagArgs;
    this.tagEl.innerHTML = "";
    const d = document.createElement("span");
    d.style.cssText = `width:8px;height:8px;border-radius:${this instanceof Robot ? "2px" : "50%"};background:${dot};display:inline-block`;
    const n = document.createElement("span");
    n.textContent = name;
    const s = document.createElement("span");
    s.className = "st";
    s.textContent = `· ${status}${this.activity ? ` · ${this.activity}` : ""}`;
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

/** Pivot-only pose parameters (tech plan 4.5, Susi spec 4.1). */
interface PoseParams { yOff: number; hip: number; pitch: number; arm: number }
const STAND: PoseParams = { yOff: 0, hip: 0, pitch: 0, arm: 0 };
// Edge-of-daybed sit (cushion top 0.7 → yOff 0.7 − 1.25): the first half of "sit down, then lie back".
const NAP_SIT: PoseParams = { yOff: -0.55, hip: -90 * DEG, pitch: 0, arm: 0 };
function poseOf(spot: Spot): PoseParams {
  switch (spot.pose) {
    case "sit": return { yOff: spot.yOff, hip: -90 * DEG, pitch: 0, arm: spot.yOff <= -0.5 ? -20 * DEG : 0 }; // sofa: hands on lap
    case "lean": return { yOff: spot.yOff, hip: 0, pitch: 12 * DEG, arm: -45 * DEG };                     // forearms on the cap rail
    case "lie": return { yOff: spot.yOff, hip: 0, pitch: -90 * DEG, arm: 0 };                              // on the back, face up
    default: return { ...STAND, yOff: spot.yOff };
  }
}
function lerpPose(a: PoseParams, b: PoseParams, e: number, out: PoseParams) {
  out.yOff = a.yOff + (b.yOff - a.yOff) * e;
  out.hip = a.hip + (b.hip - a.hip) * e;
  out.pitch = a.pitch + (b.pitch - a.pitch) * e;
  out.arm = a.arm + (b.arm - a.arm) * e;
  return out;
}
/** Blend standing → settled pose at `spot` (e: 0 = standing, 1 = settled). Lie goes via an edge sit. */
function blendInto(spot: Spot, e: number, out: PoseParams) {
  if (spot.pose !== "lie") return lerpPose(STAND, poseOf(spot), e, out);
  return e < 0.5 ? lerpPose(STAND, NAP_SIT, e * 2, out) : lerpPose(NAP_SIT, poseOf(spot), (e - 0.5) * 2, out);
}
const settleTime = (spot: Spot) => (spot.pose === "lie" ? 0.5 : 0.3);

export class Human extends BaseCharacter {
  hipL = new THREE.Group(); hipR = new THREE.Group();
  shL = new THREE.Group(); shR = new THREE.Group();
  neck = new THREE.Group();
  state: HumanState = "unknown";
  private loc: Loc = "desk";        // where the character is (or is heading when walking)
  private phase: Phase = "sit";
  private p = 0;                    // progress for rise/lower
  private route: THREE.Vector3[] = []; // canonical desk → lounge route (world points)
  private dir: 1 | -1 = 1;              // +1 walking toward the lounge end, -1 toward the desk
  private next = 0;                     // index of the route point being walked to
  private pos = new THREE.Vector3(); // feet position on the floor surface (world)
  private yaw = 0;
  private pose: PoseParams = { ...STAND };
  private fromSpot!: Spot;          // where the current rise started
  private armBase = 0;
  private initialized = false;
  private torso!: THREE.Mesh;
  private climbPitch = 0;
  private zzz!: CSS2DObject;

  matPublic(hex: string, role: Role = "normal", e?: string, ei = 0) { return this.mat(hex, role, e, ei); }
  boxPublic(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) { return this.box(parent, w, h, d, x, y, z, m); }

  constructor(o: CharacterOpts, geo: GeoCache) {
    super(o, geo);
    this.root.rotation.order = "YXZ"; // yaw first, then pitch (lean / lie)
    const look = LOOKS[o.id];
    const shirt = this.mat(look.shirt), pants = this.mat(look.pants), skin = this.mat("#D4A373"), hair = this.mat(look.hair);
    // Legs (pivot at hip)
    this.hipL.position.set(-0.25, 1.5, 0); this.hipR.position.set(0.25, 1.5, 0);
    this.box(this.hipL, 0.5, 1.5, 0.5, 0, -0.75, 0, pants);
    this.box(this.hipR, 0.5, 1.5, 0.5, 0, -0.75, 0, pants);
    // Body
    this.torso = this.box(this.root, 1.0, 2.0, 0.5, 0, 2.5, 0, shirt);
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
    // Nap "z z z" (spec 4.2): CSS2D, no draw call; CSS animates the glyphs (static in reduced motion).
    const zz = document.createElement("div");
    zz.className = `zzz${o.reducedMotion ? " still" : ""}`;
    zz.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) { const g = document.createElement("span"); g.textContent = "z"; g.style.animationDelay = `${i * 0.8}s`; zz.append(g); }
    this.zzz = new CSS2DObject(zz);
    this.zzz.visible = false;
    this.root.add(this.zzz);
  }

  headY() { return 4.0; } // head center, root-local

  spot(loc: Loc): Spot { return loc === "desk" ? DESKS[this.id] : loungeSpotFor(this.id); }
  /** Floor the character is on right now (drives visibility and picking). */
  floor(): FloorId { return floorOfY(this.pos.y); }
  /** Seated (settled) at the desk: the desk name label hides only then. */
  atDesk() { return this.loc === "desk" && this.phase === "sit"; }
  /** Settled lounge spot, or null while walking / at the desk. */
  settledLounge(): LoungeSpot | null { return this.loc === "lounge" && this.phase === "sit" ? loungeSpotFor(this.id) : null; }

  /** Start walking the canonical desk→lounge route toward `to` from its far end. */
  private depart(to: Loc) {
    this.route = deskToLounge(this.id, this.index).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.dir = to === "lounge" ? 1 : -1;
    this.next = to === "lounge" ? 1 : this.route.length - 2;
  }

  private settle(loc: Loc) {
    const st = this.spot(loc);
    this.loc = loc; this.phase = "sit"; this.p = 1;
    this.pos.set(st.x, floorY(st.floor), st.z);
    this.yaw = st.yaw;
    Object.assign(this.pose, poseOf(st));
  }

  setState(state: HumanState) {
    this.state = state;
    const want: Loc = state === "idle" ? "lounge" : "desk";
    if (!this.initialized || this.reducedMotion) {
      // Initial load and reduced motion: appear at the destination, no walking.
      this.initialized = true;
      this.settle(want);
      this.update(0, 0, true);
      return;
    }
    if (want === this.loc) return; // already there or already heading there
    if (this.phase === "sit") {
      this.fromSpot = this.spot(this.loc);
      this.depart(want);
      this.loc = want; this.phase = "rise"; this.p = 0;
    } else if (this.phase === "lower") {
      // Was settling at the old loc; stand back up and leave.
      this.fromSpot = this.spot(this.loc);
      this.depart(want);
      this.loc = want; this.phase = "rise"; this.p = 1 - this.p;
    } else if (this.phase === "rise") {
      // Changed mind while standing up: settle back down where we are.
      this.loc = want; this.phase = "lower"; this.p = 1 - this.p;
    } else {
      // New state arrived mid-walk: turn around on the same route (no teleport). The cursor moves to
      // the other end of the current segment, so any number of flips stays on the route.
      this.loc = want;
      this.next -= this.dir;
      this.dir = this.dir === 1 ? -1 : 1;
    }
  }

  update(dt: number, time: number, instant = false) {
    const t = time + this.index * 0.37;
    const rm = this.reducedMotion;
    const st = this.spot(this.loc);
    let walking = false;

    if (this.phase === "rise") {
      this.p = Math.min(1, this.p + dt / settleTime(this.fromSpot));
      blendInto(this.fromSpot, 1 - easeInOut(this.p), this.pose);
      if (this.p >= 1) { this.phase = "walk"; }
    } else if (this.phase === "walk") {
      walking = true;
      Object.assign(this.pose, STAND);
      let step = 4 * dt; // 4 u/s along the 3D path (stair climb included)
      const inRoute = (i: number) => i >= 0 && i < this.route.length;
      const onSlope = inRoute(this.next) && inRoute(this.next - this.dir) && Math.abs(this.route[this.next].y - this.route[this.next - this.dir].y) > 0.01;
      this.climbPitch += ((onSlope && !rm ? 5 * DEG : 0) - this.climbPitch) * approach(dt, 8); // lean into the climb
      while (step > 0 && inRoute(this.next)) {
        const target = this.route[this.next];
        const dx = target.x - this.pos.x, dy = target.y - this.pos.y, dz = target.z - this.pos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (Math.hypot(dx, dz) > 1e-4) {
          const desired = Math.atan2(dx, dz);
          this.yaw += wrapAngle(desired - this.yaw) * Math.min(1, dt / 0.15);
        }
        if (dist <= step) { this.pos.copy(target); this.next += this.dir; step -= dist; }
        else { this.pos.addScaledVector(tmpV.set(dx, dy, dz), step / dist); step = 0; }
      }
      if (!inRoute(this.next)) { this.phase = "lower"; this.p = 0; }
    } else if (this.phase === "lower") {
      this.p = Math.min(1, this.p + dt / settleTime(st));
      blendInto(st, easeInOut(this.p), this.pose);
      this.yaw += wrapAngle(st.yaw - this.yaw) * Math.min(1, dt / 0.15);
      if (this.p >= 1) { this.phase = "sit"; this.yaw = st.yaw; }
    } else {
      this.pos.set(st.x, floorY(st.floor), st.z);
      this.yaw = st.yaw;
      Object.assign(this.pose, poseOf(st));
    }
    this.root.position.set(this.pos.x, this.pos.y + this.pose.yOff, this.pos.z);
    if (this.phase !== "walk") this.climbPitch += (0 - this.climbPitch) * (instant ? 1 : approach(dt, 8));
    this.root.rotation.set(this.pose.pitch + this.climbPitch, this.yaw, 0);

    // Limbs: the base pose is smoothed; the oscillation is added unfiltered so amplitudes match the spec.
    const seatedHere = this.phase === "sit";
    const zone = this.settledLounge();
    let base = this.pose.arm, oscL = 0, oscR = 0, headX = 0, headY = 0, headZ = 0, neckY = 3.5, legSwing = 0;
    let rootRoll = 0, rootBob = 0, chest = 1;
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
    } else if (zone) {
      // Idle zone loops (spec 4.2 + task brief amplitudes). Reduced motion holds the pose.
      if (zone.zone === "tv") {
        if (zone.yaw === 0) headY = THREE.MathUtils.clamp(wrapAngle(Math.atan2(TV_AT[0] - zone.x, TV_AT[1] - zone.z) - zone.yaw), -45 * DEG, 45 * DEG);
        if (!rm) {
          neckY = 3.5 + 0.03 * Math.sin((TAU * t) / 3);              // gentle head bob ±0.03 u, 3 s
          headZ = 5 * DEG * Math.sin((TAU * t) / 8);                  // head tilt ±5°, peaks every ~4 s
          const period = 12 + ((this.index * 3.7) % 8), ph = t % period; // occasional laugh: 0.4 s shoulder bounce
          if (ph < 0.4) { const b = -10 * DEG * Math.sin((Math.PI * ph) / 0.4); oscL = b; oscR = b; }
        }
      } else if (zone.zone === "balcony" && zone.pose === "lean") {
        if (!rm) {
          rootRoll = 2 * DEG * Math.sin((TAU * t) / 4);              // weight shift ±2°, 4 s
          rootBob = 0.02 * Math.sin((TAU * t) / 2.5);                 // sway ±0.02 u, 2.5 s
          headY = 15 * DEG * Math.sin((TAU * t) / 6);                 // looking at the city ±15°, 6 s
        }
      } else if (zone.zone === "balcony") {
        if (!rm) headY = 10 * DEG * Math.sin((TAU * t) / 5);         // bistro chat
      } else if (zone.zone === "nap") {
        if (!rm) {
          headX = 3 * DEG * Math.sin((TAU * t) / 4);                  // breathing ±3°, 4 s
          chest = 0.985 + 0.015 * Math.sin((TAU * t) / 4);            // chest scale 0.97–1.0, 4 s
        }
      } else if (!rm) {
        neckY = 3.5 + 0.03 * Math.sin((TAU * t) / 3);
      }
    } else if (seatedHere && this.state === "idle") {
      neckY = 3.5 + (rm ? 0 : 0.05 * Math.sin((TAU * t) / 2));
    }
    this.root.rotation.z = rootRoll;
    this.root.position.y += rootBob;
    this.torso.scale.z = chest;  // torso depth = vertical when lying on the back
    const k = instant ? 1 : approach(dt, 12);
    this.armBase += (base - this.armBase) * k;
    this.shL.rotation.x = this.armBase + oscL;
    this.shR.rotation.x = this.armBase + oscR;
    this.hipL.rotation.x = this.pose.hip + legSwing;
    this.hipR.rotation.x = this.pose.hip - legSwing;
    // Head: oscillating motions are set directly; settling into a new target is smoothed.
    const headDirect = !rm && (seatedHere && (this.state === "working" || this.state === "reviewing") || !!zone);
    this.neck.rotation.x = headDirect ? headX : this.neck.rotation.x + (headX - this.neck.rotation.x) * k;
    this.neck.rotation.y = headDirect ? headY : this.neck.rotation.y + (headY - this.neck.rotation.y) * k;
    this.neck.rotation.z = headDirect ? headZ : this.neck.rotation.z + (headZ - this.neck.rotation.z) * k;
    this.neck.position.y = neckY;

    // Tag + "z z z" sit above the head in WORLD up, whatever the pose (lying turns local +y sideways).
    if (zone?.activity !== this.activity) { this.activity = zone?.activity ?? null; this.renderTag(); }
    this.zzz.visible = zone?.zone === "nap";
    this.root.updateMatrixWorld();
    const head = this.headWorld(tmpV);
    this.tag.position.copy(this.root.worldToLocal(tmpV2.copy(head).setY(head.y + (this.qScale > 0.5 ? 2.05 : 1.4))));
    if (this.zzz.visible) this.zzz.position.copy(this.root.worldToLocal(tmpV2.copy(head).setY(head.y + 1.6)));

    // Colors (spec 7.3): idle = base × 0.8; offline = gray setScalar(0.4), accessory emissive off.
    const state = this.state;
    this.applyColors(dt, (r, c, e) => {
      if (state === "offline") { c.setScalar(0.4); e.copy(BLACK); return; }
      c.copy(r.base);
      e.copy(r.emis);
      if (state === "idle") c.multiplyScalar(0.8);
    }, instant);

    this.updateQBox(dt, t, state === "unknown");
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
  floor(): FloorId { return 0; } // the robot never leaves the Floor 0 bench (spec 11.d)

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
