// Town Hall building + site, ported from the standalone "Town Hall AI Agent – Kantor Virtual 3D" HTML
// reference (three@0.128 globals + DOM toolbar) to three@0.187 ES modules, wrapped in one factory.
//
// Port notes:
// - Floor-plan coordinates are kept verbatim: wx(px) = (px-1000)*0.02, wz(py) = (py-1010)*0.02.
// - Lights are physical since r155: reference intensities are multiplied by PI (OfficeScene3D also turns
//   colour management off while the scene lives, so hex colours / canvas textures match the r128 look).
// - Room labels are CSS2DObjects (rendered by OfficeScene3D's CSS2DRenderer) instead of hand-projected divs.
// - The reference's sample agents (AGENT_NAMES / agentAt) are NOT ported: Agent Control Center shows only real
//   agents, placed by OfficeScene3D. The 13 "Ruang Kerja" workstations on Lantai 1 get their own screen
//   material (deskScreens[]) so a desk lights up when a real agent works there.
// - Ambient townsfolk (vendors, pedestrians, satpam) stay: they are scenery, not agents.
// - The DOM toolbar is replaced by the methods on the returned TownHall object (driven by Office.tsx).
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export type FloorMode = 1 | 2 | 3 | 4 | "all" | "x";
export type Weather = "clear" | "rain" | "snow";
export type StyleNo = 1 | 2 | 3;
export type Scope = "all" | "building";

const D2R = Math.PI / 180;
const PI = Math.PI;
export const S = 0.02, OX = 1000, OY = 1010, FT = 0.2, LH = 3.3;
const WH = LH - FT, WT = 0.16;
export const wx = (p: number) => (p - OX) * S;
export const wz = (p: number) => (p - OY) * S;

/** Single-line text on a 1024x96 canvas (aspect ~10.7:1), e.g. the TransJakarta side lettering.
 *  bg = null leaves the canvas transparent (use with a transparent material). The text is scaled down to fit the width.
 *  No colorSpace is set: colour management is off in this scene and the other CanvasTextures leave it at default. */
function makeTextTex(text: string, bg: string | null, fg: string): THREE.CanvasTexture {
  const cw = 1024, ch = 96;
  const c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const x = c.getContext("2d")!;
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, cw, ch); }
  x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
  let px = 80; x.font = `800 ${px}px "Plus Jakarta Sans", Arial, sans-serif`;
  const w = x.measureText(text).width; if (w > cw * 0.94) { px = Math.floor(px * (cw * 0.94) / w); x.font = `800 ${px}px "Plus Jakarta Sans", Arial, sans-serif`; }
  x.fillText(text, cw / 2, ch / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

/** Corner floor lamps: off-ish by day, warm glow at night (setNight). */
export const LAMP = { light: 0xffd580, dayI: 0.0, nightI: 0.9, dist: 6, decay: 1.5 };

export interface THLabel { obj: CSS2DObject; floor: number; kind: "room" | "site" }
export interface TownHall {
  floors: Record<1 | 2 | 3 | 4, THREE.Group>;
  /** Target y of each floor group (animated towards by update()). */
  yTarget: Record<number, number>;
  /** Screen materials of the 13 tracked Lantai 1 desks (0-4 west row, 5-10 east row, 11-12 manager rooms). */
  deskScreens: THREE.MeshLambertMaterial[];
  cornerLamps: THREE.PointLight[];
  labels: THLabel[];
  readonly mode: FloorMode;
  readonly night: boolean;
  readonly style: StyleNo;
  readonly lowWalls: boolean;
  readonly scope: Scope;
  setMode(m: FloorMode): void;
  setNight(n: boolean): void;
  applyStyle(n: StyleNo): void;
  setWeather(w: Weather): void;
  setScope(s: Scope): void;
  setClouds(on: boolean): void;
  setLow(on: boolean): void;
  setWood(on: boolean): void;
  setVendors(on: boolean): void;
  /** Reference labelVisible(): which floor's room labels are readable in the current mode. */
  labelVisible(floor: number): boolean;
  update(dt: number, t: number, target: THREE.Vector3): void;
}

type Col = string | THREE.Material;
interface WallOpt { out?: number; conc?: number; h?: number; t?: number; base?: number; c?: string; cap?: string; gaps?: number[][]; noLintel?: number }
interface PatchOpt { tile?: boolean; th?: number; y?: number }
interface PersonOpt { sit?: boolean; shirt?: string; pants?: string; hair?: string; hairStyle?: string }

export function createTownHall(scene: THREE.Scene, shadowSize = 4096): TownHall {
  const C = {
    wall: "#d9d6d0", wallD: "#3e4448", cap: "#2b2e31", olive: "#77735a", slabSide: "#a3a8ae", metal: "#3a3f46", black: "#23272c",
    skin: "#f1c7a1", grass: "#86cf5f", white: "#f4f5f6", frame: "#2b2e31",
  };
  // Colour remaps following the reference's vibe (oak, black, warm grey, cognac, olive)
  const FLOOR_MAP: Record<string, string> = { "#9b3a3a": "#3d3f42", "#8a3a44": "#3d3f42", "#535a64": "#3d3f42", "#4f7192": "#b8a68c", "#cdb68a": "#b8a68c", "#2f6a64": "#6f6b4f", "#2c4a7a": "#4a4d52", "#9cc48a": "#8c8a6a", "#d7c39a": "#c9b89a", "#2d3f8f": "#34495e", "#e08a5c": "#a0623a", "#a9cf8f": "#8c8a6a" };
  const SOFA_MAP: Record<string, string> = { "#5d7aa0": "#8a4b2a", "#3e5f86": "#6e3c22", "#7a8c5d": "#8b6f6a", "#4f7a5a": "#8b6f6a", "#4a5a6a": "#8a4b2a", "#3d8f88": "#8b6f6a", "#c9875a": "#a0623a", "#e0b04a": "#8b6f6a", "#d0a15a": "#a0623a" };
  const CHAIR_MAP: Record<string, string> = { "#c9875a": "#1f2124", "#3b4350": "#1f2124", "#2f3540": "#1f2124", "#3f444b": "#1f2124", "#2aa7d8": "#1f2124" };

  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  /* ====== Scene / lights ====== */
  scene.background = new THREE.Color("#bfe6f6");
  scene.fog = new THREE.Fog("#bfe6f6", 110, 230);
  const hemi = new THREE.HemisphereLight("#ffffff", "#8fae7a", 0.62 * PI); scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff4e2", 0.85 * PI);
  sun.position.set(26, 46, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -82, right: 82, top: 82, bottom: -82, near: 1, far: 240 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);

  /* ====== Material helpers ====== */
  const mats: Record<string, THREE.MeshLambertMaterial> = {};
  function mat(c: string, o?: THREE.MeshLambertMaterialParameters) {
    const k = c + (o ? JSON.stringify(o) : "");
    if (!mats[k]) mats[k] = new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
    return mats[k];
  }
  const M = (c: Col): THREE.Material => (typeof c === "string" ? mat(c) : c);
  const winMat = new THREE.MeshLambertMaterial({ color: "#9fd2ea", emissive: "#000000" });
  const screenMat = new THREE.MeshLambertMaterial({ color: "#1d3b5c", emissive: "#2f7fd0", emissiveIntensity: 0.55 });
  const lampMat = new THREE.MeshLambertMaterial({ color: "#fff1cf", emissive: "#ffd98a", emissiveIntensity: 0.15 });
  const glassMat = new THREE.MeshLambertMaterial({ color: "#b5e1f2", transparent: true, opacity: 0.3, depthWrite: false });
  const facadeGlass = new THREE.MeshLambertMaterial({ color: "#8fc6e4", emissive: "#000000", transparent: true, opacity: 0.42, depthWrite: false });
  const glowCv = document.createElement("canvas"); glowCv.width = glowCv.height = 64;
  {
    const x = glowCv.getContext("2d")!; const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,220,150,1)"); gr.addColorStop(0.35, "rgba(255,200,120,.45)"); gr.addColorStop(1, "rgba(255,190,110,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }
  const glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCv), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true });
  const glowSprites: THREE.Sprite[] = []; let nightOn = false;
  const stripeMat = new THREE.MeshLambertMaterial({ color: "#41c8f5", emissive: "#2aa7d8", emissiveIntensity: 0.6 });
  function tint(c: string, a: number) { const x = new THREE.Color(c); x.lerp(new THREE.Color("#ffffff"), a); return "#" + x.getHexString(); }

  const UB = new THREE.BoxGeometry(1, 1, 1);
  function bx(p: THREE.Object3D, w: number, h: number, d: number, c: Col, x = 0, y = 0, z = 0, sh?: boolean) {
    const m = new THREE.Mesh(UB, M(c));
    m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
    m.castShadow = sh !== undefined ? sh : h > 0.3 && Math.max(w, d) > 0.25; m.receiveShadow = true; p.add(m); return m;
  }
  const cylG: Record<string, THREE.CylinderGeometry> = {};
  function cy(p: THREE.Object3D, rt: number, rb: number, h: number, c: Col, x = 0, y = 0, z = 0, seg = 12, sh?: boolean) {
    const k = rt + "_" + rb + "_" + h + "_" + seg;
    const g = cylG[k] || (cylG[k] = new THREE.CylinderGeometry(rt, rb, h, seg));
    const m = new THREE.Mesh(g, M(c));
    m.position.set(x, y + h / 2, z); m.castShadow = sh !== undefined ? sh : true; m.receiveShadow = true; p.add(m); return m;
  }
  function ico(p: THREE.Object3D, r: number, c: string, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; p.add(m); return m;
  }
  const G = () => new THREE.Group();
  function add<T extends THREE.Object3D>(p: THREE.Object3D, ch: T, x = 0, z = 0, rot = 0, y = 0): T {
    ch.position.set(x, y, z); ch.rotation.y = rot * D2R; p.add(ch); return ch;
  }
  function put<T extends THREE.Object3D>(g: THREE.Object3D, ch: T, px: number, py: number, rot = 0, y?: number): T {
    return add(g, ch, wx(px), wz(py), rot, y === undefined ? FT : y);
  }

  /* ====== Textures ====== */
  function woodCanvas() {
    const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d")!;
    const rows = 10, h = 512 / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 170 + rnd() * 60; let cx = -off;
      while (cx < 512) {
        const len = 160 + rnd() * 120; const l = 48 + rnd() * 8;
        x.fillStyle = `hsl(27,${46 + rnd() * 8}%,${l}%)`; x.fillRect(cx, r * h, len, h);
        x.fillStyle = "rgba(120,70,35,.35)"; x.fillRect(cx, r * h, 2, h); cx += len;
      }
      x.fillStyle = "rgba(110,62,30,.45)"; x.fillRect(0, r * h, 512, 2);
    }
    return c;
  }
  const WOOD = woodCanvas();
  function floorTileCanvas() {
    const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d")!;
    x.fillStyle = "#c8c2b8"; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 3500; i++) { const v = 180 + Math.floor(rnd() * 40); x.fillStyle = `rgba(${v},${v - 4},${v - 10},.25)`; x.fillRect(rnd() * 512, rnd() * 512, 3, 3); }
    x.fillStyle = "rgba(90,85,78,.35)"; for (let i = 0; i <= 512; i += 128) x.fillRect(0, i, 512, 2);
    for (let j = 0; j < 4; j++) for (let i = 0; i <= 512; i += 256) x.fillRect((i + (j % 2) * 128) % 512, j * 128, 2, 128);
    return c;
  }
  const FLOORTILE = floorTileCanvas();
  const slabTops: { top: THREE.MeshLambertMaterial; tw: THREE.Texture; tt: THREE.Texture; t2?: THREE.Texture }[] = [];
  let woodFloor = false;
  const tileCache: Record<string, HTMLCanvasElement> = {};
  function tileCanvas(col: string) {
    if (tileCache[col]) return tileCache[col];
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!;
    x.fillStyle = col; x.fillRect(0, 0, 128, 128); x.strokeStyle = "rgba(0,0,0,.10)"; x.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
    return (tileCache[col] = c);
  }
  function texFrom(cv: HTMLCanvasElement, rx: number, ry: number) { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t; }

  /* ====== Labels ====== */
  const labels: THLabel[] = [];
  let CUR = 1;
  function roomLabel(g: THREE.Object3D, text: string, px: number, py: number, h?: number) {
    const el = document.createElement("div"); el.className = "lbl " + (CUR === 0 ? "site" : "room"); el.textContent = text;
    const o = new CSS2DObject(el); o.center.set(0.5, 1); o.position.set(wx(px), FT + (h || 2.3), wz(py)); g.add(o);
    labels.push({ obj: o, floor: CUR, kind: CUR === 0 ? "site" : "room" });
  }

  /* ====== Structure: slabs, walls, glass, railings ====== */
  const concList: THREE.MeshLambertMaterial[] = [], tileList: THREE.MeshLambertMaterial[] = [];
  function slab(g: THREE.Object3D, rects: number[][]) {
    for (const r of rects) {
      const w = (r[2] - r[0]) * S, d = (r[3] - r[1]) * S;
      const tw = texFrom(WOOD, w / 3.2, d / 3.2), tt = texFrom(FLOORTILE, w / 2.4, d / 2.4);
      const top = new THREE.MeshLambertMaterial({ map: woodFloor ? tw : tt }); slabTops.push({ top, tw, tt });
      const side = mat(C.slabSide);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, FT, d), [side, side, top, side, side, side]);
      m.position.set(wx((r[0] + r[2]) / 2), FT / 2, wz((r[1] + r[3]) / 2)); m.receiveShadow = true; g.add(m);
    }
  }
  function patch(g: THREE.Object3D, x1: number, y1: number, x2: number, y2: number, c: string, o: PatchOpt = {}) {
    c = FLOOR_MAP[c] || c; const w = (x2 - x1) * S, d = (y2 - y1) * S, th = o.th || 0.02, y = o.y !== undefined ? o.y : FT;
    let m: THREE.Mesh;
    if (o.tile) { const tm = new THREE.MeshLambertMaterial({ map: texFrom(tileCanvas(c), w / 1.2, d / 1.2) }); m = new THREE.Mesh(UB, tm); tileList.push(tm); }
    else m = new THREE.Mesh(UB, mat(c));
    m.scale.set(w, th, d); m.position.set(wx((x1 + x2) / 2), y + th / 2, wz((y1 + y2) / 2)); m.receiveShadow = true; g.add(m); return m;
  }
  function segments(a: number, b: number, gaps?: number[][]) {
    const gs = (gaps || []).slice().sort((p, q) => p[0] - q[0]); const out: number[][] = []; let cur = a;
    for (const [g0, g1] of gs) { if (g0 > cur) out.push([cur, g0]); cur = Math.max(cur, g1); }
    if (cur < b) out.push([cur, b]); return out;
  }
  let CONC: HTMLCanvasElement | null = null;
  const wallSubs: { sub: THREE.Group; h: number }[] = [], lowHide: THREE.Object3D[] = [];
  const LOW = 1.15; let lowWalls = false;
  function regSub(sub: THREE.Group, h: number) { if (CUR !== 0) wallSubs.push({ sub, h }); }
  function wall(g: THREE.Object3D, x1: number, y1: number, x2: number, y2: number, o: WallOpt = {}) {
    if (o.out) o = Object.assign({}, o, { out: 0, conc: 1 });
    const h = o.h || WH, t = o.t || WT, base = o.base !== undefined ? o.base : FT, col = o.c || C.wall, cap = o.cap || C.cap;
    const hz = y1 === y2; const a = hz ? Math.min(x1, x2) : Math.min(y1, y2), b = hz ? Math.max(x1, x2) : Math.max(y1, y2);
    const mm = [mat(col), mat(col), mat(cap), mat(col), mat(col), mat(col)];
    const sub = G(); sub.position.y = base; g.add(sub); regSub(sub, h);
    for (const [s0, s1] of segments(a, b, o.gaps)) {
      const len = (s1 - s0) * S + t, c = (s0 + s1) / 2;
      let ms: THREE.Material[] = mm;
      if (o.conc) {
        CONC = CONC || concreteCanvas(); const cm = new THREE.MeshLambertMaterial({ map: texFrom(CONC, len / 4, h / 5) }); concList.push(cm);
        ms = [cm, cm, mat(C.cap), cm, cm, cm];
      }
      const m = new THREE.Mesh(UB, ms); m.castShadow = true; m.receiveShadow = true;
      if (hz) { m.scale.set(len, h, t); m.position.set(wx(c), h / 2, wz(y1)); }
      else { m.scale.set(t, h, len); m.position.set(wx(x1), h / 2, wz(c)); }
      sub.add(m);
    }
    if (h > 2.5 && !o.noLintel) {
      for (const [g0, g1] of o.gaps || []) {
        const len = (g1 - g0) * S, c = (g0 + g1) / 2, lh = h - 2.25; const m = new THREE.Mesh(UB, mm); m.receiveShadow = true;
        if (hz) { m.scale.set(len, lh, t); m.position.set(wx(c), 2.25 + lh / 2, wz(y1)); }
        else { m.scale.set(t, lh, len); m.position.set(wx(x1), 2.25 + lh / 2, wz(c)); }
        sub.add(m); lowHide.push(m);
      }
    }
  }
  // Glass partition / curtain wall
  function glassWall(g: THREE.Object3D, x1: number, y1: number, x2: number, y2: number, o: { h?: number; frame?: string; facade?: number; gaps?: number[][] } = {}) {
    const h = o.h || WH, hz = y1 === y2; const a = hz ? Math.min(x1, x2) : Math.min(y1, y2), b = hz ? Math.max(x1, x2) : Math.max(y1, y2);
    const sub = G(); sub.position.y = FT; g.add(sub); regSub(sub, h);
    const fm = mat(o.frame || C.metal);
    for (const [s0, s1] of segments(a, b, o.gaps)) {
      const len = (s1 - s0) * S, c = (s0 + s1) / 2;
      const pane = new THREE.Mesh(UB, o.facade ? facadeGlass : glassMat); pane.renderOrder = 2;
      const pos = hz ? [wx(c), wz(y1)] : [wx(x1), wz(c)];
      if (hz) pane.scale.set(len, h, 0.04); else pane.scale.set(0.04, h, len);
      pane.position.set(pos[0], h / 2, pos[1]); sub.add(pane);
      const bars = o.facade ? [0, 1.05, h - 0.08] : [0, h - 0.06];
      for (const yy of bars) { const f = new THREE.Mesh(UB, fm); if (hz) f.scale.set(len, 0.07, 0.1); else f.scale.set(0.1, 0.07, len); f.position.set(pos[0], yy + 0.035, pos[1]); sub.add(f); }
      const n = Math.max(1, Math.round(len / (o.facade ? 1.5 : 1.3)));
      for (let i = 0; i <= n; i++) {
        const off = -len / 2 + (len * i) / n; const f = new THREE.Mesh(UB, fm);
        if (hz) { f.scale.set(0.07, h, 0.1); f.position.set(pos[0] + off, h / 2, pos[1]); } else { f.scale.set(0.1, h, 0.07); f.position.set(pos[0], h / 2, pos[1] + off); }
        sub.add(f);
      }
    }
  }
  function railing(g: THREE.Object3D, x1: number, y1: number, x2: number, y2: number, hh?: number) {
    const h = hh || 1.05, hz = y1 === y2; const len = hz ? Math.abs(x2 - x1) * S : Math.abs(y2 - y1) * S;
    const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2);
    const p = new THREE.Mesh(UB, glassMat); p.renderOrder = 2; if (hz) p.scale.set(len, h - 0.1, 0.03); else p.scale.set(0.03, h - 0.1, len); p.position.set(cx, FT + (h - 0.1) / 2 + 0.04, cz); g.add(p);
    const r = new THREE.Mesh(UB, mat(C.metal)); if (hz) r.scale.set(len, 0.06, 0.08); else r.scale.set(0.08, 0.06, len); r.position.set(cx, FT + h, cz); g.add(r);
    const n = Math.max(1, Math.round(len / 1.5));
    for (let i = 0; i <= n; i++) {
      const off = -len / 2 + (len * i) / n; const q = new THREE.Mesh(UB, mat(C.metal)); q.scale.set(0.05, h, 0.05);
      q.position.set(hz ? cx + off : cx, FT + h / 2, hz ? cz : cz + off); g.add(q);
    }
  }
  const slopeX = (dz: number) => (dz > 0 ? -Math.atan2(LH, dz) : Math.atan2(LH, -dz));
  // Floating straight stairs (treads + sloped stringer), rising from yStart to yEnd (px)
  function stairs(g: THREE.Object3D, x1: number, x2: number, yStart: number, yEnd: number, railSide?: number) {
    const n = 16, run = (yEnd - yStart) / n, w = (x2 - x1) * S, cx = wx((x1 + x2) / 2), rz = Math.abs(run) * S;
    for (let i = 0; i < n; i++) {
      const top = ((i + 1) * LH) / n; const yc = yStart + run * (i + 0.5);
      bx(g, w, 0.22, rz + 0.01, i % 2 ? "#8d959e" : "#99a1aa", cx, FT + top - 0.22, wz(yc), true);
      bx(g, w, 0.03, rz + 0.02, "#c98a52", cx, FT + top - 0.01, wz(yc), false);
    }
    const z0 = wz(yStart), z1 = wz(yEnd), dz = z1 - z0, L = Math.sqrt(dz * dz + LH * LH);
    const st = new THREE.Mesh(UB, mat("#7d838b")); st.scale.set(w, 0.2, L); st.position.set(cx, FT + LH / 2 - 0.2, (z0 + z1) / 2); st.rotation.x = slopeX(dz); st.castShadow = true; g.add(st);
    if (railSide !== undefined) {
      const xr = wx(railSide);
      const r = new THREE.Mesh(UB, mat(C.metal)); r.scale.set(0.06, 0.06, L); r.position.set(xr, FT + LH / 2 + 0.95, (z0 + z1) / 2); r.rotation.x = slopeX(dz); g.add(r);
      for (let i = 0; i <= n; i += 3) { const zz = z0 + (dz * i) / n, hh = (i * LH) / n; bx(g, 0.05, 0.95, 0.05, C.metal, xr, FT + hh, zz, false); }
    }
  }

  /* ====== Furniture (faces -z / north at rot 0) ====== */
  function Chair(c?: string) {
    const o = G(); c = CHAIR_MAP[c || "#2f3540"] || c || "#2f3540"; cy(o, 0.24, 0.24, 0.04, "#2a2e35", 0, 0, 0, 8, false); cy(o, 0.03, 0.03, 0.4, "#5a6068", 0, 0.04, 0, 6, false);
    bx(o, 0.48, 0.08, 0.46, c, 0, 0.42, 0); bx(o, 0.46, 0.5, 0.07, c, 0, 0.5, 0.21); return o;
  }
  function Stool(c?: string) {
    const o = G(); cy(o, 0.16, 0.16, 0.03, C.metal, 0, 0, 0, 10, false); cy(o, 0.03, 0.03, 0.66, "#8a9097", 0, 0.03, 0, 6, false);
    cy(o, 0.19, 0.19, 0.06, CHAIR_MAP[c || "#3f444b"] || c || "#3f444b", 0, 0.68, 0, 12); return o;
  }
  function Monitor(o: THREE.Object3D, x: number, z: number, sm: THREE.Material = screenMat) {
    bx(o, 0.06, 0.12, 0.06, C.black, x, 0.76, z, false); bx(o, 0.62, 0.38, 0.03, C.black, x, 0.86, z, false); bx(o, 0.56, 0.32, 0.006, sm, x, 0.89, z + 0.018, false);
  }
  const HAIRS = ["short", "long", "bun", "ponytail", "spiky", "bob", "buzz", "long", "short", "bob"];
  function hairFor(o: THREE.Object3D, st: string, c: string, hy: number, hh: number, hw: number, zo: number) {
    const top = hy + hh, bz = zo + hw / 2;
    const topc = () => bx(o, hw + 0.02, 0.1, hw + 0.02, c, 0, top - 0.02, zo + 0.01, false);
    switch (st) {
      case "long": topc(); bx(o, hw + 0.04, 0.52, 0.1, c, 0, top - 0.5, bz + 0.01, false); for (const s of [-1, 1]) bx(o, 0.05, 0.36, hw * 0.8, c, s * (hw / 2 + 0.02), top - 0.36, zo + 0.03, false); break;
      case "bun": topc(); bx(o, hw + 0.02, 0.2, 0.08, c, 0, top - 0.2, bz - 0.02, false); bx(o, 0.14, 0.12, 0.14, c, 0, top + 0.06, zo + 0.07, false); break;
      case "ponytail": topc(); bx(o, hw + 0.02, 0.16, 0.08, c, 0, top - 0.16, bz - 0.02, false); bx(o, 0.09, 0.32, 0.09, c, 0, top - 0.38, bz + 0.06, false); break;
      case "spiky": topc(); [[-0.09, -0.06], [0.09, -0.06], [0, 0.05], [-0.06, 0.1], [0.07, 0.1]].forEach((a) => bx(o, 0.07, 0.1, 0.07, c, a[0], top + 0.05, zo + a[1], false)); break;
      case "bob": topc(); for (const s of [-1, 1]) bx(o, 0.06, 0.24, hw * 0.9, c, s * (hw / 2 + 0.025), top - 0.26, zo + 0.02, false); bx(o, hw + 0.05, 0.26, 0.08, c, 0, top - 0.26, bz, false); break;
      case "buzz": bx(o, hw + 0.01, 0.04, hw + 0.01, c, 0, top - 0.01, zo, false); break;
      default: topc(); bx(o, hw + 0.02, 0.2, 0.08, c, 0, top - 0.2, bz - 0.02, false);
    }
  }
  let hairI = 0;
  function Person(opt: PersonOpt = {}) {
    const o = G(); const sh = opt.shirt || "#4a78b5", pa = opt.pants || "#2f3540", hr = opt.hair || "#2d2420";
    if (opt.sit) {
      for (const s of [-1, 1]) { bx(o, 0.14, 0.13, 0.42, pa, s * 0.09, 0.47, -0.17); bx(o, 0.13, 0.47, 0.13, pa, s * 0.09, 0, -0.38); bx(o, 0.14, 0.06, 0.2, "#222", s * 0.09, 0, -0.42, false); }
      bx(o, 0.42, 0.55, 0.24, sh, 0, 0.55, 0.02);
      for (const s of [-1, 1]) { bx(o, 0.11, 0.42, 0.12, sh, s * 0.27, 0.66, 0.0, false); bx(o, 0.1, 0.1, 0.32, C.skin, s * 0.27, 0.68, -0.17, false); }
      bx(o, 0.28, 0.3, 0.28, C.skin, 0, 1.1, 0.02); hairFor(o, opt.hairStyle || HAIRS[hairI++ % HAIRS.length], hr, 1.1, 0.3, 0.28, 0.02);
      for (const s of [-1, 1]) bx(o, 0.05, 0.05, 0.01, "#1d1d1d", s * 0.065, 1.24, -0.125, false);
    } else {
      const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
      for (const s of [-1, 1]) { const lp = G(); lp.position.set(s * 0.1, 0.8, 0); o.add(lp); bx(lp, 0.15, 0.8, 0.16, pa, 0, -0.8, 0); bx(lp, 0.16, 0.06, 0.22, "#222", 0, -0.8, -0.03, false); legs.push(lp); }
      bx(o, 0.44, 0.6, 0.26, sh, 0, 0.8, 0);
      for (const s of [-1, 1]) { const ap = G(); ap.position.set(s * 0.29, 1.38, 0); o.add(ap); bx(ap, 0.11, 0.56, 0.13, sh, 0, -0.56, 0, false); bx(ap, 0.1, 0.1, 0.1, C.skin, 0, -0.64, 0, false); arms.push(ap); }
      o.userData.legs = legs; o.userData.arms = arms;
      bx(o, 0.3, 0.32, 0.3, C.skin, 0, 1.4, 0); hairFor(o, opt.hairStyle || HAIRS[hairI++ % HAIRS.length], hr, 1.4, 0.32, 0.3, 0);
      for (const s of [-1, 1]) bx(o, 0.05, 0.05, 0.01, "#1d1d1d", s * 0.07, 1.57, -0.152, false);
    }
    return o;
  }
  const style2Only: THREE.Object3D[] = [], style3Only: THREE.Object3D[] = [], styleSwap: THREE.Object3D[][] = [];
  let styleNo: StyleNo = 1;
  function sph(o: THREE.Object3D, r: number, c: string, x: number, y: number, z: number, sx?: number, sy?: number, sz?: number) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(c)); m.position.set(x, y, z); m.scale.set(sx || 1, sy || 1, sz || 1); m.castShadow = true; o.add(m); return m;
  }
  // Original felt-doll townsfolk (Style 3): bright felt head, big round eyes, yarn hair, neutral outfit
  const FELT_HEAD = ["#8fa33a", "#7a4fd1", "#1fb3a8", "#f08a2a", "#2d5fd1", "#e86a9a", "#f2b233", "#5b6f9c", "#3aa6d8", "#d9503f"];
  const FELT_HAIR = ["#8a8d7a", "#5a2fb0", "#c9ccd2", "#b5482a", "#e9cf8a", "#1f2a5a", "#f29bb8", "#d9d2c4", "#2d2a28", "#f08a2a"];
  const OUTFIT = [["#a89a88", "#6f7558"], ["#e9e2d4", "#d9d0c0"], ["#d7c9b3", "#f1ece2"], ["#efe9df", "#5c4a3a"], ["#cdbfa8", "#ece4d4"], ["#3f3a34", "#d9d0c0"]];
  function SoftPerson(opt: { sit?: boolean; i: number }) {
    const o = G(); const i = opt.i || 0;
    const head = FELT_HEAD[i % FELT_HEAD.length], hc = FELT_HAIR[(i * 3 + 1) % FELT_HAIR.length], of = OUTFIT[(i * 5 + 2) % OUTFIT.length], top = of[0], pants = of[1];
    const shoe = i % 3 ? "#f2eee6" : "#6b4a33"; let hy: number, sh: number;
    if (opt.sit) {
      for (const s of [-1, 1]) { sph(o, 0.1, pants, s * 0.1, 0.5, -0.18, 1, 1, 2.3); cy(o, 0.085, 0.095, 0.45, pants, s * 0.1, 0, -0.38, 10); sph(o, 0.09, shoe, s * 0.1, 0.05, -0.45, 1, 0.6, 1.6); }
      sph(o, 0.25, top, 0, 0.78, 0.02, 1.05, 1.2, 0.85); bx(o, 0.16, 0.06, 0.06, "#ffffff", 0, 1.0, -0.17, false);
      for (const s of [-1, 1]) { sph(o, 0.075, top, s * 0.28, 0.74, -0.12, 1, 1, 2.6); sph(o, 0.065, head, s * 0.28, 0.72, -0.32); }
      hy = 1.24; sh = 0.98;
    } else {
      const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
      for (const s of [-1, 1]) { const lp = G(); lp.position.set(s * 0.1, 0.8, 0); o.add(lp); cy(lp, 0.09, 0.11, 0.8, pants, 0, -0.8, 0, 10); sph(lp, 0.1, shoe, 0, -0.75, -0.05, 1, 0.6, 1.6); legs.push(lp); }
      sph(o, 0.27, top, 0, 1.07, 0, 1.05, 1.3, 0.85); bx(o, 0.16, 0.06, 0.06, "#ffffff", 0, 1.36, -0.18, false);
      for (const s of [-1, 1]) { const ap = G(); ap.position.set(s * 0.31, 1.25, 0); o.add(ap); sph(ap, 0.075, top, 0, -0.25, 0, 1, 3.4, 1); sph(ap, 0.065, head, 0, -0.51, 0); arms.push(ap); }
      o.userData.legs = legs; o.userData.arms = arms;
      hy = 1.6; sh = 1.34;
    }
    sph(o, 0.2, head, 0, hy, 0, 0.95, 1.15, 0.95);
    for (const s of [-1, 1]) { sph(o, 0.066, "#ffffff", s * 0.07, hy + 0.05, -0.16); sph(o, 0.026, "#151515", s * 0.07, hy + 0.05, -0.222); }
    const c0 = new THREE.Vector3(0, hy, 0), up = new THREE.Vector3(0, 1, 0);
    const onHead = (phi: number, th: number, rr?: number) => new THREE.Vector3(Math.sin(phi) * Math.cos(th) * 0.19, Math.cos(phi) * 0.23, Math.sin(phi) * Math.sin(th) * 0.19).multiplyScalar(rr || 1).add(c0);
    switch (i % 7) {
      case 0: {
        for (let k = 0; k < 18; k++) {
          const phi = 0.15 + (k % 3) * 0.38, th = k * 2.4; if (Math.sin(th) < -0.35 && phi > 0.5) continue; const p = onHead(phi, th, 1); const d = p.clone().sub(c0).normalize();
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.17, 6), mat(hc)); m.position.copy(p.add(d.clone().multiplyScalar(0.06))); m.quaternion.setFromUnitVectors(up, d); m.castShadow = true; o.add(m);
        }
        break;
      }
      case 1: sph(o, 0.21, hc, 0, hy + 0.08, 0.02, 1.02, 0.72, 1.02); for (const s of [-1, 1]) sph(o, 0.07, hc, s * 0.18, hy - 0.06, 0.02, 0.7, 1.5, 1.3); sph(o, 0.2, hc, 0, hy - 0.02, 0.08, 1, 0.9, 0.6); break;
      case 2: sph(o, 0.21, hc, 0, hy + 0.08, 0.02, 1.02, 0.7, 1.02); sph(o, 0.19, hc, 0, hy - 0.25, 0.12, 1.05, 1.9, 0.55); for (const s of [-1, 1]) sph(o, 0.06, hc, s * 0.17, hy - 0.15, 0.0, 0.6, 2.2, 1); break;
      case 3: for (let k = 0; k < 14; k++) { const p = onHead(0.1 + (k % 3) * 0.42, k * 2.2, 1.04); if (p.z < -0.12 && k % 3 === 2) continue; sph(o, 0.07, hc, p.x, p.y, p.z); } break;
      case 4: sph(o, 0.21, hc, 0, hy + 0.08, 0.02, 1.02, 0.68, 1.02); sph(o, 0.09, hc, 0, hy + 0.27, 0.05); break;
      case 5: sph(o, 0.21, hc, 0, hy + 0.09, 0.01, 1.03, 0.62, 1.03); sph(o, 0.12, hc, -0.08, hy + 0.18, -0.08, 1.2, 0.5, 1); break;
      default: sph(o, 0.21, hc, 0, hy + 0.08, 0.02, 1.02, 0.7, 1.02); for (const s of [-1, 1]) sph(o, 0.09, hc, s * 0.2, hy + 0.12, 0.04);
    }
    if (i % 4 === 1) { const st = new THREE.Mesh(UB, mat("#e3dccd")); st.scale.set(0.04, 0.7, 0.03); st.position.set(0.02, sh - 0.25, -0.17); st.rotation.z = 0.75; o.add(st); bx(o, 0.22, 0.16, 0.08, "#e3dccd", 0.2, sh - 0.6, -0.16, false); }
    if (i % 5 === 2) { for (const s of [-1, 1]) { const g = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), mat("#2a2a2a")); g.position.set(s * 0.07, hy + 0.05, -0.235); o.add(g); } }
    if (i % 6 === 3) { const hp = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 16, Math.PI), mat("#f1ece2")); hp.rotation.x = Math.PI / 2; hp.position.set(0, sh + 0.02, 0); o.add(hp); }
    return o;
  }
  function VoxelPerson(opt: { sit?: boolean; shirt?: string; hat?: string; vi?: number }) {
    const o = G(); const sh = opt.shirt || "#2f55d4", pa = "#1f2f6b", sk = "#f2b88f", H = 0.56; let hy: number;
    if (opt.sit) {
      for (const s of [-1, 1]) { bx(o, 0.16, 0.14, 0.42, pa, s * 0.1, 0.44, -0.17); bx(o, 0.15, 0.44, 0.15, pa, s * 0.1, 0, -0.38); bx(o, 0.17, 0.07, 0.22, "#1d1d1d", s * 0.1, 0, -0.42, false); }
      bx(o, 0.46, 0.5, 0.28, sh, 0, 0.5, 0.02); for (const s of [-1, 1]) { bx(o, 0.12, 0.38, 0.13, sh, s * 0.29, 0.6, 0, false); bx(o, 0.12, 0.11, 0.34, sk, s * 0.29, 0.66, -0.17, false); }
      hy = 1.0;
    } else {
      const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
      for (const s of [-1, 1]) { const lp = G(); lp.position.set(s * 0.11, 0.6, 0); o.add(lp); bx(lp, 0.17, 0.6, 0.18, pa, 0, -0.6, 0); bx(lp, 0.18, 0.07, 0.24, "#1d1d1d", 0, -0.6, -0.03, false); legs.push(lp); }
      bx(o, 0.48, 0.52, 0.28, sh, 0, 0.6, 0);
      for (const s of [-1, 1]) { const ap = G(); ap.position.set(s * 0.3, 1.12, 0); o.add(ap); bx(ap, 0.12, 0.48, 0.14, sh, 0, -0.48, 0, false); bx(ap, 0.12, 0.12, 0.12, sk, 0, -0.56, 0, false); arms.push(ap); }
      o.userData.legs = legs; o.userData.arms = arms; hy = 1.12;
    }
    bx(o, H, H, H, sk, 0, hy, 0); const ht = hy + H, fz = -H / 2;
    for (const s of [-1, 1]) bx(o, 0.07, 0.09, 0.012, "#2a1f1a", s * 0.11, hy + 0.27, fz - 0.006, false);
    bx(o, 0.08, 0.08, 0.05, "#e8946a", 0, hy + 0.17, fz - 0.02, false); bx(o, 0.14, 0.025, 0.012, "#7a3b2a", 0, hy + 0.08, fz - 0.006, false);
    const vi = opt.vi || 0;
    const vh = ["#3b2a20", "#1d1a18", "#7a4b2a", "#c98a3a"][vi % 4]; bx(o, H + 0.02, 0.1, H + 0.02, vh, 0, ht - 0.1, 0.01, false);
    switch (vi % 4) {
      case 1: bx(o, H + 0.04, 0.5, 0.1, vh, 0, hy - 0.02, H / 2 + 0.02, false); for (const s of [-1, 1]) bx(o, 0.06, 0.36, H * 0.7, vh, s * (H / 2 + 0.03), hy + 0.06, 0.06, false); break;
      case 2: for (const s of [-1, 1]) bx(o, 0.06, 0.2, 0.2, vh, s * (H / 2 + 0.03), hy + 0.24, 0.08, false); bx(o, 0.12, 0.26, 0.12, vh, 0, hy + 0.02, H / 2 + 0.08, false); break;
      case 3: bx(o, H + 0.04, 0.24, 0.08, vh, 0, hy + 0.2, H / 2 + 0.02, false); break;
    }
    const cap = (c: string) => { bx(o, 0.6, 0.2, 0.6, c, 0, ht - 0.04, 0); bx(o, 0.5, 0.05, 0.3, c, 0, ht - 0.04, fz - 0.13, false); };
    switch (opt.hat) {
      case "beret": bx(o, 0.68, 0.16, 0.68, "#1f2f6b", 0, ht - 0.05, 0.03); bx(o, 0.08, 0.06, 0.08, "#1f2f6b", 0, ht + 0.11, 0.03, false); break;
      case "whitecap": cap("#f2f3f5"); break;
      case "none": break;
      default: cap("#1f2f6b");
    }
    return o;
  }
  let folkI = 0;
  function Folk(opt: PersonOpt) {
    const c = G(); const k = folkI++; const p = Person(opt);
    const v = VoxelPerson({ sit: opt.sit, hat: ["none", "whitecap", "beret", "none", "navycap"][k % 5], shirt: ["#ffffff", "#3b5bd9", "#9fc0f5", "#1f2f6b", "#e6eefb"][k % 5], vi: k });
    const w = SoftPerson({ sit: opt.sit, i: k * 3 + 5 }); v.visible = styleNo === 2; w.visible = styleNo === 3; p.visible = styleNo === 1;
    c.add(p, v, w); styleSwap.push([p, v, w]); c.userData.parts = [p, v, w]; return c;
  }
  // Dotted world map screen (Style 2)
  function mapCanvas() {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512; const x = c.getContext("2d")!;
    x.fillStyle = "#0f1a2b"; x.fillRect(0, 0, 1024, 512);
    const land = [[0.2, 0.3, 0.12, 0.12], [0.25, 0.44, 0.06, 0.07], [0.3, 0.68, 0.06, 0.15], [0.36, 0.15, 0.04, 0.04], [0.5, 0.28, 0.05, 0.07], [0.53, 0.56, 0.08, 0.15], [0.68, 0.3, 0.17, 0.12], [0.66, 0.46, 0.03, 0.05], [0.77, 0.5, 0.04, 0.05], [0.84, 0.72, 0.06, 0.05]];
    for (let py = 20; py < 500; py += 11) for (let px = 150; px < 1010; px += 11) {
      const u = (px - 150) / 860, v = py / 512;
      if (land.some((l) => ((u - l[0]) / l[2]) ** 2 + ((v - l[1]) / l[3]) ** 2 < 1)) { x.fillStyle = "rgba(110,175,255,.9)"; x.fillRect(px, py, 5, 5); }
    }
    x.fillStyle = "#3d7bff"; [[30, 60, 70], [30, 80, 50], [30, 100, 90], [30, 120, 40]].forEach((b) => x.fillRect(b[0], b[1], b[2], 8));
    [[40, 400, 20, 60], [70, 380, 20, 80], [100, 420, 20, 40]].forEach((b) => x.fillRect(b[0], b[1], b[2], b[3]));
    return c;
  }
  const MAPTEX = new THREE.CanvasTexture(mapCanvas());
  function MapScreen(w: number) {
    const o = G(); const h = w * 0.5; bx(o, w + 0.12, h + 0.12, 0.1, "#141b26", 0, 0.8, 0, false);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: MAPTEX })); pl.rotation.y = Math.PI; pl.position.set(0, 0.86 + h / 2, -0.056); o.add(pl);
    o.visible = false; style2Only.push(o); return o;
  }
  const dotCv = document.createElement("canvas"); dotCv.width = dotCv.height = 128;
  {
    const x = dotCv.getContext("2d")!; x.fillStyle = "#f4efe7"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "#f2b6c0"; for (let i = 0; i < 14; i++) { x.beginPath(); x.ellipse(rnd() * 128, rnd() * 128, 5, 3, rnd() * 3, 0, Math.PI * 2); x.fill(); }
  }
  const dotMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(dotCv) });
  function CloudRug(s = 1) {
    const o = G();
    [[0, 0, 1.6], [1.1, 0.3, 1.1], [-1.1, 0.2, 1.2], [0.4, -0.8, 1.0], [-0.5, 0.8, 0.9]].forEach((a) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(a[2] * s, a[2] * s, 0.02, 24), dotMat); m.position.set(a[0] * s, 0.012, a[1] * s); m.receiveShadow = true; o.add(m);
    });
    o.visible = false; style3Only.push(o); return o;
  }
  const netMat = new THREE.MeshLambertMaterial({ color: "#4d8bff", emissive: "#2f6bff", emissiveIntensity: 0.75 });
  function Hub() {
    const o = G(); cy(o, 1.25, 1.3, 0.1, "#f8fafd", 0, 0, 0, 40);
    for (const r of [1.22, 0.9]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 48), netMat); t.rotation.x = Math.PI / 2; t.position.y = 0.11; o.add(t); }
    return o;
  }
  /** Workstation (desk faces -z, chair at local z=+0.62). Tracked desks get their own screen material (off until an agent works there). */
  const deskScreens: THREE.MeshLambertMaterial[] = [];
  const deskAnchors: THREE.Object3D[] = [];
  function Workstation(track = false) {
    const o = G(); bx(o, 1.3, 0.04, 0.65, "#c49a6c", 0, 0.72, 0); for (const s of [-1, 1]) bx(o, 0.04, 0.72, 0.6, "#25282c", s * 0.62, 0, 0);
    let sm: THREE.Material = screenMat;
    if (track) { const m = new THREE.MeshLambertMaterial({ color: "#1d2733", emissive: "#000000", emissiveIntensity: 1 }); deskScreens.push(m); deskAnchors.push(o); sm = m; }
    Monitor(o, 0, -0.18, sm); bx(o, 0.42, 0.02, 0.14, "#3a3f46", 0, 0.76, 0.08, false); cy(o, 0.04, 0.04, 0.09, "#e05a4a", 0.45, 0.76, 0, 8, false);
    add(o, Chair(), 0, 0.62, 0);
    return o;
  }
  function Sofa(len: number, c?: string) {
    c = c || "#5b7aa3"; c = SOFA_MAP[c] || c; const o = G(); bx(o, len, 0.42, 0.86, c, 0, 0, 0); bx(o, len - 0.34, 0.1, 0.62, tint(c, 0.18), 0, 0.42, -0.05, false);
    bx(o, len, 0.46, 0.22, c, 0, 0.42, 0.32); for (const s of [-1, 1]) bx(o, 0.17, 0.62, 0.86, c, s * (len / 2 - 0.085), 0, 0); return o;
  }
  const Armchair = (c?: string) => Sofa(0.95, c || "#c9875a");
  function CoffeeTable(w = 1.1, d = 0.6, c = "#8a5a3b") {
    const o = G(); bx(o, w, 0.05, d, c, 0, 0.38, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.05, 0.38, 0.05, c, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), false); return o;
  }
  function Table(w: number, d: number, c = "#ece6da", h = 0.75) {
    const o = G(); bx(o, w, 0.05, d, c, 0, h - 0.05, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.06, h - 0.05, 0.06, C.metal, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), false); return o;
  }
  function DiningSet(w: number, d: number, nSide: number, nEnd: number, c?: string, cc?: string) {
    const o = G(); add(o, Table(w, d, c));
    for (let i = 0; i < nSide; i++) { const x = -w / 2 + (w * (i + 0.5)) / nSide; add(o, Chair(cc), x, -(d / 2 + 0.34), 180); add(o, Chair(cc), x, d / 2 + 0.34, 0); }
    if (nEnd) { add(o, Chair(cc), -(w / 2 + 0.34), 0, -90); add(o, Chair(cc), w / 2 + 0.34, 0, 90); }
    return o;
  }
  function OvalTable(len: number, wid: number, n: number) {
    const o = G(); const t = cy(o, 0.5, 0.5, 0.06, "#efe9df", 0, 0.72, 0, 28); t.scale.set(len, 1, wid);
    cy(o, 0.12, 0.2, 0.72, C.metal, -len / 4, 0, 0, 10); cy(o, 0.12, 0.2, 0.72, C.metal, len / 4, 0, 0, 10);
    for (let i = 0; i < n; i++) { const x = -len * 0.425 + i * ((len * 0.85) / (n - 1)); add(o, Chair("#3b4350"), x, -(wid / 2 + 0.35), 180); add(o, Chair("#3b4350"), x, wid / 2 + 0.35, 0); }
    add(o, Chair("#3b4350"), -(len / 2 + 0.35), 0, -90); add(o, Chair("#3b4350"), len / 2 + 0.35, 0, 90); return o;
  }
  const BOOK = ["#c0392b", "#2e86c1", "#f1c40f", "#27ae60", "#8e44ad", "#e67e22", "#16a085", "#34495e", "#d35400", "#ecf0f1"];
  function Bookshelf(len: number, h = 2.0) {
    const o = G(); const dep = 0.36, f = C.frame;
    bx(o, len, h, 0.04, f, 0, 0, dep / 2 - 0.02); for (const s of [-1, 1]) bx(o, 0.04, h, dep, f, (s * len) / 2, 0, 0);
    const rows = 4, rh = (h - 0.1) / rows; for (let k = 0; k <= rows; k++) bx(o, len, 0.04, dep, f, 0, k * rh, 0, false);
    for (let r = 0; r < rows; r++) {
      let x = -len / 2 + 0.05;
      while (x < len / 2 - 0.12) {
        const bw = 0.12 + rnd() * 0.18, bh = rh * (0.55 + rnd() * 0.3);
        if (rnd() > 0.12) bx(o, bw - 0.015, bh, dep * 0.75, BOOK[Math.floor(rnd() * BOOK.length)], x + bw / 2, r * rh + 0.04, -0.02, false); x += bw;
      }
    }
    return o;
  }
  function Plant(s = 1) { const o = G(); cy(o, 0.18 * s, 0.14 * s, 0.34 * s, rnd() > 0.5 ? "#e9e6e1" : "#c96f4a", 0, 0, 0, 10); ico(o, 0.33 * s, "#4f9a4a", 0, 0.62 * s, 0); ico(o, 0.22 * s, "#64b35a", 0.12 * s, 0.88 * s, 0.05 * s); return o; }
  function TV(w: number, y = 1.0) { const o = G(); const h = w * 0.56; bx(o, w, h, 0.06, C.black, 0, y, 0, false); bx(o, w - 0.08, h - 0.08, 0.01, screenMat, 0, y + 0.04, -0.034, false); return o; }
  function Toilet() { const o = G(); bx(o, 0.38, 0.42, 0.5, "#f4f6f7", 0, 0, -0.05); bx(o, 0.4, 0.42, 0.18, "#e9edf0", 0, 0.3, 0.2); return o; }
  function Sink() { const o = G(); bx(o, 0.6, 0.8, 0.45, "#d8d2c8"); bx(o, 0.42, 0.04, 0.3, "#ffffff", 0, 0.8, -0.02, false); bx(o, 0.5, 0.6, 0.02, "#bfe3f1", 0, 1.2, 0.21, false); return o; }
  function Shower() { const o = G(); bx(o, 0.9, 0.06, 0.9, "#ffffff"); const g = bx(o, 0.9, 1.9, 0.9, glassMat, 0, 0.06, 0, false); g.renderOrder = 2; cy(o, 0.08, 0.08, 0.04, "#aab", 0, 1.9, 0.3, 8, false); return o; }
  function Bathtub() { const o = G(); bx(o, 0.8, 0.55, 1.65, "#f6f7f8"); bx(o, 0.62, 0.02, 1.45, "#8fd0ea", 0, 0.52, 0, false); return o; }
  function Bed(w: number, l: number, bl: string) {
    const o = G(); bx(o, w + 0.06, 0.25, l + 0.04, "#8b6040"); bx(o, w, 0.18, l, "#f7f7f5", 0, 0.25, 0); bx(o, w + 0.02, 0.06, l * 0.62, bl, 0, 0.42, l * 0.19, false);
    if (w > 1.4) { for (const s of [-1, 1]) bx(o, w / 2 - 0.14, 0.1, 0.32, "#ffffff", (s * w) / 4, 0.43, -l / 2 + 0.25, false); } else bx(o, w - 0.2, 0.1, 0.3, "#ffffff", 0, 0.43, -l / 2 + 0.24, false);
    bx(o, w + 0.1, 0.95, 0.08, "#8b6040", 0, 0, -l / 2 - 0.03); return o;
  }
  function PingPong() {
    const o = G(); bx(o, 2.74, 0.05, 1.52, "#1f6f9f", 0, 0.71, 0); bx(o, 2.74, 0.006, 0.02, "#ffffff", 0, 0.76, 0, false); bx(o, 0.02, 0.15, 1.62, "#f3f3f3", 0, 0.76, 0, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.06, 0.71, 0.06, C.metal, sx * 1.2, 0, sz * 0.6, false); return o;
  }
  function Arcade(c: string) { const o = G(); bx(o, 0.72, 1.75, 0.72, c); bx(o, 0.55, 0.42, 0.02, screenMat, 0, 1.05, -0.37, false); bx(o, 0.72, 0.2, 0.1, lampMat, 0, 1.62, -0.33, false); bx(o, 0.72, 0.08, 0.3, "#222", 0, 0.85, -0.45, false); return o; }
  function Beanbag(c: string) { const o = G(); const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), mat(c)); m.scale.set(1, 0.6, 1); m.position.y = 0.27; m.castShadow = true; o.add(m); return o; }
  function Foosball() {
    const o = G(); bx(o, 1.2, 0.3, 0.7, "#6b4a33", 0, 0.6, 0); bx(o, 1.1, 0.02, 0.6, "#3c9b52", 0, 0.9, 0, false); for (const sx of [-1, 1]) bx(o, 0.08, 0.6, 0.6, "#5a3c2a", sx * 0.5, 0, 0, false);
    for (let i = 0; i < 4; i++) bx(o, 0.03, 0.03, 1.0, "#cfd3d6", -0.4 + i * 0.27, 0.95, 0, false); return o;
  }
  function Whiteboard() {
    const o = G(); bx(o, 1.86, 1.06, 0.03, "#9aa0a6", 0, 0.97, 0.01, false); bx(o, 1.8, 1.0, 0.04, "#ffffff", 0, 1.0, 0, false);
    ([["#3a7bd5", -0.4, 1.6, 0.7], ["#e74c3c", 0.1, 1.4, 0.5], ["#27ae60", -0.3, 1.25, 0.9]] as const).forEach((a) => bx(o, a[3], 0.03, 0.006, a[0], a[1], a[2], -0.022, false)); return o;
  }
  function oakDrawers(o: THREE.Object3D, w: number, h: number, d: number, x: number, z: number) {
    bx(o, w, 0.08, d - 0.04, "#1c1e21", x, 0, z); bx(o, w, h - 0.08, d, "#b8895a", x, 0.08, z);
    const rows = 3;
    for (let i = 1; i < rows; i++) { bx(o, w - 0.04, 0.012, 0.006, "#1c1e21", x, 0.08 + ((h - 0.08) * i) / rows, z - d / 2 - 0.003, false); bx(o, w - 0.04, 0.012, 0.006, "#1c1e21", x, 0.08 + ((h - 0.08) * i) / rows, z + d / 2 + 0.003, false); }
    for (const sx of [-1, 1]) bx(o, 0.03, h, d + 0.02, "#1c1e21", x + (sx * w) / 2, 0, z, false);
  }
  function Counter(len: number) {
    const o = G(); oakDrawers(o, len, 0.86, 0.6, 0, 0); bx(o, len + 0.04, 0.05, 0.64, "#f1efea", 0, 0.86, 0, false);
    bx(o, 0.3, 0.38, 0.3, "#2b2f35", -len / 2 + 0.4, 0.91, 0.05, false); bx(o, 0.5, 0.02, 0.35, "#c9d3da", len / 4, 0.91, 0, false); cy(o, 0.08, 0.09, 0.2, "#d64b3c", len / 2 - 0.35, 0.91, 0, 8, false); return o;
  }
  function Fridge() { const o = G(); bx(o, 0.75, 1.85, 0.68, "#cfd5db"); bx(o, 0.03, 0.6, 0.03, "#888", 0.28, 0.9, -0.35, false); return o; }
  function Pendant(o: THREE.Object3D, x: number, z: number) {
    cy(o, 0.006, 0.006, 0.8, "#222", x, 2.3, z, 4, false); const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat); m.position.set(x, 2.18, z); o.add(m);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 6), mat("#c9a46a", { wireframe: true })); sh.position.set(x, 2.18, z); o.add(sh);
  }
  function Island(w: number, d: number) {
    const o = G(); oakDrawers(o, w, 0.95, d, 0, 0); bx(o, w + 0.1, 0.05, d + 0.1, "#f1efea", 0, 0.95, 0, false); Pendant(o, -w / 4, 0); Pendant(o, w / 4, 0);
    const n = 3; for (let i = 0; i < n; i++) { const x = -w / 2 + (w * (i + 0.5)) / n; add(o, Stool(), x, -(d / 2 + 0.4)); add(o, Stool(), x, d / 2 + 0.4); }
    cy(o, 0.18, 0.12, 0.1, "#f5f5f5", 0, 1.0, 0, 10, false); ico(o, 0.07, "#f39c12", 0, 1.12, 0); return o;
  }
  function Reception() {
    const o = G(); bx(o, 2.4, 1.05, 0.7, "#3f444c"); bx(o, 2.5, 0.05, 0.8, "#e0dbd2", 0, 1.05, 0, false); bx(o, 2.42, 0.08, 0.01, stripeMat, 0, 0.72, -0.356, false);
    bx(o, 2.3, 0.04, 0.45, "#e8e3da", 0, 0.74, 0.48, false); Monitor(o, 0.5, 0.4); return o;
  }
  function Rack(len: number) {
    const o = G(); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.04, 2.0, 0.04, C.metal, (sx * len) / 2, 0, sz * 0.25, false);
    for (let k = 0; k < 4; k++) {
      bx(o, len, 0.03, 0.55, "#9aa0a6", 0, 0.1 + k * 0.6, 0, false); let x = -len / 2 + 0.1;
      while (x < len / 2 - 0.3) { const w = 0.25 + rnd() * 0.25; if (rnd() > 0.25) bx(o, w - 0.03, 0.25 + rnd() * 0.15, 0.4, "#c79a63", x + w / 2, 0.13 + k * 0.6, 0, false); x += w; }
    }
    return o;
  }
  function AC() { const o = G(); lowHide.push(o); bx(o, 0.9, 0.3, 0.24, "#f5f6f7", 0, 2.5, 0, false); bx(o, 0.8, 0.03, 0.01, "#c2c6cb", 0, 2.56, -0.125, false); return o; }
  const cornerLamps: THREE.PointLight[] = [];
  /** Floor lamp. `corner` lamps also carry a warm point light switched on at night (setNight). */
  function FloorLamp(corner = false) {
    const o = G(); cy(o, 0.16, 0.18, 0.04, "#c9a46a", 0, 0, 0, 10, false); cy(o, 0.02, 0.02, 1.5, "#c9a46a", 0, 0.04, 0, 6, false); cy(o, 0.15, 0.24, 0.28, lampMat, 0, 1.5, 0, 12, false); addGlow(o, 0, 1.6, 0, 0.75);
    if (corner) { const l = new THREE.PointLight(LAMP.light, LAMP.dayI * PI, LAMP.dist, LAMP.decay); l.position.y = 1.45; o.add(l); cornerLamps.push(l); }
    return o;
  }
  function Lockers(len: number) {
    const o = G(); const n = Math.max(1, Math.round(len / 0.5)), w = len / n;
    for (let i = 0; i < n; i++) { bx(o, w - 0.02, 1.9, 0.5, i % 2 ? "#4a8c96" : "#3f7f89", -len / 2 + w * (i + 0.5), 0, 0); bx(o, 0.18, 0.03, 0.005, "#d6dde0", -len / 2 + w * (i + 0.5), 1.6, -0.253, false); }
    return o;
  }
  function Dispenser() { const o = G(); bx(o, 0.32, 1.0, 0.32, "#f2f2f2"); cy(o, 0.14, 0.14, 0.42, "#7fc7f0", 0, 1.0, 0, 10, false); return o; }
  function ProjScreen(w: number) { const o = G(); const h = w * 0.56; bx(o, w, h, 0.03, "#f7f7f7", 0, 0.95, 0, false); bx(o, w + 0.1, 0.08, 0.1, "#333", 0, 0.95 + h, 0, false); bx(o, w * 0.86, h * 0.8, 0.006, screenMat, 0, 0.95 + h * 0.1, -0.02, false); return o; }
  function Wardrobe(len: number) { const o = G(); bx(o, len, 2.1, 0.6, "#a7774f"); const n = Math.round(len / 0.5); for (let i = 1; i < n; i++) bx(o, 0.01, 2.0, 0.006, "#6e4d33", -len / 2 + (len * i) / n, 0.05, -0.303, false); return o; }
  function RoundTable() { const o = G(); cy(o, 0.45, 0.45, 0.04, "#f0ebe3", 0, 0.72, 0, 16); cy(o, 0.04, 0.04, 0.72, C.metal, 0, 0, 0, 6, false); cy(o, 0.25, 0.25, 0.03, C.metal, 0, 0, 0, 10, false); return o; }
  function CafeSet() { const o = G(); add(o, RoundTable()); add(o, Chair("#c9875a"), -0.75, 0, -90); add(o, Chair("#c9875a"), 0.75, 0, 90); return o; }
  function Sunbed() { const o = G(); bx(o, 0.7, 0.3, 1.9, "#e8e1d4"); bx(o, 0.66, 0.08, 1.2, "#4fa3c7", 0, 0.3, 0.3, false); const b = bx(o, 0.66, 0.08, 0.65, "#4fa3c7", 0, 0.3, -0.6, false); b.rotation.x = 0.6; b.position.y += 0.2; return o; }
  function Planter(len: number) { const o = G(); bx(o, len, 0.45, 0.45, "#7d838b"); for (let x = -len / 2 + 0.3; x < len / 2; x += 0.5) ico(o, 0.26, rnd() > 0.5 ? "#4f9a4a" : "#5fb455", x, 0.62, 0); return o; }

  /* ====== Vehicles & exterior ====== */
  function wheel(o: THREE.Object3D, r: number, w: number, x: number, y: number, z: number) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), mat("#1e2126")); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true; o.add(m); }
  function Tree(s = 1, tone?: number) {
    const o = G(); cy(o, 0.14 * s, 0.2 * s, 1.5 * s, "#7b5233", 0, 0, 0, 7);
    const c1 = tone ? "#3b8f3a" : "#43a043", c2 = tone ? "#4aa545" : "#55b84d", c3 = "#62c457";
    ico(o, 1.05 * s, c1, 0, 2.2 * s, 0); ico(o, 0.8 * s, c2, 0.3 * s, 2.95 * s, 0.1 * s); ico(o, 0.55 * s, c3, -0.25 * s, 3.45 * s, -0.1 * s); return o;
  }
  function StreetLamp(c = "#2f343a") { const o = G(); cy(o, 0.07, 0.09, 4.2, c, 0, 0, 0, 8); bx(o, 0.08, 0.08, 1.0, c, 0, 4.1, -0.5, false); bx(o, 0.35, 0.12, 0.5, c, 0, 4.0, -0.95, false); bx(o, 0.3, 0.02, 0.4, lampMat, 0, 3.98, -0.95, false); return o; }
  function Bench() { const o = G(); bx(o, 1.6, 0.06, 0.45, "#9a6a43", 0, 0.45, 0); bx(o, 1.6, 0.4, 0.05, "#9a6a43", 0, 0.55, 0.22, false); for (const s of [-1, 1]) bx(o, 0.06, 0.45, 0.4, "#2f343a", s * 0.7, 0, 0, false); return o; }
  function FoodCart() {
    const o = G(); bx(o, 1.6, 0.9, 0.8, "#c83c32", 0, 0.35, 0); wheel(o, 0.3, 0.08, -0.5, 0.3, 0.45); wheel(o, 0.3, 0.08, 0.5, 0.3, 0.45);
    const g = bx(o, 1.5, 0.5, 0.7, glassMat, 0, 1.25, 0, false); g.renderOrder = 2; for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.04, 0.9, 0.04, "#ddd", sx * 0.75, 1.25, sz * 0.38, false);
    for (let i = 0; i < 6; i++) bx(o, 0.3, 0.06, 1.0, i % 2 ? "#ffffff" : "#d6372d", -0.75 + 0.3 * i + 0.15, 2.15, 0); return o;
  }
  function Cloud() {
    const o = G();
    [[0, 0, 0, 2.2], [2, 0.3, 0.4, 1.7], [-2, 0.2, -0.2, 1.6], [0.8, 1.1, 0, 1.4]].forEach((a) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(a[3], 0), mat("#ffffff")); m.position.set(a[0], a[1], a[2]); o.add(m); });
    return o;
  }
  function PStool(c?: string) { const o = G(); cy(o, 0.17, 0.13, 0.42, c || "#d64541", 0, 0, 0, 10); return o; }
  function Stall(canopy: string) {
    const o = G();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.05, 2.2, 0.05, "#cfd3d6", sx * 1.4, 0, sz * 1.0, false);
    for (let i = 0; i < 6; i++) bx(o, 0.47, 0.08, 2.2, i % 2 ? "#ffffff" : canopy, -1.4 + 0.47 * i + 0.235, 2.2, 0);
    bx(o, 2.9, 0.28, 0.02, canopy, 0, 1.93, -1.1, false);
    bx(o, 2.4, 0.85, 0.6, "#a7774f", 0, 0, -0.55); bx(o, 2.5, 0.04, 0.7, "#e9e2d4", 0, 0.85, -0.55, false);
    const goods = ["#e74c3c", "#f1c40f", "#27ae60", "#e67e22", "#8e44ad"];
    for (let i = 0; i < 7; i++) bx(o, 0.2, 0.12 + rnd() * 0.12, 0.2, goods[i % 5], -1.0 + i * 0.33, 0.89, -0.55, false);
    cy(o, 0.2, 0.2, 0.3, "#b0b5ba", 0.9, 0.89, -0.45, 12, false);
    bx(o, 2.2, 1.3, 0.35, "#8b6040", 0, 0, 0.85); for (let i = 0; i < 8; i++) cy(o, 0.07, 0.07, 0.2, goods[(i + 2) % 5], -0.9 + i * 0.26, 1.3, 0.8, 8, false);
    return o;
  }
  function CoffeeBike() {
    const o = G(); wheel(o, 0.33, 0.06, 0, 0.33, -0.6); wheel(o, 0.33, 0.06, 0, 0.33, 0.55);
    bx(o, 0.05, 0.05, 1.1, "#2f343a", 0, 0.55, 0, false); bx(o, 0.05, 0.5, 0.05, "#2f343a", 0, 0.33, -0.55, false); bx(o, 0.5, 0.04, 0.04, "#2f343a", 0, 0.95, -0.6, false);
    bx(o, 0.22, 0.06, 0.3, "#222", 0, 0.82, -0.05, false); bx(o, 0.7, 0.55, 0.55, "#6b3f24", 0, 0.6, 0.6);
    cy(o, 0.08, 0.08, 0.3, "#c0392b", -0.18, 1.15, 0.6, 10, false); cy(o, 0.08, 0.08, 0.3, "#2e86c1", 0.18, 1.15, 0.6, 10, false);
    for (let i = 0; i < 5; i++) bx(o, 0.08, 0.25, 0.01, ["#f1c40f", "#e74c3c", "#27ae60", "#e67e22", "#ecf0f1"][i], -0.24 + i * 0.12, 0.65, 0.33, false);
    cy(o, 0.02, 0.02, 1.3, "#ddd", 0, 1.0, 0.75, 6, false); const u = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.35, 8), mat("#2aa7d8")); u.position.set(0, 2.45, 0.75); u.castShadow = true; o.add(u);
    return o;
  }
  function PlantColumn() { const o = G(); cy(o, 0.22, 0.2, 0.4, "#2b2e31", 0, 0, 0, 10); for (let i = 0; i < 5; i++) ico(o, 0.3 - 0.02 * i, i % 2 ? "#3f7f3a" : "#4f9a45", (rnd() - 0.5) * 0.1, 0.65 + i * 0.35, (rnd() - 0.5) * 0.1); return o; }
  function PlantWall(len: number) {
    const o = G(); bx(o, len, 2.3, 0.08, "#2b2e31", 0, 0.25, 0.04, false);
    for (let x = -len / 2 + 0.2; x < len / 2; x += 0.32) for (let y = 0.4; y < 2.5; y += 0.32) ico(o, 0.17 + rnd() * 0.06, rnd() > 0.5 ? "#3f8a3a" : "#58a64c", x + (rnd() - 0.5) * 0.08, y, -0.04);
    return o;
  }
  function ParkBench() {
    const o = G(); for (const sx of [-1, 1]) bx(o, 0.35, 0.4, 0.5, "#d6d6d2", sx * 0.65, 0, 0);
    for (let i = 0; i < 6; i++) bx(o, 1.9, 0.04, 0.075, "#b5713a", 0, 0.42, -0.21 + i * 0.084, false);
    for (const sx of [-1, 1]) { const a = bx(o, 0.35, 0.04, 0.5, "#b5713a", sx * 1.08, 0.42, 0, false); a.rotation.z = sx * 0.45; a.position.y += 0.08; }
    for (const sx of [-1, 1]) bx(o, 0.04, 0.16, 0.4, "#4a3a2a", sx * 0.3, 0.46, 0, false); return o;
  }
  function TreeSlim(s = 1) { const o = G(); cy(o, 0.09 * s, 0.13 * s, 2.8 * s, "#4e3e30", 0, 0, 0, 7); ico(o, 0.95 * s, "#4f9a3c", 0, 3.2 * s, 0); ico(o, 0.75 * s, "#68b24a", 0.25 * s, 3.85 * s, 0.1 * s); ico(o, 0.5 * s, "#7cc256", -0.2 * s, 4.35 * s, 0); return o; }
  function MulchPit() { const o = G(); bx(o, 1.25, 0.14, 1.25, "#8a8d90", 0, 0, 0, false); bx(o, 1.05, 0.16, 1.05, "#8a3b22", 0, 0, 0, false); return o; }
  function WhitePlanter() { const o = G(); const m = bx(o, 0.5, 1.25, 0.9, "#ebebe7", 0, 0, 0); m.rotation.z = 0.22; m.position.x = -0.12; return o; }
  const fenceMat = new THREE.MeshLambertMaterial({ color: "#2f4a3c", transparent: true, opacity: 0.22, depthWrite: false });
  function FenceLine(g: THREE.Object3D, x1: number, y1: number, x2: number, y2: number, hh?: number) {
    const h = hh || 3; const hz = y1 === y2, len = hz ? Math.abs(x2 - x1) * S : Math.abs(y2 - y1) * S, cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2);
    const p = new THREE.Mesh(UB, fenceMat); p.renderOrder = 2; if (hz) p.scale.set(len, h, 0.03); else p.scale.set(0.03, h, len); p.position.set(cx, h / 2, cz); g.add(p);
    const r = new THREE.Mesh(UB, mat("#2f3d33")); if (hz) r.scale.set(len, 0.06, 0.06); else r.scale.set(0.06, 0.06, len); r.position.set(cx, h, cz); g.add(r);
    const n = Math.max(1, Math.round(len / 2.5)); for (let i = 0; i <= n; i++) { const off = -len / 2 + (len * i) / n; bx(g, 0.07, h, 0.07, "#2f3d33", hz ? cx + off : cx, 0, hz ? cz : cz + off, false); }
  }
  function Hoop() {
    const o = G(); cy(o, 0.09, 0.11, 3.3, "#2b2e31", 0, 0, 0.9, 10); bx(o, 0.08, 0.08, 0.95, "#2b2e31", 0, 3.2, 0.45, false);
    bx(o, 1.8, 1.05, 0.05, "#f4f4f4", 0, 2.9, 0); bx(o, 0.6, 0.45, 0.01, "#d64b2a", 0, 3.0, -0.03, false); bx(o, 0.52, 0.37, 0.012, "#f4f4f4", 0, 3.04, -0.032, false);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 6, 18), mat("#e0582a")); rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, -0.28); o.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.4, 10, 1, true), new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.6, side: THREE.DoubleSide })); net.position.set(0, 2.85, -0.28); o.add(net);
    return o;
  }
  function Floodlight() { const o = G(); cy(o, 0.08, 0.12, 6.5, "#3a3f46", 0, 0, 0, 8); bx(o, 1.0, 0.35, 0.25, "#3a3f46", 0, 6.4, -0.1, false); bx(o, 0.9, 0.25, 0.02, lampMat, 0, 6.45, -0.23, false); return o; }
  function IslandWhite(w: number, d: number) {
    const o = G(); bx(o, w - 0.12, 0.08, d - 0.12, "#1c1e21", 0, 0, 0); bx(o, w, 0.87, d, "#f4f3f0", 0, 0.08, 0); bx(o, w + 0.1, 0.05, d + 0.12, "#ffffff", 0, 0.95, 0, false);
    const n = Math.max(2, Math.round(w / 0.8)); for (let i = 0; i < n; i++) { const x = -w / 2 + (w * (i + 0.5)) / n; add(o, Stool("#c49a6c"), x, -(d / 2 + 0.42)); add(o, Stool("#c49a6c"), x, d / 2 + 0.42); }
    Pendant(o, -w / 4, 0); Pendant(o, w / 4, 0); cy(o, 0.16, 0.11, 0.1, "#2b2e31", 0, 1.0, 0, 10, false); ico(o, 0.07, "#f39c12", 0, 1.12, 0); return o;
  }
  function addGlow(o: THREE.Object3D, x: number, y: number, z: number, sz?: number) { const sp = new THREE.Sprite(glowMat); sp.position.set(x, y, z); sp.scale.set(sz || 1.6, sz || 1.6, 1); sp.visible = nightOn; o.add(sp); glowSprites.push(sp); }
  function Sconce() {
    const o = G(); lowHide.push(o); bx(o, 0.14, 0.32, 0.04, "#c9a46a", 0, 1.92, 0.02, false);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.22, 12, 1, true), lampMat); sh.position.set(0, 2.12, -0.08); o.add(sh);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), mat("#c9a46a")); cap.rotation.x = -Math.PI / 2; cap.position.set(0, 2.231, -0.08); o.add(cap); addGlow(o, 0, 2.1, -0.13, 0.5); return o;
  }
  function ArcLamp() {
    const o = G(); cy(o, 0.2, 0.22, 0.08, "#e9e7e2", 0, 0, 0, 16); cy(o, 0.025, 0.025, 1.2, "#c9a46a", 0, 0.08, 0, 6, false);
    const a = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.022, 6, 20, Math.PI), mat("#c9a46a")); a.position.set(0.7, 1.28, 0); o.add(a);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat("#2b2e31")); dome.position.set(1.4, 1.12, 0); dome.castShadow = true; o.add(dome);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lampMat); b.position.set(1.4, 1.1, 0); o.add(b); addGlow(o, 1.4, 1.02, 0, 0.8); return o;
  }
  // ===== Pecel lele tent stall =====
  function bannerCanvas(w: number, h: number, side: boolean) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!;
    x.fillStyle = "#f3efe2"; x.fillRect(0, 0, w, h); x.strokeStyle = "#6fd13f"; x.lineWidth = h * 0.05; x.strokeRect(h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06);
    const ttl = (t: string, cx: number, cyy: number, sz: number, cols: string[][]) => {
      x.font = `900 ${sz}px Arial Black, Arial, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      let tw = 0; const ws = [...t].map((ch) => { const m = x.measureText(ch).width; tw += m; return m; }); let px = cx - tw / 2;
      [...t].forEach((ch, k) => {
        const cc = cols[k % cols.length]; x.lineWidth = sz * 0.14; x.strokeStyle = "#5a1f1f"; x.strokeText(ch, px + ws[k] / 2, cyy);
        const gr = x.createLinearGradient(0, cyy - sz / 2, 0, cyy + sz / 2); gr.addColorStop(0, cc[0]); gr.addColorStop(1, cc[1]); x.fillStyle = gr; x.fillText(ch, px + ws[k] / 2, cyy); px += ws[k];
      });
    };
    const txt = (t: string, cx: number, cyy: number, sz: number, col: string) => { x.font = `800 ${sz}px Arial, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = col; x.fillText(t, cx, cyy); };
    const fish = (cx: number, cyy: number, s: number, c1: string, c2: string) => {
      x.fillStyle = c1; x.beginPath(); x.ellipse(cx, cyy, s, s * 0.55, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.moveTo(cx + s * 0.8, cyy); x.lineTo(cx + s * 1.5, cyy - s * 0.5); x.lineTo(cx + s * 1.5, cyy + s * 0.5); x.fill();
      x.fillStyle = c2; for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(cx - s * 0.2 + i * s * 0.25, cyy + s * 0.05, s * 0.12, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = "#fff"; x.beginPath(); x.arc(cx - s * 0.6, cyy - s * 0.12, s * 0.12, 0, Math.PI * 2); x.fill(); x.fillStyle = "#111"; x.beginPath(); x.arc(cx - s * 0.62, cyy - s * 0.12, s * 0.06, 0, Math.PI * 2); x.fill();
    };
    const lele = (cx: number, cyy: number, s: number) => {
      x.save(); x.translate(cx, cyy); x.rotate(-0.5); x.fillStyle = "#2f5d2a"; x.beginPath(); x.ellipse(0, 0, s * 1.6, s * 0.42, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#e9d23a"; x.beginPath(); x.ellipse(0, s * 0.18, s * 1.4, s * 0.2, 0, 0, Math.PI * 2); x.fill(); x.strokeStyle = "#1d1d1d"; x.lineWidth = 3;
      for (const k of [-1, 1]) { x.beginPath(); x.moveTo(-s * 1.5, 0); x.quadraticCurveTo(-s * 2, k * s * 0.5, -s * 2.2, k * s * 0.9); x.stroke(); }
      x.restore();
    };
    const rooster = (cx: number, cyy: number, s: number) => {
      x.fillStyle = "#7a3b1f"; x.beginPath(); x.ellipse(cx, cyy, s * 0.7, s * 0.55, 0, 0, Math.PI * 2); x.fill();
      ["#1f6b3a", "#2a3f9e", "#c0392b"].forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.ellipse(cx + s * 0.6, cyy - s * 0.4 - i * 0.08 * s, s * 0.25, s * 0.7, 0.5 + i * 0.25, 0, Math.PI * 2); x.fill(); });
      x.fillStyle = "#e67e22"; x.beginPath(); x.arc(cx - s * 0.55, cyy - s * 0.65, s * 0.3, 0, Math.PI * 2); x.fill(); x.fillStyle = "#d62b2b"; x.beginPath(); x.arc(cx - s * 0.6, cyy - s * 1.0, s * 0.16, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#f1c40f"; x.beginPath(); x.moveTo(cx - s * 0.82, cyy - s * 0.65); x.lineTo(cx - s * 1.05, cyy - s * 0.58); x.lineTo(cx - s * 0.82, cyy - s * 0.52); x.fill();
      x.strokeStyle = "#c58a2a"; x.lineWidth = 4; for (const d of [-0.15, 0.15]) { x.beginPath(); x.moveTo(cx + d * s, cyy + s * 0.5); x.lineTo(cx + d * s, cyy + s * 0.95); x.stroke(); }
    };
    const H = h, W = w;
    if (side) { ttl("PECEL LELE", W / 2, H * 0.27, H * 0.22, [["#ffe27a", "#f0262a"]]); txt("AYAM · BEBEK · LELE", W / 2, H * 0.55, H * 0.11, "#6b2fa8"); txt("GORENG · BAKAR", W / 2, H * 0.75, H * 0.12, "#d6266a"); fish(W * 0.16, H * 0.62, H * 0.1, "#f28c28", "#c0392b"); return c; }
    ttl("PECEL LELE", W * 0.5, H * 0.17, H * 0.17, [["#ffe27a", "#f0262a"], ["#fff0a0", "#f39c12"]]);
    txt("SOTO LAMONGAN", W * 0.5, H * 0.33, H * 0.08, "#6b2fa8");
    rooster(W * 0.13, H * 0.56, H * 0.13); fish(W * 0.33, H * 0.52, H * 0.1, "#f28c28", "#c0392b"); lele(W * 0.72, H * 0.5, H * 0.1);
    txt("TAHU", W * 0.21, H * 0.44, H * 0.055, "#d6266a"); txt("TEMPE", W * 0.21, H * 0.51, H * 0.055, "#d6266a");
    txt("ATI", W * 0.55, H * 0.46, H * 0.055, "#d6266a"); txt("AMPELA", W * 0.55, H * 0.53, H * 0.055, "#d6266a");
    txt("SATE KULIT", W * 0.12, H * 0.8, H * 0.05, "#1f8c7a"); txt("SAMBEL IJO", W * 0.42, H * 0.68, H * 0.065, "#1f8c7a");
    txt("GORENG · BAKAR", W * 0.46, H * 0.82, H * 0.085, "#d6266a"); txt("TERONG PECAK", W * 0.8, H * 0.87, H * 0.06, "#1f8c7a");
    return c;
  }
  function PecelLele() {
    const o0 = G(); const W = 5.0, D = 2.8;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) cy(o0, 0.03, 0.03, 2.45, "#9aa0a6", (sx * W) / 2, 0, (sz * D) / 2, 6, false);
    const roof = bx(o0, W + 0.3, 0.04, D + 0.4, "#f07a2a", 0, 2.45, 0, false); roof.rotation.x = -0.06;
    bx(o0, W + 0.3, 0.25, 0.04, "#2f6fd1", 0, 2.22, -(D / 2 + 0.2), false); bx(o0, W + 0.3, 0.25, 0.04, "#2f6fd1", 0, 2.22, D / 2 + 0.2, false);
    const bt = new THREE.CanvasTexture(bannerCanvas(1024, 330, false));
    const bf = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, 1.62), new THREE.MeshLambertMaterial({ map: bt })); bf.position.set(0, 1.08, D / 2 + 0.02); o0.add(bf);
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, 1.62), mat("#ece7d8")); bb.rotation.y = Math.PI; bb.position.set(0, 1.08, D / 2 + 0.01); o0.add(bb);
    const st = new THREE.CanvasTexture(bannerCanvas(600, 330, true));
    const sf = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.1, 1.5), new THREE.MeshLambertMaterial({ map: st })); sf.rotation.y = Math.PI / 2; sf.position.set(W / 2 + 0.02, 1.05, 0); o0.add(sf);
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.1, 1.5), mat("#ece7d8")); sb.rotation.y = -Math.PI / 2; sb.position.set(W / 2 + 0.01, 1.05, 0); o0.add(sb);
    const o = G(); o.scale.x = -1; o0.add(o);
    // dining table + plastic stools
    bx(o, 3.0, 0.05, 0.75, "#7ab6d9", 0.55, 0.72, 0.05); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(o, 0.05, 0.72, 0.05, "#9aa0a6", 0.55 + sx * 1.4, 0, 0.05 + sz * 0.32, false);
    for (let i = 0; i < 5; i++) {
      const xx = -0.6 + i * 0.58; cy(o, 0.13, 0.13, 0.015, "#ffffff", xx, 0.77, -0.12, 14, false); if (i % 2 === 0) bx(o, 0.18, 0.03, 0.05, "#3d3324", xx, 0.785, -0.12, false);
      cy(o, 0.035, 0.035, 0.18, i % 2 ? "#c0392b" : "#e0b02f", xx + 0.2, 0.77, 0.22, 8, false);
    }
    cy(o, 0.12, 0.12, 0.22, "#dfe6ea", 1.75, 0.77, 0.18, 12, false); cy(o, 0.09, 0.09, 0.06, "#7a5a3a", 1.45, 0.77, 0.2, 10, false);
    [[-0.35, -0.62], [0.25, -0.62], [0.85, -0.62], [1.45, -0.62], [-0.35, 0.68], [0.25, 0.68], [0.85, 0.68], [1.45, 0.68]].forEach((a, k) => add(o, PStool(k % 2 ? "#2e86c1" : "#d64541"), a[0], a[1]));
    // cooking station
    bx(o, 0.9, 0.85, 1.7, "#b5bcc3", -1.95, 0, 0.1); bx(o, 0.95, 0.04, 1.75, "#d9dee2", -1.95, 0.85, 0.1, false);
    const wk = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat("#2b2b2b")); wk.position.set(-1.95, 1.12, 0.5); o.add(wk);
    bx(o, 0.4, 0.08, 0.4, "#3a3f46", -1.95, 0.89, 0.5, false); cy(o, 0.17, 0.17, 0.32, "#c8cdd2", -1.95, 0.89, -0.2, 14); cy(o, 0.18, 0.18, 0.03, "#aab0b6", -1.95, 1.21, -0.2, 14, false);
    const gl = bx(o, 0.55, 0.35, 0.4, glassMat, -1.95, 0.89, -0.6, false); gl.renderOrder = 2; for (let i = 0; i < 4; i++) bx(o, 0.32, 0.03, 0.06, "#4a5a3a", -1.95, 0.92 + i * 0.07, -0.6, false);
    cy(o, 0.15, 0.15, 0.38, "#3fa34a", -1.7, 0, 1.15, 12); cy(o, 0.05, 0.05, 0.05, "#c0392b", -1.7, 0.38, 1.15, 8, false);
    cy(o, 0.28, 0.28, 0.75, "#2a6fd1", -2.25, 0, -1.05, 14); cy(o, 0.18, 0.15, 0.3, "#d64541", -1.55, 0, -1.15, 12); bx(o, 0.6, 0.38, 0.4, "#2e86c1", -1.2, 0, 1.15);
    // hanging bulbs
    for (const xx of [-1.4, 0.55, 1.7]) { cy(o, 0.005, 0.005, 0.3, "#222", xx, 2.1, 0, 4, false); const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), lampMat); b.position.set(xx, 2.05, 0); o.add(b); addGlow(o, xx, 2.05, 0, 0.6); }
    return o0;
  }
  function KopiCart() {
    const o = G(); const red = "#d7262b", wh = "#f4f4f4";
    wheel(o, 0.24, 0.07, -0.55, 0.24, -0.05); wheel(o, 0.24, 0.07, 0.55, 0.24, -0.05);
    bx(o, 1.3, 0.75, 0.78, red, 0, 0.32, 0); bx(o, 1.34, 0.08, 0.82, wh, 0, 0.3, 0, false); bx(o, 1.36, 0.06, 0.84, wh, 0, 1.07, 0, false); bx(o, 1.3, 0.04, 0.8, "#e9e9e9", 0, 1.13, 0, false);
    const kc = document.createElement("canvas"); kc.width = 512; kc.height = 256;
    { const x = kc.getContext("2d")!; x.fillStyle = red; x.fillRect(0, 0, 512, 256); x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "900 120px Arial Black, Arial, sans-serif"; x.fillText("KOPI", 256, 110); x.font = "700 40px Arial, sans-serif"; x.fillText("keliling", 256, 200); }
    const kt = new THREE.CanvasTexture(kc);
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshLambertMaterial({ map: kt })); f1.rotation.y = Math.PI; f1.position.set(0, 0.72, -0.395); o.add(f1);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.33), new THREE.MeshLambertMaterial({ map: kt })); f2.rotation.y = Math.PI / 2; f2.position.set(0.661, 0.72, 0); o.add(f2);
    const tb = G(); tb.position.set(-0.3, 1.13, 0.15); tb.rotation.x = -0.35; o.add(tb); bx(tb, 0.34, 0.46, 0.04, wh, 0, 0, 0, false); bx(tb, 0.28, 0.38, 0.006, screenMat, 0, 0.04, -0.023, false);
    for (let i = 0; i < 4; i++) cy(o, 0.04, 0.035, 0.11, "#ffffff", 0.15 + i * 0.1, 1.15, -0.2, 8, false); cy(o, 0.08, 0.08, 0.3, "#c8cdd2", 0.45, 1.15, 0.15, 10, false);
    bx(o, 0.05, 0.05, 1.0, "#2b2e31", 0, 0.45, 0.85, false); wheel(o, 0.3, 0.06, 0, 0.3, 1.35); bx(o, 0.05, 0.55, 0.05, "#2b2e31", 0, 0.5, 1.15, false); bx(o, 0.22, 0.07, 0.32, "#1c1e21", 0, 1.05, 1.1, false);
    bx(o, 0.55, 0.04, 0.04, "#2b2e31", 0, 1.25, 0.55, false); bx(o, 0.04, 0.15, 0.04, "#2b2e31", 0, 1.12, 0.55, false);
    cy(o, 0.025, 0.025, 2.1, "#dcdcdc", -0.55, 0.3, 0.3, 6, false); const u = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.42, 12), mat(red)); u.position.set(-0.55, 2.55, 0.3); u.castShadow = true; o.add(u);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.03, 4, 24), mat(wh)); rim.rotation.x = Math.PI / 2; rim.position.set(-0.55, 2.36, 0.3); o.add(rim);
    return o;
  }
  function Bicycle() {
    const o = G(); for (const z of [-0.52, 0.52]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 18), mat("#1c1e21")); t.rotation.y = Math.PI / 2; t.position.set(0, 0.33, z); o.add(t); }
    const tube = (y1: number, z1: number, y2: number, z2: number) => { const L = Math.hypot(y2 - y1, z2 - z1); const m = new THREE.Mesh(UB, mat("#e8e8e8")); m.scale.set(0.035, 0.035, L); m.position.set(0, (y1 + y2) / 2, (z1 + z2) / 2); m.rotation.x = -Math.atan2(y2 - y1, z2 - z1); o.add(m); };
    tube(0.33, -0.52, 0.75, -0.1); tube(0.33, 0.52, 0.75, -0.1); tube(0.75, -0.1, 0.78, 0.4); tube(0.33, 0.52, 0.78, 0.4); tube(0.33, -0.52, 0.95, -0.45);
    bx(o, 0.45, 0.03, 0.03, "#1c1e21", 0, 0.95, -0.45, false); bx(o, 0.12, 0.05, 0.22, "#1c1e21", 0, 0.8, 0.4, false); return o;
  }

  /* ====== Front facade (photo reference) ====== */
  function concreteCanvas() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 512; const x = c.getContext("2d")!;
    x.fillStyle = "#8d8e8b"; x.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 2600; i++) { const v = 110 + Math.floor(rnd() * 60); x.fillStyle = `rgba(${v},${v},${v - 4},.35)`; x.fillRect(rnd() * 256, rnd() * 512, 2, 2); }
    for (let i = 0; i < 22; i++) { const xx = rnd() * 256, w = 2 + rnd() * 10; const gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, "rgba(40,40,40,.28)"); gr.addColorStop(1, "rgba(40,40,40,0)"); x.fillStyle = gr; x.fillRect(xx, 0, w, 200 + rnd() * 300); }
    for (let y = 64; y < 512; y += 64) { x.fillStyle = "rgba(50,50,50,.18)"; x.fillRect(0, y, 256, 2); }
    return c;
  }
  const ringMats: THREE.MeshLambertMaterial[] = [], letterMats: THREE.MeshLambertMaterial[] = [];
  const s2Custom: { m: THREE.MeshLambertMaterial; c2: string; c1?: string }[] = [];
  function buildFacade(f: THREE.Group) {
    const z0 = wz(1720), H = 10.6, xl = wx(445), xr = wx(1338), cx = (wx(520) + wx(1263)) / 2;
    const conc = new THREE.MeshLambertMaterial({ map: texFrom(concreteCanvas(), 1, 1) }); concList.push(conc);
    const darkGlass = new THREE.MeshLambertMaterial({ color: "#1c252d", transparent: true, opacity: 0.82 }); s2Custom.push({ m: darkGlass, c2: "#7f9fd1" });
    const frame = mat("#25282c");
    // two exposed-concrete fins
    for (const [x, h] of [[xl - 0.15, H], [xr + 0.15, H + 0.4]]) { const m = new THREE.Mesh(UB, conc); m.scale.set(1.0, h, 2.0); m.position.set(x, h / 2, z0 + 0.55); m.castShadow = true; m.receiveShadow = true; f.add(m); }
    // dark glass behind (sides & top)
    const gw = xr - 0.65 - (xl + 0.65);
    for (const [x0, x1] of [[xl + 0.35, wx(575)], [wx(1210), xr - 0.35]]) { const m = new THREE.Mesh(UB, darkGlass); m.scale.set(x1 - x0, H - 3.3, 0.08); m.position.set((x0 + x1) / 2, 3.3 + (H - 3.3) / 2, z0 + 0.22); f.add(m); }
    const top = new THREE.Mesh(UB, darkGlass); top.scale.set(gw + 0.6, 1.1, 0.08); top.position.set(cx, 9.95, z0 + 0.22); f.add(top);
    for (let x = xl + 0.5; x < xr - 0.4; x += 1.6) { const m = new THREE.Mesh(UB, frame); m.scale.set(0.05, H - 3.3, 0.1); m.position.set(x, 3.3 + (H - 3.3) / 2, z0 + 0.24); f.add(m); }
    // wooden louvre panel
    const lx0 = wx(575), lx1 = wx(1210), lw = lx1 - lx0, y0 = 3.45, y1 = 9.4;
    const backM = new THREE.MeshLambertMaterial({ color: "#2a2620" }); s2Custom.push({ m: backM, c2: "#d5e2f5" });
    const back = new THREE.Mesh(UB, backM); back.scale.set(lw, y1 - y0, 0.06); back.position.set(cx, (y0 + y1) / 2, z0 + 0.3); f.add(back);
    let k = 0; for (let y = y0 + 0.08; y < y1; y += 0.2) bx(f, lw, 0.05, 0.14, k++ % 2 ? "#9b7856" : "#86674a", cx, y, z0 + 0.42, false);
    for (let i = 0; i <= 8; i++) bx(f, 0.09, y1 - y0, 0.22, "#25282c", lx0 + (lw * i) / 8, y0, z0 + 0.47, false);
    for (const y of [y0 - 0.12, 6.55, y1]) bx(f, lw + 0.3, 0.16, 0.26, "#25282c", cx, y, z0 + 0.47, false);
    for (const x of [lx0 - 0.12, lx1 + 0.12]) bx(f, 0.24, y1 - y0 + 0.2, 0.28, "#25282c", x, y0 - 0.1, z0 + 0.47, false);
    // sun ring (yellow → mint strip), open at the bottom
    const R = 2.55, cyR = 6.45, n = 20, yel = new THREE.Color("#f2d24a"), mint = new THREE.Color("#8fe3c4");
    for (let i = 0; i < n; i++) {
      const a = (-128 + (256 * i) / (n - 1)) * D2R; const col = yel.clone().lerp(mint, i / (n - 1));
      const m3 = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.12 }); ringMats.push(m3);
      const d = new THREE.Mesh(UB, m3); d.scale.set(0.62, 0.26, 0.06); d.position.set(cx + R * Math.sin(a), cyR + R * Math.cos(a), z0 + 0.62); d.rotation.z = Math.atan2(Math.cos(a), Math.sin(a)); f.add(d);
    }
    // text
    const tc = document.createElement("canvas"); tc.width = 1024; tc.height = 420; const tx = tc.getContext("2d")!;
    tx.clearRect(0, 0, 1024, 420); tx.fillStyle = "#ffffff"; tx.textAlign = "center"; tx.textBaseline = "middle";
    tx.font = '600 104px "Plus Jakarta Sans", Arial, sans-serif'; tx.fillText("This Building is", 512, 110); tx.fillText("Solar Powered", 512, 240);
    tx.font = '500 34px "Plus Jakarta Sans", Arial, sans-serif'; tx.fillText("JRRYPTR", 512, 330);
    const tt = new THREE.CanvasTexture(tc);
    const tp = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 1.6), new THREE.MeshBasicMaterial({ map: tt, transparent: true })); tp.position.set(cx, 6.35, z0 + 0.63); f.add(tp);
    // ground floor: white panel, dark beam above the door
    bx(f, 1.2, 2.7, 0.1, "#e6f2ec", wx(930), FT, z0 + 0.12);
    bx(f, wx(1210) - wx(520), 0.5, 0.22, "#1f2226", (wx(520) + wx(1210)) / 2, 2.95, z0 + 0.18);
    // cantilever canopy over the entrance
    const ccx = wx(1050), cw = 7.4, cd = 3.0, cy0 = 3.0;
    bx(f, cw, 0.38, cd, "#2a2d31", ccx, cy0, z0 + cd / 2 + 0.1);
    for (let i = 0; i < 6; i++) bx(f, cw - 0.3, 0.02, 0.18, "#4a4f55", ccx, cy0 - 0.01, z0 + 0.45 + i * 0.45, false);
    for (let i = 0; i < 5; i++) bx(f, 0.5, 0.015, 0.12, lampMat, ccx - 2.6 + i * 1.3, cy0 - 0.02, z0 + 1.6, false);
    bx(f, cw, 0.12, 0.08, "#1c1e21", ccx, cy0 + 0.38, z0 + cd + 0.06, false);
    // "JRRYPTR" letters standing on the canopy
    const lc = document.createElement("canvas"); lc.width = 2048; lc.height = 320;
    { const x = lc.getContext("2d")!; x.clearRect(0, 0, 2048, 320); x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = '800 300px "Plus Jakarta Sans", Arial, sans-serif'; x.fillText("JRRYPTR", 1024, 170); }
    const ltex = new THREE.CanvasTexture(lc);
    const lw2 = 6.2, lh2 = (lw2 * 320) / 2048;
    for (let k2 = 0; k2 < 6; k2++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(lw2, lh2), new THREE.MeshLambertMaterial({
        map: ltex, transparent: true, alphaTest: 0.5,
        color: k2 === 5 ? "#ffffff" : "#b9bcbf", emissive: k2 === 5 ? "#ffffff" : "#000000", emissiveIntensity: k2 === 5 ? 0.25 : 0, side: THREE.DoubleSide,
      }));
      m.position.set(ccx, cy0 + 0.38 + lh2 / 2, z0 + cd - 0.25 + k2 * 0.016); f.add(m); if (k2 === 5) letterMats.push(m.material);
    }
    // plants at the fins' feet
    for (const [x] of [[xr + 0.9, 1], [xl - 0.9, -1]]) {
      bx(f, 1.4, 0.55, 1.6, "#6f7378", x, 0, z0 + 1.2);
      for (let i = 0; i < 5; i++) ico(f, 0.35 + rnd() * 0.25, i % 2 ? "#4f9a4a" : "#62b455", x - 0.5 + i * 0.25, 0.8 + rnd() * 0.3, z0 + 1.0 + rnd() * 0.5);
    }
    const hang = G(); for (let i = 0; i < 6; i++) ico(hang, 0.3 + rnd() * 0.15, "#5aa84f", i * 0.28, -i * 0.08, 0); hang.position.set(xr + 0.55, 3.1, z0 + 1.6); f.add(hang);
  }

  /* ====== Floor groups ====== */
  const floors: Record<1 | 2 | 3 | 4, THREE.Group> = { 1: G(), 2: G(), 3: G(), 4: G() }; const site = G();
  scene.add(site, floors[1], floors[2], floors[3], floors[4]);
  const voidFloor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: "#26282b" })); voidFloor.rotation.x = -Math.PI / 2; voidFloor.position.y = -0.02; voidFloor.receiveShadow = true; voidFloor.visible = false; scene.add(voidFloor);

  /* ---------- LANTAI 1 ---------- */
  function buildL1(g: THREE.Group) {
    CUR = 1;
    slab(g, [[445, 303, 1808, 1068], [445, 1068, 1338, 1720], [1210, 1720, 1338, 1890]]);
    patch(g, 445, 303, 978, 632, "#f1f0ec", { tile: true });
    patch(g, 620, 712, 1070, 962, "#4f7192");
    patch(g, 1137, 303, 1545, 1068, "#efe9de", { tile: true });
    patch(g, 1368, 965, 1455, 1068, "#dfe8ee", { tile: true, th: 0.03 }); patch(g, 1500, 970, 1588, 1068, "#dfe8ee", { tile: true, th: 0.03 });
    patch(g, 445, 1305, 705, 1565, "#8a3a44"); patch(g, 445, 1565, 738, 1720, "#8a3a44");
    patch(g, 850, 1305, 1137, 1565, "#2f6a64");
    patch(g, 445, 1120, 490, 1190, "#b8bcc1"); patch(g, 1210, 1305, 1338, 1520, "#b8bcc1");
    patch(g, 1210, 1570, 1338, 1720, "#dfe8ee", { tile: true }); patch(g, 1210, 1720, 1338, 1890, "#d9dde1", { tile: true });
    patch(g, 770, 1600, 1000, 1675, "#cdb68a"); patch(g, 990, 1688, 1110, 1718, "#3b3f46", { th: 0.03 });
    // exterior walls
    wall(g, 445, 303, 1808, 303, { out: 1, gaps: [[1067, 1117], [1170, 1222], [1627, 1720]] });
    wall(g, 445, 303, 445, 1720, { out: 1 }); wall(g, 1808, 303, 1808, 1068, { out: 1 });
    wall(g, 1338, 1068, 1808, 1068, { conc: 1 });
    wall(g, 1338, 1068, 1338, 1720, { conc: 1 });
    glassWall(g, 445, 1720, 1210, 1720, { facade: 1, gaps: [[995, 1105]] }); wall(g, 1210, 1720, 1338, 1720, { out: 1, c: C.wallD });
    // interior walls
    wall(g, 978, 303, 978, 625, { c: C.olive }); glassWall(g, 445, 632, 978, 632, { gaps: [[650, 712]] });
    wall(g, 1137, 303, 1137, 1570);
    wall(g, 1137, 1068, 1338, 1068, { gaps: [[1140, 1215]] });
    [520, 632, 783, 895].forEach((y) => wall(g, 1137, y, 1265, y, { h: 1.4 }));
    wall(g, 1320, 303, 1320, 432, { h: 1.4 }); wall(g, 1432, 303, 1432, 432, { h: 1.4 });
    wall(g, 1545, 303, 1545, 875, { c: C.wallD }); wall(g, 1545, 795, 1808, 795, { gaps: [[1575, 1625]] });
    wall(g, 1685, 795, 1685, 1068, { gaps: [[870, 915], [1010, 1055]] }); wall(g, 1685, 930, 1808, 930);
    wall(g, 1368, 965, 1368, 1068, { c: C.wallD }); wall(g, 1368, 965, 1455, 965, { c: C.wallD }); wall(g, 1455, 965, 1455, 1068, { c: C.wallD, gaps: [[980, 1025]] });
    wall(g, 1500, 970, 1500, 1068, { c: C.wallD, gaps: [[980, 1025]] }); wall(g, 1500, 970, 1588, 970, { c: C.wallD }); wall(g, 1588, 970, 1588, 1068, { c: C.wallD });
    wall(g, 445, 1005, 775, 1005); wall(g, 885, 1005, 1137, 1005);
    wall(g, 543, 1005, 543, 1120); wall(g, 645, 1005, 645, 1120); wall(g, 445, 1120, 708, 1120, { gaps: [[500, 540], [600, 640]] });
    wall(g, 850, 1125, 1137, 1125);
    wall(g, 490, 1120, 490, 1190, { gaps: [[1145, 1180]] }); wall(g, 445, 1190, 648, 1190, { gaps: [[495, 530], [600, 635]] });
    wall(g, 545, 1190, 545, 1305); wall(g, 645, 1190, 645, 1305);
    wall(g, 445, 1305, 705, 1305); wall(g, 850, 1305, 1137, 1305);
    wall(g, 705, 1305, 705, 1565, { c: C.wallD, gaps: [[1325, 1362], [1500, 1540]] }); wall(g, 445, 1435, 705, 1435);
    wall(g, 445, 1565, 800, 1565); wall(g, 890, 1565, 1137, 1565);
    wall(g, 738, 1565, 738, 1720, { c: C.wallD, gaps: [[1600, 1690]] });
    wall(g, 1210, 1305, 1210, 1520, { gaps: [[1370, 1400]] }); wall(g, 1210, 1305, 1338, 1305); wall(g, 1210, 1405, 1338, 1405); wall(g, 1210, 1520, 1338, 1520, { gaps: [[1222, 1250]] });
    wall(g, 1210, 1570, 1210, 1720, { c: C.wallD }); wall(g, 1210, 1570, 1338, 1570, { c: C.wallD, gaps: [[1222, 1252]] });
    wall(g, 1270, 1068, 1270, 1240, { c: C.wallD });
    // pos satpam
    wall(g, 1210, 1720, 1210, 1890, { out: 1, gaps: [[1838, 1880]] }); wall(g, 1210, 1890, 1338, 1890, { out: 1 }); wall(g, 1338, 1720, 1338, 1890, { conc: 1 });
    // stairs to floor 2
    stairs(g, 1272, 1334, 1240, 1068);
    const zf = wz(1720);
    for (const x of [995, 1105]) bx(g, 0.14, 2.9, 0.16, "#1f2226", wx(x), FT, zf + 0.1);
    // Main meeting room
    put(g, OvalTable(8.4, 1.6, 8), 732, 467);
    put(g, TV(3.0, 0.8), 454, 467, -90); put(g, MapScreen(4.2), 462, 467, -90); put(g, Plant(1), 533, 333); put(g, Plant(1), 943, 340); put(g, AC(), 712, 313, 180);
    // Lounge
    put(g, Sofa(1.9, "#5d7aa0"), 886, 768, 180); put(g, Sofa(1.9, "#5d7aa0"), 994, 768, 180);
    put(g, Sofa(2.4, "#3e5f86"), 677, 845, 90); put(g, Sofa(2.3, "#3e5f86"), 582, 970, 0);
    put(g, Sofa(1.8, "#5d7aa0"), 1104, 787, 90); put(g, Sofa(1.8, "#5d7aa0"), 1104, 887, 90);
    put(g, CoffeeTable(1.2, 0.7), 860, 870); put(g, TV(2.2), 452, 855, -90); put(g, Bookshelf(4.8), 1009, 990, 0);
    put(g, FloorLamp(true), 475, 660); put(g, Plant(1.1), 1115, 660); put(g, Plant(1), 625, 670);
    // Pantry & café
    put(g, DiningSet(2.0, 0.7, 2, 0, "#f3efe8", "#c9875a"), 1195, 568); put(g, DiningSet(2.0, 0.7, 2, 0, "#f3efe8", "#c9875a"), 1195, 834);
    put(g, Armchair("#d0a15a"), 1175, 678, -90); put(g, Armchair("#d0a15a"), 1175, 738, -90); put(g, RoundTable(), 1225, 708);
    put(g, DiningSet(2.0, 0.7, 1, 0, "#f3efe8", "#c9875a"), 1378, 365, 90); put(g, DiningSet(2.0, 0.7, 1, 0, "#f3efe8", "#c9875a"), 1488, 365, 90);
    put(g, Counter(4.0), 1526, 560, 90); put(g, Fridge(), 1524, 695, 90); put(g, Island(2.6, 1.0), 1400, 690);
    put(g, Dispenser(), 1520, 850, 90); put(g, Plant(1), 1255, 330);
    put(g, PlantWall(3.0), 1146, 410, -90);
    // Work area: 13 tracked desks (order = deskScreens index)
    [375, 450, 525, 600, 675].forEach((y) => put(g, Workstation(true), 1566, y, 90));
    [375, 450, 525, 600, 675, 745].forEach((y) => put(g, Workstation(true), 1788, y, -90));
    put(g, Dispenser(), 1690, 780, 180); put(g, AC(), 1676, 782, 0);
    put(g, CloudRug(1.1), 1677, 470, 0, FT + 0.01); put(g, CloudRug(1.1), 1677, 640, 40, FT + 0.01);
    put(g, Workstation(true), 1788, 860, -90); put(g, Workstation(true), 1788, 1000, -90);
    put(g, Plant(0.8), 1795, 815); put(g, Plant(0.8), 1795, 1055);
    // Toilets
    put(g, Toilet(), 1395, 1050, 0); put(g, Sink(), 1435, 1052, 0); put(g, Toilet(), 1560, 1050, 0); put(g, Sink(), 1525, 1052, 0);
    // Staff rooms & storage
    put(g, Workstation(), 494, 1025, 0); put(g, Workstation(), 594, 1025, 0);
    put(g, Workstation(), 495, 1285, 180); put(g, Workstation(), 595, 1285, 180);
    put(g, Rack(1.1), 462, 1155, 90);
    // Meeting rooms A/B/C
    [[578, 1370], [578, 1500]].forEach((p) => { put(g, DiningSet(2.6, 1.2, 2, 1, "#efe9df", "#3b4350"), p[0], p[1]); put(g, TV(1.4), 453, p[1], -90); });
    put(g, DiningSet(2.6, 1.2, 2, 1, "#efe9df", "#3b4350"), 590, 1642); put(g, TV(1.4), 453, 1642, -90);
    put(g, Plant(0.8), 465, 1450);
    // Reading corner, lounge, VIP
    put(g, Beanbag("#e07a3f"), 930, 1065); put(g, Beanbag("#3f7fd1"), 1005, 1070); put(g, Plant(1), 1110, 1030);
    put(g, Bookshelf(2.0), 1010, 1141, 180); put(g, Sofa(1.9, "#7a8c5d"), 1104, 1213, 90); put(g, CoffeeTable(), 1020, 1213); put(g, Armchair("#c9875a"), 930, 1213, -90);
    put(g, Armchair("#7b5b45"), 1015, 1345, 180); put(g, Sofa(2.4, "#e9e2d4"), 928, 1455, -90); put(g, TV(1.8), 1128, 1460, 90);
    put(g, CoffeeTable(1.0, 0.6, "#3d3d3d"), 1010, 1455); put(g, Plant(1), 1093, 1345); put(g, Plant(1), 870, 1540); put(g, AC(), 990, 1313, 180);
    // Lobby
    put(g, Sofa(1.8, "#4a5a6a"), 823, 1700, 0); put(g, Sofa(1.8, "#4a5a6a"), 915, 1700, 0); put(g, CoffeeTable(1.0, 0.6), 870, 1640);
    put(g, Reception(), 1145, 1668, 90); put(g, PlantWall(4.0), 1010, 1574, 180); put(g, Plant(1.2), 960, 1702);
    // Storage, toilet, guard post
    put(g, Rack(1.8), 1305, 1355, -90); put(g, Rack(1.8), 1305, 1462, -90);
    put(g, Toilet(), 1240, 1703, 0); put(g, Sink(), 1305, 1704, 0);
    put(g, Workstation(), 1310, 1805, -90); put(g, Plant(0.7), 1235, 1740);
    // sconces, floor lamps, dispensers
    [[560, 311, 180], [1553, 420, -90], [1553, 640, -90], [453, 760, -90], [453, 960, -90], [900, 1557, 0], [1080, 1557, 0], [520, 1313, 180],
      [520, 1443, 180], [520, 1573, 180], [746, 1585, -90], [1145, 620, -90], [1800, 560, 90], [1330, 1280, 90], [1330, 1450, 90]].forEach((a) => put(g, Sconce(), a[0], a[1], a[2]));
    put(g, FloorLamp(), 690, 1550); put(g, FloorLamp(), 470, 1705); put(g, FloorLamp(true), 1560, 320); put(g, FloorLamp(), 465, 1100); put(g, FloorLamp(), 1120, 1290);
    put(g, ArcLamp(), 955, 612, 90); put(g, ArcLamp(), 870, 1322, -45); put(g, FloorLamp(), 755, 1705); put(g, FloorLamp(true), 1790, 782); put(g, FloorLamp(), 1125, 1142);
    put(g, Dispenser(), 752, 1600, -90);
    roomLabel(g, "Ruang Meeting Utama", 712, 470, 2.6); roomLabel(g, "Lounge & Ruang Tamu", 850, 840); roomLabel(g, "Pantry & Café", 1330, 600);
    roomLabel(g, "Ruang Kerja", 1677, 560); roomLabel(g, "Ruang Manager", 1745, 860); roomLabel(g, "Ruang Manager 2", 1745, 1000);
    roomLabel(g, "Toilet", 1410, 1015); roomLabel(g, "Toilet", 1545, 1015); roomLabel(g, "Ruang Staf", 545, 1060); roomLabel(g, "Ruang Staf", 545, 1250);
    roomLabel(g, "Meeting Room Borland", 578, 1370); roomLabel(g, "Meeting Room Kylix", 578, 1500); roomLabel(g, "Meeting Room Niklaus Wirth", 590, 1642);
    roomLabel(g, "Pojok Baca", 995, 1060); roomLabel(g, "Lounge", 1010, 1215); roomLabel(g, "Ruang Tamu VIP", 995, 1430);
    roomLabel(g, "Lobby & Resepsionis", 950, 1630); roomLabel(g, "Gudang", 1275, 1410); roomLabel(g, "Toilet", 1275, 1640);
    roomLabel(g, "Pos Satpam", 1275, 1805); roomLabel(g, "Tangga", 1303, 1160);
  }

  /* ---------- LANTAI 2 ---------- */
  function buildL2(g: THREE.Group) {
    CUR = 2;
    slab(g, [[445, 303, 1808, 1068], [445, 1068, 1270, 1720], [1270, 1240, 1338, 1720]]);
    patch(g, 445, 303, 645, 539, "#535a64"); patch(g, 649, 303, 1181, 472, "#9b3a3a");
    patch(g, 1066, 472, 1181, 549, "#dfe8ee", { tile: true, th: 0.03 }); patch(g, 1379, 803, 1808, 1068, "#2c4a7a");
    patch(g, 480, 1130, 960, 1420, "#9cc48a"); patch(g, 445, 1480, 1000, 1720, "#ece4d4", { tile: true });
    patch(g, 1450, 520, 1760, 760, "#d7c39a");
    wall(g, 445, 303, 1808, 303, { out: 1 }); wall(g, 445, 303, 445, 1720, { out: 1 }); wall(g, 1808, 303, 1808, 1068, { out: 1 });
    wall(g, 1338, 1068, 1808, 1068, { conc: 1 }); wall(g, 1338, 1068, 1338, 1720, { conc: 1 }); glassWall(g, 445, 1720, 1338, 1720, { facade: 1 });
    glassWall(g, 645, 303, 645, 539); glassWall(g, 445, 539, 645, 539, { gaps: [[566, 604]] });
    glassWall(g, 645, 472, 1066, 472, { gaps: [[860, 896], [943, 979]] }); wall(g, 1066, 472, 1181, 472, { c: C.wallD }); glassWall(g, 912, 303, 912, 472);
    glassWall(g, 1181, 303, 1181, 472); wall(g, 1181, 472, 1181, 549, { c: C.wallD });
    wall(g, 1066, 472, 1066, 549, { c: C.wallD, gaps: [[506, 544]] }); wall(g, 1066, 549, 1181, 549, { c: C.wallD });
    glassWall(g, 1487, 303, 1487, 474); glassWall(g, 1643, 303, 1643, 474); glassWall(g, 1487, 474, 1808, 474, { gaps: [[1600, 1638], [1650, 1688]] });
    wall(g, 1379, 803, 1379, 1068, { c: C.wallD }); wall(g, 1379, 803, 1808, 803, { gaps: [[1407, 1540]] });
    wall(g, 445, 1070, 1004, 1070, { c: C.olive });
    railing(g, 1268, 1068, 1268, 1240);
    stairs(g, 1272, 1334, 1240, 1068, 1276);
    // CEO room
    put(g, Workstation(), 535, 395, -90); put(g, Bookshelf(1.8), 456, 470, -90); put(g, Plant(1), 625, 325); put(g, Armchair("#7b5b45"), 610, 505, 180);
    put(g, AC(), 545, 313, 180);
    // Meeting 1 & 2
    put(g, DiningSet(2.7, 1.3, 2, 1, "#efe9df", "#3b4350"), 784, 389); put(g, TV(1.6), 653, 389, -90);
    put(g, DiningSet(2.7, 1.3, 2, 1, "#efe9df", "#3b4350"), 1045, 389); put(g, TV(1.6), 1172, 389, 90);
    put(g, Plant(0.8), 885, 325); put(g, Plant(0.8), 935, 325);
    // Toilet
    put(g, Toilet(), 1163, 510, 90); put(g, Sink(), 1110, 484, 180);
    // Manager rooms B, C
    put(g, Workstation(), 1566, 405, 180); put(g, Workstation(), 1725, 405, 180); put(g, Plant(0.8), 1505, 320); put(g, Plant(0.8), 1790, 320);
    // ^ Ruang COO desk (1725, 405) = Hawa's working seat (OfficeScene3D SEATS.default)
    // Agent pods
    const pods = [[760, 690], [980, 690], [1200, 690], [760, 900], [980, 900], [1200, 900]];
    pods.forEach((p) => {
      put(g, Workstation(), p[0] - 33, p[1] + 17, 0); put(g, Workstation(), p[0] + 33, p[1] + 17, 0);
      put(g, Workstation(), p[0] - 33, p[1] - 17, 180); put(g, Workstation(), p[0] + 33, p[1] - 17, 180);
      bx(g, 2.6, 0.45, 0.04, "#7d838b", wx(p[0]), FT + 0.72, wz(p[1]), false);
    });
    put(g, Plant(1.1), 640, 600); put(g, Plant(1.1), 1320, 600); put(g, Plant(1), 640, 990);
    pods.forEach((p) => put(g, CloudRug(0.9), p[0], p[1], rnd() * 360, FT + 0.01));
    // Collaboration area
    put(g, Whiteboard(), 1798, 560, 90); put(g, Table(1.6, 0.8, "#f2efe9", 1.05), 1600, 640);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => put(g, Stool("#2aa7d8"), 1600 + s[0] * 30, 640 + s[1] * 30));
    put(g, Sofa(2.0, "#c9875a"), 1720, 700, 90); put(g, Plant(1), 1470, 540);
    // Floor-2 pantry
    put(g, Counter(4.0), 1335, 322, 180); put(g, Fridge(), 1460, 323, 180); put(g, IslandWhite(2.4, 0.9), 1335, 440); put(g, Dispenser(), 1470, 390, -90);
    roomLabel(g, "Pantry", 1335, 400);
    // Training room
    put(g, ProjScreen(3.0), 1798, 935, 90); put(g, Table(0.6, 1.6, "#f2efe9"), 1765, 935);
    [1470, 1570, 1670].forEach((x) => [880, 985].forEach((y) => { put(g, Table(0.6, 1.6, "#ece6da"), x, y); put(g, Chair(), x - 30, y - 20, -90); put(g, Chair(), x - 30, y + 20, -90); }));
    put(g, AC(), 1600, 811, 180);
    // Library & lounge
    [500, 610, 720, 830].forEach((x) => put(g, Bookshelf(2.2), x, 1086, 180)); put(g, MapScreen(4.0), 760, 1061, 0);
    put(g, Sofa(2.2, "#4f7a5a"), 543, 1237, -90); put(g, Sofa(2.2, "#4f7a5a"), 902, 1237, 90);
    put(g, Sofa(2.2, "#4f7a5a"), 622, 1353, 0); put(g, Sofa(2.2, "#4f7a5a"), 754, 1353, 0); put(g, CoffeeTable(1.3, 0.7), 720, 1250);
    put(g, FloorLamp(true), 495, 1140); put(g, Plant(1.1), 940, 1125);
    // Coffee corner
    put(g, Counter(4.0), 640, 1701, 0); [560, 620, 680, 740].forEach((x) => put(g, Stool("#c9875a"), x, 1662));
    put(g, CafeSet(), 900, 1560); put(g, CafeSet(), 1060, 1620); put(g, Beanbag("#e07a3f"), 500, 1520); put(g, Beanbag("#9b5cc9"), 560, 1560);
    put(g, Dispenser(), 1000, 1702, 0); put(g, Plant(1.1), 1310, 1700); put(g, PlantColumn(), 1200, 1690); put(g, PlantColumn(), 460, 1500); put(g, Plant(1), 465, 1700);
    [[520, 1062, 0], [960, 1062, 0], [453, 1250, -90], [453, 1450, -90], [1330, 1500, 90], [1330, 1650, 90], [1700, 811, 180], [780, 311, 180], [1045, 311, 180], [1800, 700, 90], [453, 700, -90], [1330, 1150, 90]].forEach((a) => put(g, Sconce(), a[0], a[1], a[2]));
    put(g, FloorLamp(), 940, 1400); put(g, FloorLamp(true), 1795, 820); put(g, FloorLamp(), 465, 1128); put(g, FloorLamp(), 1325, 880);
    put(g, ArcLamp(), 462, 318, -90); put(g, FloorLamp(), 1320, 1590); put(g, FloorLamp(), 1395, 1050); put(g, ArcLamp(), 1500, 785, 90);
    put(g, Dispenser(), 640, 1048, 180); put(g, Dispenser(), 1320, 980, -90);
    roomLabel(g, "Ruang CEO", 545, 430); roomLabel(g, "Meeting Room Delphi", 784, 389); roomLabel(g, "Meeting Room Pascal", 1045, 389);
    roomLabel(g, "Toilet", 1123, 515); roomLabel(g, "Ruang CTO", 1566, 400); roomLabel(g, "Ruang COO", 1725, 400);
    roomLabel(g, "Area Kerja Agen", 980, 800, 2.6); roomLabel(g, "Area Kolaborasi", 1600, 600); roomLabel(g, "Ruang Training", 1590, 935);
    roomLabel(g, "Perpustakaan & Lounge", 720, 1250); roomLabel(g, "Coffee Corner", 760, 1600); roomLabel(g, "Tangga", 1303, 1160);
  }

  /* ---------- LANTAI 3 ---------- */
  function buildL3(g: THREE.Group) {
    CUR = 3;
    slab(g, [[445, 303, 1808, 1068], [445, 1068, 1270, 1720], [1270, 1240, 1338, 1720]]);
    patch(g, 445, 303, 1808, 442, "#cfc3b3", { tile: true }); patch(g, 445, 442, 594, 589, "#cfc3b3", { tile: true }); patch(g, 1661, 442, 1808, 597, "#cfc3b3", { tile: true });
    patch(g, 1379, 803, 1808, 1068, "#2d3f8f"); patch(g, 445, 1009, 1065, 1358, "#1f3a6b");
    patch(g, 445, 1358, 584, 1494, "#dfe8ee", { tile: true }); patch(g, 445, 1585, 588, 1720, "#dfe8ee", { tile: true, th: 0.03 });
    patch(g, 584, 1358, 1065, 1494, "#c4c8cc"); patch(g, 588, 1494, 791, 1720, "#1f3a6b"); patch(g, 791, 1494, 1065, 1720, "#1f3a6b");
    patch(g, 650, 600, 1050, 880, "#e08a5c"); patch(g, 1100, 520, 1340, 760, "#a9cf8f");
    // balcony
    railing(g, 445, 303, 1808, 303); railing(g, 445, 303, 445, 589); railing(g, 1808, 303, 1808, 597);
    glassWall(g, 594, 442, 1661, 442, { gaps: [[1050, 1200]] }); glassWall(g, 594, 442, 594, 589); glassWall(g, 445, 589, 594, 589);
    glassWall(g, 1661, 442, 1661, 597); glassWall(g, 1661, 597, 1808, 597);
    // exterior walls
    wall(g, 445, 589, 445, 1720, { out: 1 }); wall(g, 1808, 597, 1808, 1068, { out: 1 }); wall(g, 1338, 1068, 1808, 1068, { conc: 1 });
    wall(g, 1338, 1068, 1338, 1720, { conc: 1 }); glassWall(g, 445, 1720, 1338, 1720, { facade: 1 });
    // interior
    wall(g, 1379, 803, 1379, 1068, { c: C.wallD }); wall(g, 1379, 803, 1808, 803, { gaps: [[1408, 1541]] });
    wall(g, 445, 1009, 1065, 1009); wall(g, 1065, 1009, 1065, 1358);
    wall(g, 445, 1358, 1065, 1358, { gaps: [[531, 574], [695, 829]] }); wall(g, 584, 1358, 584, 1494, { c: C.wallD });
    wall(g, 1065, 1358, 1065, 1494, { gaps: [[1375, 1480]] }); wall(g, 445, 1494, 1065, 1494, { gaps: [[600, 645], [803, 845]] });
    wall(g, 791, 1494, 791, 1720); wall(g, 1065, 1494, 1065, 1720);
    wall(g, 445, 1585, 588, 1585, { c: C.wallD, gaps: [[512, 550]] }); wall(g, 588, 1585, 588, 1720, { c: C.wallD });
    railing(g, 1268, 1068, 1268, 1240); railing(g, 1270, 1240, 1338, 1240);
    // balcony furniture
    [700, 900, 1300, 1500].forEach((x) => put(g, CafeSet(), x, 372));
    put(g, Sunbed(), 520, 500, 0); put(g, Sunbed(), 1735, 510, 0);
    put(g, Planter(2.0), 560, 320); put(g, Planter(2.0), 1125, 320); put(g, Planter(2.0), 1690, 320);
    // reading lounge
    put(g, Bookshelf(3.0), 455, 720, -90); put(g, Bookshelf(3.0), 455, 880, -90);
    put(g, Sofa(2.4, "#3d8f88"), 850, 620, 180); put(g, Sofa(2.4, "#3d8f88"), 850, 860, 0);
    put(g, Armchair("#e0b04a"), 1000, 740, 90); put(g, Armchair("#e0b04a"), 700, 740, -90); put(g, CoffeeTable(1.2, 0.7), 850, 740);
    put(g, CloudRug(1.2), 850, 740, 20, FT + 0.03);
    put(g, FloorLamp(), 640, 610); put(g, Plant(1.1), 1060, 610); put(g, Plant(1), 620, 960);
    // rest area
    put(g, Beanbag("#e07a3f"), 1150, 600); put(g, Beanbag("#9b5cc9"), 1235, 560); put(g, Beanbag("#3fa06b"), 1285, 680); put(g, Plant(1.2), 1330, 540);
    // floor-3 pantry
    put(g, Counter(3.0), 1788, 715, 90); put(g, PlantColumn(), 1700, 620); put(g, Fridge(), 1786, 622, 90); put(g, IslandWhite(2.4, 0.9), 1560, 700); put(g, DiningSet(1.6, 0.9, 2, 1, "#f3efe8", "#c9875a"), 1230, 880);
    // game room
    put(g, PingPong(), 1580, 960); put(g, Arcade("#e0b02f"), 1790, 860, 90); put(g, Arcade("#2fb9e0"), 1790, 915, 90);
    put(g, Sofa(2.0, "#e9e2d4"), 1450, 1045, 0); put(g, TV(1.8), 1700, 812, 180); put(g, Foosball(), 1460, 880);
    put(g, Beanbag("#d14f6a"), 1700, 1020); put(g, Beanbag("#f1c40f"), 1750, 990);
    // dorm
    [500, 575, 647, 719, 792, 866, 941, 1016].forEach((x) => put(g, Bed(1.0, 2.0, "#4a78b5"), x, 1078, 0));
    [500, 567, 638, 883, 950, 1021].forEach((x) => put(g, Bed(1.0, 2.0, "#4a78b5"), x, 1293, 180));
    put(g, AC(), 760, 1017, 180);
    // shared bathroom
    put(g, Shower(), 475, 1392); put(g, Toilet(), 464, 1470, -90); put(g, Sink(), 545, 1480, 0);
    // lockers
    put(g, Lockers(2.8), 722, 1482, 0); put(g, Lockers(4.0), 955, 1482, 0); put(g, Bench(), 800, 1425, 0);
    // master bedroom
    put(g, Bed(1.8, 2.1, "#c9875a"), 695, 1663, 180); put(g, AC(), 693, 1502, 180); put(g, Wardrobe(1.6), 775, 1560, 90);
    bx(g, 0.45, 0.5, 0.4, "#8b6040", wx(633), FT, wz(1695)); bx(g, 0.45, 0.5, 0.4, "#8b6040", wx(757), FT, wz(1695));
    put(g, Toilet(), 464, 1612, -90); put(g, Sink(), 570, 1645, 90); put(g, Bathtub(), 520, 1697, 90);
    // room 2
    put(g, Bed(1.8, 2.1, "#6f9a7a"), 928, 1663, 180); put(g, AC(), 928, 1502, 180); put(g, Wardrobe(1.6), 1046, 1560, 90); put(g, Plant(0.8), 815, 1700);
    put(g, Plant(1), 1318, 1300);
    // enclosed stair room to the roof
    wall(g, 1205, 1530, 1205, 1720, { c: C.wallD, gaps: [[1645, 1700]] }); wall(g, 1205, 1530, 1338, 1530, { c: C.wallD });
    patch(g, 1205, 1530, 1338, 1720, "#b8bcc1");
    stairs(g, 1272, 1334, 1710, 1540, 1276);
    roomLabel(g, "Tangga ke Atap", 1250, 1600);
    [[560, 1017, 180], [960, 1017, 180], [760, 1502, 180], [1000, 1502, 180], [1800, 1000, 90], [453, 800, -90], [1330, 1150, 90], [1330, 1400, 90], [1600, 811, 180]].forEach((a) => put(g, Sconce(), a[0], a[1], a[2]));
    put(g, FloorLamp(true), 455, 1185); put(g, FloorLamp(), 1395, 1050); put(g, FloorLamp(), 1060, 880); put(g, FloorLamp(), 1080, 1490);
    put(g, ArcLamp(), 700, 1512, -90); put(g, FloorLamp(), 1050, 1700); put(g, FloorLamp(true), 1795, 1055); put(g, FloorLamp(), 1050, 1185); put(g, ArcLamp(), 1340, 600, 180);
    put(g, Dispenser(), 1640, 785, 180); put(g, Dispenser(), 1050, 990, 180); put(g, Dispenser(), 1318, 1480, -90);
    roomLabel(g, "Balkon", 1125, 372, 1.6); roomLabel(g, "Sofa Baca", 850, 740); roomLabel(g, "Tempat Istirahat", 1230, 620);
    roomLabel(g, "Pantry Lt. 3", 1680, 700); roomLabel(g, "Ruang Game", 1590, 935); roomLabel(g, "Kamar Tidur Bersama", 755, 1185);
    roomLabel(g, "Kamar Mandi", 515, 1430); roomLabel(g, "Ruang Loker", 820, 1420); roomLabel(g, "Master Bedroom", 700, 1600);
    roomLabel(g, "Kamar Tamu", 928, 1600); roomLabel(g, "Kamar Mandi", 515, 1650); roomLabel(g, "Koridor", 1200, 1450);
  }

  /* ---------- ROOF + SOLAR PANELS ---------- */
  function buildRoof(g: THREE.Group) {
    CUR = 4;
    const side = mat(C.slabSide), topm = new THREE.MeshLambertMaterial({ map: texFrom(concreteCanvas(), 6, 4) }); concList.push(topm);
    for (const r of [[445, 303, 1808, 1068], [445, 1068, 1270, 1720], [1270, 1068, 1338, 1540], [1270, 1710, 1338, 1720]]) {
      const w = (r[2] - r[0]) * S, d = (r[3] - r[1]) * S;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, FT, d), [side, side, topm, side, side, side]); m.position.set(wx((r[0] + r[2]) / 2), FT / 2, wz((r[1] + r[3]) / 2)); m.receiveShadow = true; g.add(m);
    }
    const pc: WallOpt = { h: 1.0, conc: 1, noLintel: 1 };
    wall(g, 445, 303, 1808, 303, pc); wall(g, 445, 303, 445, 1720, pc); wall(g, 1808, 303, 1808, 1068, pc); wall(g, 1338, 1068, 1808, 1068, pc); wall(g, 1338, 1068, 1338, 1720, pc); wall(g, 445, 1720, 1338, 1720, pc);
    // roof garden along the front & left edges
    bx(g, (1250 - 465) * S, 0.5, 0.7, "#5c6168", wx(857.5), FT, wz(1695)); bx(g, 0.7, 0.5, (1690 - 330) * S, "#5c6168", wx(470), FT, wz(1010));
    for (let x = 480; x < 1245; x += 38) { ico(g, 0.32 + rnd() * 0.15, rnd() > 0.5 ? "#3f8a3a" : "#5aa84f", wx(x), FT + 0.8, wz(1695)); if (rnd() > 0.45) ico(g, 0.22, "#4f9a45", wx(x), FT - 0.5, wz(1734)); }
    for (let y = 340; y < 1690; y += 40) { ico(g, 0.3 + rnd() * 0.15, rnd() > 0.5 ? "#3f8a3a" : "#5aa84f", wx(470), FT + 0.8, wz(y)); if (rnd() > 0.5) ico(g, 0.22, "#4f9a45", wx(431), FT - 0.5, wz(y)); }
    // steel column frame
    for (const x of [520, 840, 1160, 1480, 1760]) for (const y of [340, 700, 1040]) bx(g, 0.16, 3.2, 0.16, "#e3e4e5", wx(x), FT, wz(y));
    for (const [x, y] of [[520, 1360], [840, 1360], [1160, 1360], [1300, 1360], [520, 1660], [840, 1660], [1160, 1660], [1225, 1660]]) bx(g, 0.16, 3.0, 0.16, "#e3e4e5", wx(x), FT, wz(y));
    // stair house (access from floor 3)
    const ph: WallOpt = { h: 2.6, c: C.wallD, noLintel: 1 };
    wall(g, 1262, 1525, 1262, 1720, ph); wall(g, 1262, 1525, 1338, 1525, Object.assign({ gaps: [[1280, 1330]] }, ph)); wall(g, 1338, 1525, 1338, 1720, ph); wall(g, 1262, 1720, 1338, 1720, ph);
    bx(g, (1338 - 1262) * S + 0.3, 0.12, (1720 - 1525) * S + 0.3, "#2b2e31", wx(1300), FT + 2.6, wz(1622.5));
    roomLabel(g, "Akses Tangga", 1300, 1500, 3.0);
    // metal roof + solar panels
    const sc = document.createElement("canvas"); sc.width = 64; sc.height = 64;
    { const x = sc.getContext("2d")!; x.fillStyle = "#d9dbdd"; x.fillRect(0, 0, 64, 64); x.fillStyle = "#b9bcbf"; for (let i = 0; i < 64; i += 16) x.fillRect(i, 0, 5, 64); }
    const pv = document.createElement("canvas"); pv.width = 128; pv.height = 216;
    {
      const x = pv.getContext("2d")!; x.fillStyle = "#c9ccd0"; x.fillRect(0, 0, 128, 216); x.fillStyle = "#1b2a48"; x.fillRect(4, 4, 120, 208);
      x.strokeStyle = "rgba(150,170,200,.45)"; x.lineWidth = 1.5;
      for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(4 + i * 20, 4); x.lineTo(4 + i * 20, 212); x.stroke(); }
      for (let j = 1; j < 10; j++) { x.beginPath(); x.moveTo(4, 4 + j * 20.8); x.lineTo(124, 4 + j * 20.8); x.stroke(); }
    }
    const pvMat = (w: number, d: number) => new THREE.MeshPhongMaterial({ map: texFrom(pv, w / 1.0, d / 1.7), shininess: 70, specular: "#6b7c99" });
    const roofSheet = (x0: number, y0: number, x1: number, y1: number, h: number, arrays: number) => {
      const grp = G(); const w = (x1 - x0) * S, d = (y1 - y0) * S; grp.position.set(wx((x0 + x1) / 2), FT + h, wz((y0 + y1) / 2)); grp.rotation.x = 0.05; g.add(grp);
      const sh = new THREE.Mesh(UB, new THREE.MeshLambertMaterial({ map: texFrom(sc, w / 1.2, 1) })); sh.scale.set(w, 0.07, d); sh.castShadow = true; sh.receiveShadow = true; grp.add(sh);
      const tot = arrays * 4.4 + (arrays - 1) * 0.7;
      for (let i = 0; i < arrays; i++) {
        const ax = -tot / 2 + 2.2 + i * 5.1, ad = d - 1.6;
        const p = new THREE.Mesh(UB, pvMat(4.4, ad)); p.scale.set(4.4, 0.06, ad); p.position.set(ax, 0.1, 0); p.castShadow = true; grp.add(p);
        for (const sx of [-1, 1]) bx(grp, 0.05, 0.06, ad, "#9ea3a8", ax + sx * 2.2, 0.04, 0, false);
      }
      return grp;
    };
    roofSheet(490, 325, 1785, 1060, 3.25, 5); roofSheet(490, 1060, 1320, 1690, 3.05, 3);
    // outdoor AC units & water tanks
    for (let i = 0; i < 6; i++) { const o = G(); bx(o, 0.9, 0.75, 0.4, "#eceeef"); const f = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14), mat("#6b7075")); f.rotation.x = Math.PI / 2; f.position.set(0, 0.4, -0.21); o.add(f); put(g, o, 1430 + i * 55, 330, 180); }
    cy(g, 0.7, 0.7, 1.6, "#f2f2f2", wx(1700), FT, wz(980), 16); cy(g, 0.7, 0.7, 1.6, "#f2f2f2", wx(1620), FT, wz(980), 16);
    put(g, ParkBench(), 800, 1600, 0); put(g, ParkBench(), 1050, 1600, 0); put(g, PlantColumn(), 930, 1600);
    roomLabel(g, "Atap Solar Panel", 1100, 700, 4.2); roomLabel(g, "Taman Atap", 900, 1640, 1.6);
  }

  /* ---------- SITE ---------- */
  let vendGroup: THREE.Group | null = null;
  const walkers: { p: THREE.Group; dir: number; speed: number; ph: number }[] = [];
  // Road traffic: moves along X and wraps at the road ends (wx(-1500)..wx(3500)); wheels spin with speed.
  const vehicles: { p: THREE.Group; dir: number; speed: number; wheels: THREE.Mesh[]; r: number }[] = [];
  const ROAD_X0 = wx(-1500), ROAD_X1 = wx(3500);
  const clouds: THREE.Group[] = []; const streetLights: THREE.PointLight[] = [];
  function buildSite(g: THREE.Group) {
    CUR = 0;
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mat(C.grass)); gr.rotation.x = -Math.PI / 2; gr.position.y = -0.01; gr.receiveShadow = true; g.add(gr);
    // ===== sports area =====
    patch(g, 445, -1250, 1808, 303, "#3f6f58", { y: 0, th: 0.04 });
    const L = (x1: number, y1: number, x2: number, y2: number, w = 0.06) => { const a = wx(x1), b = wx(x2), c = wz(y1), d = wz(y2); bx(g, Math.max(Math.abs(b - a), w), 0.01, Math.max(Math.abs(d - c), w), "#ffffff", (a + b) / 2, 0.075, (c + d) / 2, false); };
    // tennis
    patch(g, 470, -1225, 1130, 280, "#3f8a5c", { y: 0.04, th: 0.02 });
    const tx0 = 525.75, tx1 = 1074.25, ty0 = -1066, ty1 = 122.5, tcx = 800, net = -472;
    patch(g, tx0, ty0, tx1, ty1, "#2f5f9e", { y: 0.045, th: 0.02 });
    L(tx0, ty0, tx1, ty0); L(tx0, ty1, tx1, ty1); L(tx0, ty0, tx0, ty1); L(tx1, ty0, tx1, ty1);
    L(tx0 + 68.5, ty0, tx0 + 68.5, ty1); L(tx1 - 68.5, ty0, tx1 - 68.5, ty1);
    L(tx0 + 68.5, net - 320, tx1 - 68.5, net - 320); L(tx0 + 68.5, net + 320, tx1 - 68.5, net + 320); L(tcx, net - 320, tcx, net + 320);
    L(tcx, ty0, tcx, ty0 + 10); L(tcx, ty1 - 10, tcx, ty1);
    for (const x of [tx0 - 45, tx1 + 45]) bx(g, 0.08, 1.07, 0.08, "#2b2e31", wx(x), 0, wz(net), false);
    const tn = new THREE.Mesh(UB, new THREE.MeshLambertMaterial({ color: "#1d1f22", transparent: true, opacity: 0.55 })); tn.scale.set((tx1 - tx0 + 90) * S, 0.92, 0.03); tn.position.set(wx(tcx), 0.5, wz(net)); g.add(tn);
    bx(g, (tx1 - tx0 + 90) * S, 0.06, 0.05, "#ffffff", wx(tcx), 0.97, wz(net), false);
    // basketball
    patch(g, 1170, -1225, 1790, 280, "#3f6f58", { y: 0.04, th: 0.02 });
    const bx0 = 1190, bx1 = 1770, by0 = -1160, by1 = 160, bcx = 1480, bmid = -500;
    patch(g, bx0, by0, bx1, by1, "#c0673e", { y: 0.045, th: 0.02 });
    patch(g, bcx - 122.5, by0, bcx + 122.5, by0 + 290, "#2f5f9e", { y: 0.05, th: 0.02 }); patch(g, bcx - 122.5, by1 - 290, bcx + 122.5, by1, "#2f5f9e", { y: 0.05, th: 0.02 });
    L(bx0, by0, bx1, by0); L(bx0, by1, bx1, by1); L(bx0, by0, bx0, by1); L(bx1, by0, bx1, by1); L(bx0, bmid, bx1, bmid);
    const arc = (cxp: number, cyp: number, rad: number, th0: number, thl: number) => { const m = new THREE.Mesh(new THREE.RingGeometry(rad * S - 0.03, rad * S + 0.03, 48, 1, th0, thl), mat("#ffffff")); m.rotation.x = -Math.PI / 2; m.position.set(wx(cxp), 0.08, wz(cyp)); g.add(m); };
    arc(bcx, bmid, 90, 0, Math.PI * 2);
    for (const [base, dir] of [[by0, 1], [by1, -1]]) {
      const ft = base + dir * 290, rim = base + dir * 45;
      L(bcx - 122.5, base, bcx - 122.5, ft); L(bcx + 122.5, base, bcx + 122.5, ft); L(bcx - 122.5, ft, bcx + 122.5, ft);
      arc(bcx, ft, 90, dir > 0 ? Math.PI : 0, Math.PI); arc(bcx, rim, 275, dir > 0 ? Math.PI : 0, Math.PI);
      L(bcx - 275, base, bcx - 275, rim); L(bcx + 275, base, bcx + 275, rim);
      put(g, Hoop(), bcx, base + dir * 30, dir > 0 ? 180 : 0, 0);
    }
    put(g, ParkBench(), 1260, -1212, 0, 0); put(g, ParkBench(), 1650, -1212, 0, 0);
    put(g, Dispenser(), 1780, -1208, 90, 0); put(g, PlantColumn(), 1180, -1208, 0, 0);
    // back row: mini futsal + badminton
    patch(g, 445, -1950, 1808, -1250, "#3f6f58", { y: 0, th: 0.04 });
    const fx0 = 500, fx1 = 1300, fy0 = -1850, fy1 = -1350, fcx = 900, fcy = -1600;
    patch(g, 470, -1925, 1330, -1275, "#2f7a4a", { y: 0.04, th: 0.02 }); patch(g, fx0, fy0, fx1, fy1, "#3c9b55", { y: 0.045, th: 0.02 });
    L(fx0, fy0, fx1, fy0); L(fx0, fy1, fx1, fy1); L(fx0, fy0, fx0, fy1); L(fx1, fy0, fx1, fy1); L(fcx, fy0, fcx, fy1);
    arc(fcx, fcy, 150, 0, Math.PI * 2); arc(fx0, fcy, 200, -Math.PI / 2, Math.PI); arc(fx1, fcy, 200, Math.PI / 2, Math.PI);
    for (const [gx, dir] of [[fx0, -1], [fx1, 1]]) {
      const o = G();
      for (const sz of [-1, 1]) bx(o, 0.08, 2.0, 0.08, "#ffffff", 0, 0, sz * 1.5, false); bx(o, 0.08, 0.08, 3.08, "#ffffff", 0, 2.0, 0, false);
      const nm = new THREE.Mesh(UB, new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false })); nm.scale.set(0.9, 2.0, 3.0); nm.position.set(0.45, 1.0, 0); o.add(nm);
      put(g, o, gx, fcy, dir < 0 ? 180 : 0, 0);
    }
    const bdx0 = 1395, bdx1 = 1700, bdy0 = -1925, bdy1 = -1255, bdc = 1547.5, bnet = -1590;
    patch(g, 1360, -1940, 1790, -1260, "#2f6a55", { y: 0.04, th: 0.02 }); patch(g, bdx0, bdy0, bdx1, bdy1, "#2a7f68", { y: 0.045, th: 0.02 });
    L(bdx0, bdy0, bdx1, bdy0); L(bdx0, bdy1, bdx1, bdy1); L(bdx0, bdy0, bdx0, bdy1); L(bdx1, bdy0, bdx1, bdy1);
    L(bdx0 + 23, bdy0, bdx0 + 23, bdy1); L(bdx1 - 23, bdy0, bdx1 - 23, bdy1);
    L(bdx0, bnet - 99, bdx1, bnet - 99); L(bdx0, bnet + 99, bdx1, bnet + 99); L(bdx0, bdy0 + 38, bdx1, bdy0 + 38); L(bdx0, bdy1 - 38, bdx1, bdy1 - 38);
    L(bdc, bdy0, bdc, bnet - 99); L(bdc, bnet + 99, bdc, bdy1);
    for (const x of [bdx0 - 8, bdx1 + 8]) bx(g, 0.06, 1.55, 0.06, "#e5e5e5", wx(x), 0, wz(bnet), false);
    const bn = new THREE.Mesh(UB, new THREE.MeshLambertMaterial({ color: "#f4f4f4", transparent: true, opacity: 0.6, depthWrite: false })); bn.scale.set((bdx1 - bdx0 + 16) * S, 0.76, 0.03); bn.position.set(wx(bdc), 1.17, wz(bnet)); g.add(bn);
    put(g, ParkBench(), 1745, -1450, 90, 0); put(g, ParkBench(), 1745, -1750, 90, 0);
    roomLabel(g, "Lapangan Futsal Mini", 900, -1600, 1.8); roomLabel(g, "Lapangan Badminton", 1547, -1590, 1.8);
    [[470, -1235], [1130, -1235], [470, 185], [1785, -1235], [470, -1935], [1340, -1935], [1785, -1935]].forEach((p) => put(g, Floodlight(), p[0], p[1], p[1] < 0 ? 180 : 0, 0));
    // --- pool & chill area ---
    patch(g, 445, -2700, 1808, -1950, "#ddd6c9", { y: 0, th: 0.05, tile: true });
    const px0 = 560, px1 = 1460, py0 = -2560, py1 = -2200;
    bx(g, (px1 - px0) * S + 0.7, 0.12, (py1 - py0) * S + 0.7, "#f5f4f0", wx((px0 + px1) / 2), 0, wz((py0 + py1) / 2), false);
    const water = new THREE.Mesh(UB, new THREE.MeshPhongMaterial({ color: "#37a9d6", emissive: "#0e5f86", emissiveIntensity: 0.25, shininess: 90, specular: "#ffffff", transparent: true, opacity: 0.9 }));
    water.scale.set((px1 - px0) * S, 0.04, (py1 - py0) * S); water.position.set(wx((px0 + px1) / 2), 0.12, wz((py0 + py1) / 2)); g.add(water);
    for (let i = 1; i < 4; i++) bx(g, (px1 - px0) * S - 0.6, 0.005, 0.08, "#1f6f99", wx((px0 + px1) / 2), 0.141, wz(py0 + ((py1 - py0) * i) / 4), false);
    for (const x of [px0 + 40, px1 - 40]) {
      const o = G();
      for (const sx of [-1, 1]) { const rl = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 12, Math.PI), mat("#d9dde1")); rl.position.set(sx * 0.25, 0.35, 0); rl.rotation.y = Math.PI / 2; o.add(rl); bx(o, 0.05, 0.35, 0.05, "#d9dde1", sx * 0.25, 0, -0.25, false); }
      put(g, o, x, py1 - 10, 0, 0.12);
    }
    [650, 800, 950, 1100, 1250, 1400].forEach((x) => put(g, Sunbed(), x, -2640, 180, 0.05));
    const Umb = (c: string) => { const o = G(); cy(o, 0.03, 0.03, 2.3, "#ddd", 0, 0, 0, 6, false); const u = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.45, 10), mat(c)); u.position.y = 2.4; u.castShadow = true; o.add(u); return o; };
    put(g, Umb("#f4efe6"), 725, -2640, 0, 0.05); put(g, Umb("#f4efe6"), 1025, -2640, 0, 0.05); put(g, Umb("#f4efe6"), 1325, -2640, 0, 0.05);
    patch(g, 1500, -2680, 1790, -2250, "#a99273", { y: 0.05, th: 0.03 });
    for (const [x, y] of [[1510, -2670], [1780, -2670], [1510, -2260], [1780, -2260]]) bx(g, 0.14, 2.6, 0.14, "#3a2f26", wx(x), 0.05, wz(y));
    for (let y = -2670; y <= -2260; y += 30) bx(g, (1790 - 1500) * S, 0.08, 0.12, "#6b4a33", wx(1645), 2.65, wz(y), false);
    put(g, Sofa(2.4, "#e9e2d4"), 1645, -2640, 180, 0.08); put(g, Sofa(2.0, "#e9e2d4"), 1765, -2500, 90, 0.08); put(g, CoffeeTable(1.2, 0.7), 1645, -2560, 0, 0.08);
    put(g, Beanbag("#e07a3f"), 1560, -2470); put(g, Beanbag("#3fa06b"), 1620, -2420); put(g, Beanbag("#2aa7d8"), 1690, -2440);
    put(g, CafeSet(), 1560, -2330, 0, 0.05); put(g, CafeSet(), 1700, -2320, 0, 0.05); put(g, FloorLamp(), 1520, -2660, 0, 0.08); put(g, FloorLamp(), 1770, -2280, 0, 0.08);
    put(g, ParkBench(), 600, -2140, 180, 0.05); put(g, ParkBench(), 900, -2140, 180, 0.05); put(g, ParkBench(), 1200, -2140, 180, 0.05);
    [480, 1480].forEach((x) => put(g, PlantColumn(), x, -2680, 0, 0.05)); put(g, Planter(3.0), 1000, -2685, 0, 0.05); put(g, Dispenser(), 1480, -2160, 0, 0.05);
    // shower room
    const swc: WallOpt = { base: 0.05, h: 2.8, c: C.wallD, noLintel: 1 };
    patch(g, 1560, -2200, 1800, -1960, "#dfe8ee", { y: 0.05, th: 0.03, tile: true });
    wall(g, 1560, -2200, 1800, -2200, swc); wall(g, 1560, -2200, 1560, -1960, Object.assign({ gaps: [[-2150, -2095]] }, swc)); wall(g, 1560, -1960, 1800, -1960, swc); wall(g, 1800, -2200, 1800, -1960, swc);
    wall(g, 1680, -2200, 1680, -2110, Object.assign({}, swc, { h: 2.1 }));
    [-2170, -2120].forEach((y) => wall(g, 1680, y + 25, 1800, y + 25, Object.assign({}, swc, { h: 2.1 })));
    [-2180, -2130, -2080].forEach((y) => put(g, Shower(), 1755, y + 5, 0, 0.08));
    put(g, Lockers(2.0), 1620, -1975, 0, 0.08); put(g, Bench(), 1640, -2050, 0, 0.08); put(g, Sink(), 1575, -2060, -90, 0.08); put(g, Sink(), 1575, -2010, -90, 0.08);
    // fences
    FenceLine(g, 445, -2700, 1808, -2700); FenceLine(g, 445, -1950, 1300, -1950); FenceLine(g, 1390, -1950, 1560, -1950);
    FenceLine(g, 445, -2700, 445, 200); FenceLine(g, 1808, -2700, 1808, 200); FenceLine(g, 1150, -1250, 1150, 200);
    // jogging track around the sports area
    const trk = "#b4473a";
    patch(g, 355, -2840, 445, 295, trk, { y: 0, th: 0.06 }); patch(g, 1808, -2840, 1898, 295, trk, { y: 0, th: 0.06 });
    patch(g, 355, -2840, 1898, -2750, trk, { y: 0, th: 0.06 }); patch(g, 445, 205, 1808, 295, trk, { y: 0.04, th: 0.03 });
    const ln = (x1: number, y1: number, x2: number, y2: number) => bx(g, Math.max(Math.abs(wx(x2) - wx(x1)), 0.05), 0.01, Math.max(Math.abs(wz(y2) - wz(y1)), 0.05), "#ffffff", (wx(x1) + wx(x2)) / 2, 0.065, (wz(y1) + wz(y2)) / 2, false);
    ln(400, -2795, 400, 250); ln(1853, -2795, 1853, 250); ln(400, -2795, 1853, -2795); ln(400, 250, 1853, 250);
    for (const [x, y] of [[300, -1500], [1950, -1500], [300, -500], [1950, -800]]) put(g, ParkBench(), x, y, x < 1000 ? -90 : 90, 0);
    roomLabel(g, "Kolam Renang", 1010, -2380, 1.4); roomLabel(g, "Area Chill", 1645, -2470, 2.2); roomLabel(g, "Shower Room", 1680, -2080, 3.0); roomLabel(g, "Jogging Track", 400, -1000, 1.2);
    FenceLine(g, 445, -1250, 1050, -1250); FenceLine(g, 1250, -1250, 1808, -1250); FenceLine(g, 1345, -1950, 1345, -1250);
    roomLabel(g, "Lapangan Tenis", 800, -472, 1.8); roomLabel(g, "Lapangan Basket", 1480, -500, 1.8);
    // parking
    patch(g, 100, 1720, 1808, 2010, "#6c7179", { y: 0, th: 0.03 }); patch(g, 100, 1300, 445, 1720, "#6c7179", { y: 0, th: 0.03 }); patch(g, 1338, 1068, 1808, 1720, "#6c7179", { y: 0, th: 0.03 });
    for (let i = 0; i <= 5; i++) bx(g, 3.2, 0.01, 0.08, "#ffffff", wx(1724), 0.03, wz(1090 + i * 120), false);
    for (let i = 0; i <= 5; i++) { bx(g, 1.8, 0.01, 0.06, "#ffffff", wx(190), 0.03, wz(1305 + i * 87), false); bx(g, 1.8, 0.01, 0.06, "#ffffff", wx(380), 0.03, wz(1305 + i * 87), false); }
    const fc: WallOpt = { h: 1.1, base: 0, c: "#c9cdd2", cap: "#7d838b", noLintel: 1 };
    wall(g, 100, 1300, 100, 2010, fc); wall(g, 100, 2010, 1808, 2010, Object.assign({ gaps: [[940, 1160], [1340, 1760]] }, fc));
    wall(g, 1808, 1068, 1808, 2010, fc); wall(g, 100, 1300, 445, 1300, fc);
    for (const x of [940, 1160, 1340, 1760]) bx(g, 0.4, 1.5, 0.4, "#5c6168", wx(x), 0, wz(2010));
    // ===== sidewalk (diamond paving, yellow guiding blocks, trees & mulch) =====
    const sw = document.createElement("canvas"); sw.width = sw.height = 512;
    {
      const x = sw.getContext("2d")!;
      x.fillStyle = "#c4c6c8"; x.fillRect(0, 0, 512, 512);
      const dia = (cx: number, cyy: number, r: number, c: string) => { x.fillStyle = c; x.beginPath(); x.moveTo(cx, cyy - r); x.lineTo(cx + r, cyy); x.lineTo(cx, cyy + r); x.lineTo(cx - r, cyy); x.closePath(); x.fill(); };
      for (const [cx, cyy] of [[0, 0], [256, 0], [512, 0], [0, 256], [256, 256], [512, 256], [0, 512], [256, 512], [512, 512]]) dia(cx, cyy, 118, "#8e9297");
      for (const [cx, cyy] of [[128, 128], [384, 128], [128, 384], [384, 384]]) dia(cx, cyy, 46, "#dedfe0");
      x.strokeStyle = "rgba(70,70,70,.25)"; x.lineWidth = 2;
      for (let i = 0; i <= 512; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); }
    }
    { const w = 100, d = 5.6; const m = new THREE.Mesh(UB, new THREE.MeshLambertMaterial({ map: texFrom(sw, w / 4, d / 4) })); m.scale.set(w, 0.12, d); m.position.set(wx(1000), 0.06, wz(2150)); m.receiveShadow = true; g.add(m); }
    const tg = document.createElement("canvas"); tg.width = 64; tg.height = 64;
    { const x = tg.getContext("2d")!; x.fillStyle = "#efc12a"; x.fillRect(0, 0, 64, 64); x.fillStyle = "#c99b12"; for (let i = 4; i < 64; i += 12) x.fillRect(i, 6, 5, 52); }
    const tac = (x1: number, y1: number, x2: number, y2: number) => {
      const hz = y1 === y2, len = hz ? Math.abs(x2 - x1) * S + 0.4 : Math.abs(y2 - y1) * S + 0.4; const t = texFrom(tg, len / 0.4, 1); if (!hz) t.rotation = Math.PI / 2;
      const m = new THREE.Mesh(UB, new THREE.MeshLambertMaterial({ map: t })); if (hz) m.scale.set(len, 0.02, 0.4); else m.scale.set(0.4, 0.02, len); m.position.set(wx((x1 + x2) / 2), 0.13, wz((y1 + y2) / 2)); m.receiveShadow = true; g.add(m);
    };
    tac(-1500, 2115, -320, 2115); tac(-320, 2115, -320, 2205); tac(-320, 2205, 20, 2205); tac(20, 2205, 20, 2115); tac(20, 2115, 3500, 2115);
    patch(g, -1500, 2268, 3500, 2290, "#8a3b22", { y: 0, th: 0.15 });
    patch(g, -1500, 2290, 3500, 2650, "#4b4f55", { y: 0, th: 0.03 }); bx(g, 100, 0.16, 0.12, "#b9bcbf", wx(1000), 0, wz(2291), false);
    for (let x = -1500; x < 3500; x += 220) bx(g, 2.2, 0.01, 0.14, "#ffffff", wx(x + 60), 0.035, wz(2470), false);
    bx(g, 100, 0.01, 0.1, "#e8e8e8", wx(1000), 0.035, wz(2304), false); bx(g, 100, 0.01, 0.1, "#e8e8e8", wx(1000), 0.035, wz(2636), false);
    // hedge + white planters along the office fence
    // Segments stop at the two gates (gaps 940-1160 / 1340-1760 in the fence above); shrubs (r <= 0.5 m = 25 px) stay inside.
    for (const [a, b] of [[-1500, 940], [1160, 1340], [1760, 3500]]) {
      const len = (b - a) * S; bx(g, len, 0.95, 0.6, "#4e8a3c", wx((a + b) / 2), 0.12, wz(2028));
      for (let x = a + 30; x <= b - 25; x += 60) ico(g, 0.38 + rnd() * 0.12, rnd() > 0.5 ? "#4e8a3c" : "#5c9a46", wx(x), 1.05, wz(2028));
      for (let x = a + 150; x < b - 60; x += 300) { if (x > -300 && x < 0) continue; put(g, WhitePlanter(), x, 2048, 0, 0.12); }
    }
    // trees + mulch, wooden benches, white street lamps
    const vend = [[300, 90], [640, 90], [1250, 100], [1880, 90], [2270, 100]];
    // Keep both gate corridors clear: gate gaps ±60 px margin for the 1.25 m mulch pit.
    const gateLane = [[880, 1220], [1280, 1820]];
    for (let x = -1450; x < 3500; x += 240) { if (vend.some((v) => Math.abs(x - v[0]) < v[1]) || gateLane.some(([a, b]) => x >= a && x <= b)) continue; put(g, MulchPit(), x, 2235, 0, 0); put(g, TreeSlim(0.95 + rnd() * 0.2), x, 2235, rnd() * 360, 0.14); }
    [-1330, -850, 830, 2510, 2680].forEach((x) => put(g, ParkBench(), x, 2210, 0, 0.12));
    [-1450, -490, 470, 1250, 2150, 3110].forEach((x) => { put(g, StreetLamp("#e8e8e8"), x, 2278, 180, 0.12); const pl = new THREE.PointLight("#ffd98a", 0, 16, 1); pl.position.set(wx(x), 3.8, wz(2278) + 0.95); g.add(pl); streetLights.push(pl); });
    // street vendors (group, toggled from the visual settings)
    const vG = G(); g.add(vG); vendGroup = vG;
    put(vG, CoffeeBike(), 300, 2185, 90, 0.12); put(vG, Folk({ shirt: "#2a7a5a", pants: "#333", hair: "#1b1b1b" }), 300, 2150, 180, 0.12);
    put(vG, FoodCart(), 640, 2185, 0, 0.12); put(vG, Folk({ shirt: "#f0f0f0", pants: "#3b4f6e", hair: "#2d2420" }), 640, 2222, 0, 0.12);
    put(vG, PStool(), 565, 2175, 0, 0.12); put(vG, PStool("#2e86c1"), 715, 2175, 0, 0.12);
    put(vG, Folk({ shirt: "#9b5cc9", pants: "#2f3540", hair: "#5a3a24", sit: true }), 565, 2175, 90, 0.12);
    // Stall sits between the two gates (1160-1340 = 3.6 m; stall 2.9 m wide) so both entrances stay clear.
    put(vG, Stall("#e67e22"), 1250, 2195, 0, 0.12); put(vG, Folk({ shirt: "#c0392b", pants: "#333", hair: "#1b1b1b" }), 1250, 2222, 0, 0.12);
    put(vG, Folk({ shirt: "#2e86c1", pants: "#2f3540", hair: "#7a4b2a" }), 1250, 2140, 180, 0.12);
    put(vG, FoodCart(), 1880, 2185, 0, 0.12); put(vG, Folk({ shirt: "#f1c40f", pants: "#2f3540", hair: "#2d2420" }), 1880, 2222, 0, 0.12);
    roomLabel(vG, "Pedagang kaki lima", 1250, 2185, 2.9);
    put(vG, PecelLele(), -150, 2116, 0, 0.12);
    put(vG, Folk({ shirt: "#ffffff", pants: "#2f3540", hair: "#1b1b1b" }), -88, 2106, -90, 0.12);
    put(vG, Folk({ shirt: "#d14f6a", pants: "#3b4f6e", hair: "#5a3a24", sit: true }), -162, 2085, 180, 0.12);
    put(vG, Folk({ shirt: "#3f7fd1", pants: "#2f3540", hair: "#1b1b1b", sit: true }), -192, 2085, 180, 0.12);
    put(vG, Folk({ shirt: "#e0b02f", pants: "#2f3540", hair: "#2d2420", sit: true }), -162, 2150, 0, 0.12);
    roomLabel(vG, "Pecel Lele Lamongan", -150, 2116, 3.1);
    put(vG, KopiCart(), 2270, 2172, 0, 0.12);
    put(vG, Folk({ shirt: "#d7262b", pants: "#2f3540", hair: "#1b1b1b" }), 2302, 2205, 0, 0.12);
    const cust = Folk({ shirt: "#8a6a52", pants: "#3a3f46", hair: "#1b1b1b" }); put(vG, cust, 2262, 2128, 180, 0.12);
    { const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mat("#1c1e21")); h.position.set(0, 1.62, 0); cust.add(h); }
    put(vG, Bicycle(), 2205, 2135, 90, 0.12);
    roomLabel(vG, "Kopi Keliling", 2270, 2172, 3.0);
    // trees
    [[250, 200, 1.2], [140, 470, 1], [330, 640, 1.3], [190, 900, 1.1], [330, 1140, 1], [110, 1180, 0.9], [620, -3000, 1.2], [1000, -3030, 1.4], [1400, -2990, 1.1], [1760, -3020, 1.3], [120, -2300, 1.2], [2120, -2300, 1.3], [150, -2900, 1.1], [2100, -2950, 1.2], [250, -600, 1.2], [2000, -500, 1.3], [250, -1500, 1.3], [2000, -1600, 1.2],
      [1960, 300, 1.2], [2060, 720, 1.4], [1930, 1120, 1], [2070, 1520, 1.3], [1950, 1860, 1.1], [-120, 1520, 1.2], [-160, 1900, 1], [200, 2760, 1.3], [820, 2790, 1.1], [1500, 2760, 1.4], [2150, 2780, 1.2], [-400, 2770, 1]]
      .forEach((t, i) => put(g, Tree(t[2], i % 2), t[0], t[1], rnd() * 360, 0));
    // pedestrians
    const shirts = ["#e07a3f", "#3fa06b", "#d14f6a", "#3f7fd1"];
    for (let i = 0; i < 4; i++) {
      const p = Folk({ shirt: shirts[i], pants: i % 2 ? "#3b4f6e" : "#2f3540", hair: i % 2 ? "#5a3a24" : "#1b1b1b" });
      const z = wz(i % 2 ? 2060 : 2085); const dir = i % 2 ? 1 : -1; add(g, p, -20 + i * 12, z, dir > 0 ? -90 : 90, 0.12); walkers.push({ p, dir, speed: 1.05 + rnd() * 0.35, ph: rnd() * 6 });
    }
    // traffic: two opposing lanes, built along local Z with the front at -Z (like the parked Car reference)
    const tire = (o: THREE.Group, wl: THREE.Mesh[], r: number, w: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), mat("#1e2126")); m.rotation.z = Math.PI / 2; m.position.set(x, r, z); m.castShadow = true; o.add(m); wl.push(m);
    };
    const Car = (c: string, wl: THREE.Mesh[]) => {
      const o = G(); bx(o, 1.8, 0.62, 4.2, c, 0, 0.3, 0); bx(o, 1.6, 0.6, 2.2, c, 0, 0.92, 0.2); bx(o, 1.64, 0.4, 2.0, "#2a3a4c", 0, 1.0, 0.2, false);
      for (const sx of [-1, 1]) { for (const sz of [-1, 1]) tire(o, wl, 0.34, 0.24, sx * 0.86, sz * 1.35); bx(o, 0.32, 0.12, 0.02, "#fff6c8", sx * 0.6, 0.66, -2.11, false); bx(o, 0.32, 0.12, 0.02, "#d33", sx * 0.6, 0.66, 2.11, false); }
      return o;
    };
    // TransJakarta side-label material, one per variant (shared by every bus of that variant; disposed with the scene)
    const tjMats = new Map<"blue" | "orange", THREE.MeshLambertMaterial>();
    const tjLabelMat = (variant: "blue" | "orange") => {
      let m = tjMats.get(variant);
      // accent-coloured text on the white body, lit like the body (Lambert) so it doesn't glow at night;
      // orange is darkened (#c8570a) for contrast on white
      if (!m) { m = new THREE.MeshLambertMaterial({ map: makeTextTex("TransJakarta", null, variant === "blue" ? "#1f4e9c" : "#c8570a"), transparent: true, alphaTest: 0.05, depthWrite: false }); tjMats.set(variant, m); }
      return m;
    };
    const BusTJ = (variant: "blue" | "orange", wl: THREE.Mesh[]) => {
      // TransJakarta livery (t_1fd4427f): both variants have a WHITE body; accent (blue / orange) on the
      // lower skirt, a belt stripe under the windows, roof and front face.
      const o = G(); const L = 9.2, W = 2.4;
      const blue = variant === "blue";
      const bodyColor = "#f5f5f5";
      const accentColor = blue ? "#1f4e9c" : "#f07c1b";
      const roofColor = accentColor;
      const frontColor = accentColor;
      const darkColor = "#1a2a3a";
      bx(o, W, 2.55, L, bodyColor, 0, 0.4, 0);                                   // main body (0.4..2.95)
      bx(o, W, 0.35, L, roofColor, 0, 2.95, 0);                                  // roof (2.95..3.3)
      bx(o, W + 0.02, 0.6, L + 0.02, accentColor, 0, 0.4, 0, false);             // lower skirt (0.4..1.0)
      bx(o, W + 0.02, 0.14, L + 0.02, accentColor, 0, 1.3, 0, false);            // belt stripe under the windows
      // "TransJakarta" lettering on both flanks (t_2e577fdc): on the white band between the skirt top (y 1.0) and
      // the belt stripe (y 1.3), centred at y 1.15, z -2.2..1.0 (clear of the door at z -3.95..-3.05).
      // PlaneGeometry faces +Z: rotate -PI/2 on the left (-X) and +PI/2 on the right (+X) so each faces outward
      // and reads left-to-right (not mirrored). Offset 0.03 sits just outside the body/skirt (W/2 + 0.01) -> no z-fighting.
      const tjMat = tjLabelMat(variant);
      const tlL = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.3), tjMat);
      tlL.rotation.y = -Math.PI / 2; tlL.position.set(-W / 2 - 0.03, 1.15, -0.6); o.add(tlL);
      const tlR = new THREE.Mesh(tlL.geometry, tjMat);
      tlR.rotation.y = Math.PI / 2; tlR.position.set(W / 2 + 0.03, 1.15, -0.6); o.add(tlR);
      for (const sx of [-1, 1]) bx(o, 0.04, 0.9, L - 0.5, darkColor, sx * (W / 2 + 0.01), 1.6, 0.1, false); // window strip
      bx(o, W + 0.02, 2.9, 0.04, frontColor, 0, 0.4, -L / 2 - 0.01, false);      // front face (0.4..3.3)
      bx(o, W - 0.4, 1.0, 0.04, darkColor, 0, 1.8, -L / 2 - 0.03, false);        // windshield
      bx(o, W - 0.3, 1.2, 0.04, darkColor, 0, 1.55, L / 2 + 0.01, false);        // rear window
      bx(o, 0.04, 2.0, 0.9, darkColor, W / 2 + 0.02, 0.75, -3.5, false);         // door (right side, front)
      for (const sx of [-1, 1]) {
        for (const sz of [-3.0, 3.0]) {
          tire(o, wl, 0.5, 0.3, sx * 1.08, sz);
          // silver rim on the outer face of each tyre
          const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 14), mat("#cfd3d8"));
          rim.rotation.z = Math.PI / 2; rim.position.set(sx * (1.08 + 0.16), 0.5, sz); o.add(rim);
        }
        bx(o, 0.36, 0.16, 0.02, "#fff6c8", sx * 0.85, 0.75, -L / 2 - 0.04, false); // headlights
        bx(o, 0.36, 0.16, 0.02, "#d33", sx * 0.85, 0.75, L / 2 + 0.03, false);     // taillights
      }
      return o;
    };
    // [kind, colour, lane y (floor-plan px), start x (px)]; one speed per lane so nothing overtakes or overlaps.
    const LANE_SPEED: Record<number, number> = { 2385: 5.2, 2555: 4.4 };
    ([["car", "#d0302a", 2385, -1200], ["bus", "blue", 2385, 300], ["car", "#2f6fd0", 2385, 1900],
      ["car", "#f2f2ef", 2555, 3200], ["bus", "orange", 2555, 1700], ["car", "#9aa3ad", 2555, 100]] as const).forEach(([kind, col, ly, sx]) => {
      const wl: THREE.Mesh[] = []; const v = kind === "bus" ? BusTJ(col as "blue" | "orange", wl) : Car(col, wl); const dir = ly === 2385 ? 1 : -1;
      add(g, v, wx(sx), wz(ly), dir > 0 ? -90 : 90, 0.03); vehicles.push({ p: v, dir, speed: LANE_SPEED[ly], wheels: wl, r: kind === "bus" ? 0.5 : 0.34 });
    });
    // guard & clouds
    const c = Folk({ shirt: "#2a3b55", pants: "#222" }); put(g, c, 1150, 1880, 180, 0);
    for (let i = 0; i < 26; i++) { const cl = Cloud(); cl.position.set(-110 + rnd() * 220, 22 + rnd() * 26, -120 + rnd() * 190); cl.scale.setScalar(0.7 + rnd() * 1.1); cl.rotation.y = rnd() * 6; scene.add(cl); clouds.push(cl); }
    roomLabel(g, "Area Parkir Mobil", 1600, 1400, 1.6); roomLabel(g, "Parkir Motor", 285, 1520, 1.6);
    roomLabel(g, "Area Parkir", 700, 1880, 1.2);
  }

  buildSite(site); buildL1(floors[1]); buildL2(floors[2]); buildL3(floors[3]); buildRoof(floors[4]);
  const facade = G(); scene.add(facade); buildFacade(facade);

  /* ====== View modes ====== */
  let mode: FloorMode = "all"; const yTarget: Record<number, number> = { 1: 0, 2: LH, 3: 2 * LH, 4: 3 * LH };
  for (const n of [1, 2, 3, 4] as const) floors[n].position.y = yTarget[n];
  function facadeVis() { facade.visible = (mode === "all" || mode === 4) && !lowWalls; floors[4].visible = (mode === "all" || mode === "x" || mode === 4) && !lowWalls; }
  // Style-2 network hubs; on Lantai 1 the tracked desks are wired to the hub.
  {
    scene.updateMatrixWorld(true);
    const hubs: Record<number, number[]> = { 1: [505, 467], 2: [980, 795], 3: [1100, 960] };
    for (const n of [1, 2, 3] as const) {
      const g = G(); floors[n].add(g); g.visible = false; style2Only.push(g);
      const hx = wx(hubs[n][0]), hz = wz(hubs[n][1]); add(g, Hub(), hx, hz, 0, FT);
      const seg = (x1: number, z1: number, x2: number, z2: number) => { const m = new THREE.Mesh(UB, netMat); m.scale.set(Math.max(Math.abs(x2 - x1), 0.05), 0.02, Math.max(Math.abs(z2 - z1), 0.05)); m.position.set((x1 + x2) / 2, FT + 0.035, (z1 + z2) / 2); g.add(m); };
      if (n === 1) deskAnchors.forEach((a) => { const p = a.position; seg(p.x, p.z, hx, p.z); seg(hx, p.z, hx, hz); });
    }
  }
  function setMode(m: FloorMode) {
    mode = m;
    for (const n of [1, 2, 3, 4] as const) {
      floors[n].visible = (m === "all" || m === "x" || (typeof m === "number" && n <= m)) && !(n === 4 && lowWalls);
      yTarget[n] = m === "x" ? (n - 1) * (LH + 5.5) : (n - 1) * LH;
    }
    facadeVis();
  }

  /* ====== Weather ====== */
  let weather: Weather = "clear";
  const RN = 5000, rainPos = new Float32Array(RN * 6);
  for (let i = 0; i < RN; i++) { const x = (rnd() - 0.5) * 90, y = rnd() * 45, z = (rnd() - 0.5) * 90; rainPos.set([x, y, z, x + 0.04, y - 0.75, z], i * 6); }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: "#b7cbe0", transparent: true, opacity: 0.55 })); rain.visible = false; rain.frustumCulled = false; scene.add(rain);
  const SN = 3500, snowPos = new Float32Array(SN * 3), snowPh = new Float32Array(SN);
  for (let i = 0; i < SN; i++) { snowPos.set([(rnd() - 0.5) * 90, rnd() * 45, (rnd() - 0.5) * 90], i * 3); snowPh[i] = rnd() * 6.28; }
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage));
  const flakeCv = document.createElement("canvas"); flakeCv.width = flakeCv.height = 32;
  { const x = flakeCv.getContext("2d")!; const gg = x.createRadialGradient(16, 16, 0, 16, 16, 16); gg.addColorStop(0, "rgba(255,255,255,1)"); gg.addColorStop(0.6, "rgba(255,255,255,.7)"); gg.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gg; x.fillRect(0, 0, 32, 32); }
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.28, map: new THREE.CanvasTexture(flakeCv), transparent: true, depthWrite: false })); snow.visible = false; snow.frustumCulled = false; scene.add(snow);
  function setWeather(w: Weather) { weather = w; rain.visible = w === "rain"; snow.visible = w === "snow"; setNight(nightOn); }
  function updateWeather(dt: number, t: number, target: THREE.Vector3) {
    if (rain.visible) {
      for (let i = 0; i < RN; i++) { const k = i * 6; let y = rainPos[k + 1] - 30 * dt; if (y < 0) y += 45; rainPos[k + 1] = y; rainPos[k + 4] = y - 0.75; }
      rainGeo.attributes.position.needsUpdate = true; rain.position.set(target.x, 0, target.z);
    }
    if (snow.visible) {
      for (let i = 0; i < SN; i++) { const k = i * 3; let y = snowPos[k + 1] - 1.6 * dt; if (y < 0) y += 45; snowPos[k + 1] = y; snowPos[k] += Math.sin(t * 0.8 + snowPh[i]) * 0.4 * dt; }
      snowGeo.attributes.position.needsUpdate = true; snow.position.set(target.x, 0, target.z);
    }
  }

  /* ====== Day / night ====== */
  const bgCol = new THREE.Color("#bfe6f6");
  function setNight(n: boolean) {
    nightOn = n; glowSprites.forEach((sp) => (sp.visible = n));
    const cc = new THREE.Color(styleNo === 3 ? (n ? "#18191b" : "#2b2d30") : n ? "#0f1828" : styleNo === 2 ? "#eef3fa" : "#bfe6f6");
    if (weather === "rain") cc.lerp(new THREE.Color(n ? "#151a20" : "#8e99a6"), 0.55);
    if (weather === "snow") cc.lerp(new THREE.Color(n ? "#2a3240" : "#dfe6ee"), 0.5);
    bgCol.copy(cc); (scene.background as THREE.Color).copy(cc); (scene.fog as THREE.Fog).color.copy(cc);
    let hi = n ? 0.38 : 0.62, si = n ? 0.22 : 0.85;
    hemi.color.set(n ? "#8ea4d8" : "#ffffff"); hemi.groundColor.set(n ? "#253040" : styleNo === 2 ? "#dfe6ef" : "#8fae7a");
    sun.color.set(n ? "#9fb7ff" : "#fff4e2");
    if (styleNo === 3 && !n) { hi = 0.72; hemi.color.set("#fff1dc"); hemi.groundColor.set("#3a3530"); si = 0.8; sun.color.set("#ffe7c4"); }
    if (weather === "rain") { si *= 0.45; hi *= 0.85; } else if (weather === "snow") si *= 0.75;
    hemi.intensity = hi * PI; sun.intensity = si * PI;
    winMat.emissive.set(n ? "#ffcc70" : "#000000"); winMat.emissiveIntensity = n ? 0.7 : 0; facadeGlass.emissive.set(n ? "#ffcc70" : "#000000"); facadeGlass.emissiveIntensity = n ? 0.35 : 0;
    lampMat.emissiveIntensity = n ? 1.1 : 0.15; screenMat.emissiveIntensity = n ? 0.95 : 0.55;
    streetLights.forEach((l) => (l.intensity = n ? 1.4 * PI * 1.5 : 0));
    cornerLamps.forEach((l) => (l.intensity = (n ? LAMP.nightI : LAMP.dayI) * PI));
    ringMats.forEach((m) => (m.emissiveIntensity = n ? 0.9 : 0.12)); letterMats.forEach((m) => (m.emissiveIntensity = n ? 0.9 : 0.25));
    clouds.forEach((c) => (c.visible = !n && showClouds));
  }

  /* ====== Styles ====== */
  const S2: Record<string, string> = {
    d9d6d0: "f5f7fa", "3e4448": "8593a8", "2b2e31": "c5cfdc", "77735a": "e1e8f2", a3a8ae: "e4e9f0", "86cf5f": "c3dbc9", "6c7179": "8e99ab",
    b9bcbf: "e6eaf0", "9aa0a6": "e3e8ef", "3f6f58": "dbe6f7", "3b8f3a": "6f9ee8", "43a043": "7eabf0", "4aa545": "9cc0f5", "55b84d": "a9c9f7", "62c457": "c9dcfa", "4f9a3c": "7ba7ee", "68b24a": "a3c3f5", "7cc256": "d3e3fb", "5bbf52": "b8d2f8", "3f7f3a": "6b98e3", "3f8a3a": "6f9ee8", "4f9a45": "86aeef", "4f9a4a": "86aeef", "58a64c": "94b8f2", "5aa84f": "94b8f2", "5fb455": "a6c5f5", "62b455": "a6c5f5", "64b35a": "aecbf6", "9b7856": "e3ecf9", "86674a": "c6d7f1", "2a2d31": "2c4596", "4e8a3c": "8fb4ee", "5c9a46": "a6c4f3", "7b5233": "c5cfdc", "4e3e30": "b9c3cf", "3c9b55": "4d8bff", "2f7a4a": "cfe0f8", "2a7f68": "3a74e8", "2f6a55": "d6e4fa", b4473a: "5b8def", "3f8a5c": "cfe0f6", "2f5f9e": "3d7bf2", c0673e: "5b8def",
    "4f9b6e": "dde8f5", "3d3f42": "e4eaf3", b8a68c: "e9eef6", "6f6b4f": "e0e8f3", "4a4d52": "dfe6f1", "8c8a6a": "e5edf7", c9b89a: "eef2f8",
    "34495e": "c8d8f0", a0623a: "dbe5f3", "1f3a6b": "a8c2ec", b8bcc1: "e7ebf1", c4c8cc: "e7ebf1", "8a3b22": "c9d6e6", a99273: "dfe8f6", "8a4b2a": "2c4596", "6e3c22": "243a80",
    "8b6f6a": "e8edf5", e9e2d4: "eef2f8", "7b5b45": "2c4596", "1f2124": "2a49b8", c49a6c: "dcb98a", b8895a: "dcb98a", "8b6040": "d4b080", a7774f: "dcb98a", "9a6a43": "dcb98a",
    b5713a: "dcb98a", "6b4a33": "cfa877", "3a2f26": "cfd7e2", "1c1e21": "c9d2de", "1f2226": "c9d2de", "25282c": "c9d2de", "3a3f46": "b9c3cf", "7d838b": "cdd5e0", "5c6168": "cdd5e0",
    "8a9098": "d8dee7", c9cdd2: "e6ebf1", "2f343a": "b9c3cf", "2f3d33": "b9c3cf", eae6df: "ffffff", efe9df: "ffffff", f3efe8: "ffffff", ece6da: "ffffff", f2efe9: "ffffff", "40454c": "f1f3f6",
  };
  Object.keys(S2).forEach((k) => { const a = tint("#" + k, 0.18).slice(1), b = tint("#" + S2[k], 0.18).slice(1); if (!S2[a]) S2[a] = b; });
  function gridCanvas(step: number) {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d")!; x.fillStyle = "#e2e8f1"; x.fillRect(0, 0, 256, 256);
    x.fillStyle = "rgba(95,118,160,.30)"; for (let i = 0; i <= 256; i += step) { x.fillRect(i, 0, 1.5, 256); x.fillRect(0, i, 256, 1.5); } return c;
  }
  let GRID2: HTMLCanvasElement | null = null;
  const S3: Record<string, string> = {
    "86cf5f": "8c9a66", "6c7179": "55524d", "3f6f58": "6d7a5a", d9d6d0: "f0e4d0", "3e4448": "e4d3b8", "2b2e31": "d8c3a2", "77735a": "e9d7bb", a3a8ae: "d9c4a3", "3d3f42": "f2ede5", b8a68c: "f2ede5", "6f6b4f": "efe6d8",
    "4a4d52": "ece4d6", "8c8a6a": "efe8dc", c9b89a: "f3eee6", "34495e": "e6d6be", a0623a: "efe2cf", "1f3a6b": "e8dccb", "8a4b2a": "efe9df", "6e3c22": "e7ddcc", "8b6f6a": "e6c7b8",
    e9e2d4: "f1ece4", "7b5b45": "e6c7b8", "1f2124": "f0e9dd", c49a6c: "f4f0e8", b8895a: "f1ebe0", "25282c": "b9bcc0", "1c1e21": "cfc6b8", "1f2226": "cfc6b8", "3a3f46": "a9adb2",
    "7d838b": "d9cdb9", "8b6040": "e9dcc6", a7774f: "efe4d2", b8bcc1: "ece4d6", c4c8cc: "ece4d6",
  };
  Object.keys(S3).forEach((k) => { const a = tint("#" + k, 0.18).slice(1), b = tint("#" + S3[k], 0.18).slice(1); if (!S3[a]) S3[a] = b; });
  let showClouds = true, envScope: Scope = "all";
  function updateEnv() {
    site.visible = envScope === "all"; voidFloor.visible = envScope !== "all";
    (voidFloor.material as THREE.MeshLambertMaterial).color.set(styleNo === 3 ? "#26282b" : styleNo === 2 ? "#dde5f0" : "#cfd5db");
    clouds.forEach((c) => (c.visible = showClouds && !nightOn));
  }
  function applyStyle(n: StyleNo) {
    styleNo = n; const two = n === 2, three = n === 3; const grid = (GRID2 = GRID2 || gridCanvas(64));
    Object.values(mats).forEach((m) => {
      if (m.userData.c1 === undefined) m.userData.c1 = m.color.getHexString();
      const t = (two && S2[m.userData.c1]) || (three && S3[m.userData.c1]); m.color.set("#" + (t || m.userData.c1));
    });
    concList.forEach((m) => { if (m.userData.map1 === undefined) m.userData.map1 = m.map; m.map = two || three ? null : m.userData.map1; m.color.set(two ? "#93a1b6" : three ? "#eadcc4" : "#ffffff"); m.needsUpdate = true; });
    tileList.forEach((m) => {
      if (m.userData.map1 === undefined) { m.userData.map1 = m.map; m.userData.map2 = texFrom(grid, m.map!.repeat.x / 2, m.map!.repeat.y / 2); }
      m.map = two ? m.userData.map2 : m.userData.map1; m.needsUpdate = true;
    });
    slabTops.forEach((t) => { if (!t.t2) t.t2 = texFrom(grid, t.tt.repeat.x, t.tt.repeat.y); t.top.map = two ? t.t2 : woodFloor || three ? t.tw : t.tt; t.top.needsUpdate = true; });
    s2Custom.forEach((o) => { if (o.c1 === undefined) o.c1 = "#" + o.m.color.getHexString(); o.m.color.set(two ? o.c2 : o.c1); });
    styleSwap.forEach(([a, b, c]) => { a.visible = n === 1; b.visible = two; c.visible = three; });
    style2Only.forEach((o) => (o.visible = two)); style3Only.forEach((o) => (o.visible = three));
    updateEnv();
    setNight(nightOn);
  }
  function setWood(on: boolean) { woodFloor = on; slabTops.forEach((t) => { t.top.map = styleNo === 2 && t.t2 ? t.t2 : woodFloor || styleNo === 3 ? t.tw : t.tt; t.top.needsUpdate = true; }); }
  function applyLow() { for (const w of wallSubs) w.sub.scale.y = lowWalls ? Math.min(1, LOW / w.h) : 1; for (const m of lowHide) m.visible = !lowWalls; facadeVis(); setMode(mode); }

  setMode("all"); setNight(false);

  return {
    floors, yTarget, deskScreens, cornerLamps, labels,
    get mode() { return mode; },
    get night() { return nightOn; },
    get style() { return styleNo; },
    get lowWalls() { return lowWalls; },
    get scope() { return envScope; },
    setMode, setNight, applyStyle, setWeather, setWood,
    setScope(s: Scope) { envScope = s; updateEnv(); },
    setClouds(on: boolean) { showClouds = on; updateEnv(); },
    setLow(on: boolean) { lowWalls = on; applyLow(); },
    setVendors(on: boolean) { if (vendGroup) vendGroup.visible = on; },
    labelVisible(f: number) {
      if (f === 0) return envScope === "all";
      if (mode === "all") return f === (lowWalls ? 3 : 4);
      if (mode === "x") return true;
      return f === mode;
    },
    update(dt: number, t: number, target: THREE.Vector3) {
      for (const n of [1, 2, 3, 4] as const) { const g = floors[n]; g.position.y += (yTarget[n] - g.position.y) * Math.min(1, dt * 6); }
      updateWeather(dt, t, target);
      for (const w of walkers) {
        w.p.position.x += w.dir * w.speed * dt; if (w.p.position.x > 34) w.p.position.x = -19.6; if (w.p.position.x < -19.6) w.p.position.x = 34;
        w.ph += dt * w.speed * 5.4; const swg = Math.sin(w.ph);
        for (const pt of (w.p.userData.parts as THREE.Object3D[]) || [w.p]) {
          const u = pt.userData; if (!u.legs) continue;
          u.legs[0].rotation.x = swg * 0.5; u.legs[1].rotation.x = -swg * 0.5; u.arms[0].rotation.x = -swg * 0.4; u.arms[1].rotation.x = swg * 0.4;
        }
        w.p.position.y = 0.12 + (1 - Math.cos(2 * w.ph)) * 0.012;
      }
      for (const v of vehicles) {
        v.p.position.x += v.dir * v.speed * dt;
        if (v.p.position.x > ROAD_X1) v.p.position.x = ROAD_X0; if (v.p.position.x < ROAD_X0) v.p.position.x = ROAD_X1;
        for (const w of v.wheels) w.rotation.x -= (v.speed * dt) / v.r;
      }
      for (const c of clouds) { c.position.x += dt * 0.6; if (c.position.x > 115) c.position.x = -115; }
    },
  };
}
