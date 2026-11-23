// NAC (Non Agent Character): background characters that make the Town Hall feel inhabited.
//
// They are scenery, NOT agents: no name label, no hit box (never selectable), no API data.
// To read clearly as "not an agent" they differ from OfficeScene3D.buildAgent() on purpose:
//   - eyes: white (#FFFFFF) instead of dark, no status lamp
//   - antenna: short and curved (agents have a straight stalk + coloured status lamp)
//   - clothes: neutral grey (#888888 / #999999) instead of the agent's colour
//   - size: 0.85x the agent model
// The receptionist (Lantai 1 lobby desk) is a NAC too: female, navy blazer, seated with a light idle (turn / nod).
//
// Layout (floor-plan px, see townhall.ts wx/wz): 20 NACs + receptionist
//   Lantai 1 Ruang Kerja 5 · Lantai 2 Area Kerja Agen (orbs) 4 · Lobby 4 · outside 4 · corridors/stairs 3
// Paths are short straight lanes inside open floor area (no wall crossings); walkers pace slowly and pause at the ends.
import * as THREE from "three";
import { FT, wx, wz, type TownHall } from "./townhall";

const NAC_SCALE = 0.85;
const GREYS = ["#888888", "#999999", "#8f8f8f", "#949494"];
const NAC_PANTS = "#5c5f63";
const SKINS = ["#f1c9a5", "#d9a273", "#a8754f", "#f5d6b8", "#8d5a3b", "#e3b48c"];
const HAIRS = ["#3a3632", "#4a4540", "#2e2b29", "#5b544d"]; // muted, no bright hair
const RECEPTION = { blazer: "#003366", shirt: "#ffffff", skirt: "#1f2a3a", hair: "#2a1d17" };

type Face = "N" | "S" | "E" | "W";
const FACE: Record<Face, number> = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

interface NacSpec { where: 0 | 1 | 2; a: [number, number]; b?: [number, number]; face?: Face; y?: number; long?: boolean }

/** 0 = outdoor site group, 1/2 = floor group. y defaults to FT (slab top) inside, 0 outside. */
const SPECS: NacSpec[] = [
  // Lantai 1 - Ruang Kerja (desk rows at x 1566 / 1788)
  { where: 1, a: [1650, 360], b: [1650, 760] },
  { where: 1, a: [1705, 745], b: [1705, 390], long: true },
  { where: 1, a: [1620, 487], face: "W" },            // chatting behind a west-row desk
  { where: 1, a: [1730, 562], face: "E", long: true }, // looking at an east-row screen
  { where: 1, a: [1690, 752], face: "S" },            // at the water dispenser
  // Lantai 2 - Area Kerja Agen, around the Claude / OpenCode orbs
  { where: 2, a: [690, 795], b: [1290, 795] },
  { where: 2, a: [1290, 595], b: [690, 595], long: true },
  { where: 2, a: [580, 875], face: "N" },             // watching the orbs
  { where: 2, a: [1300, 740], face: "W", long: true },
  // Lobby (reception desk front faces west, main door at x 995-1105 on y 1720)
  { where: 1, a: [800, 1605], b: [1080, 1605] },
  { where: 1, a: [1050, 1705], b: [1050, 1635], long: true },
  { where: 1, a: [1100, 1690], face: "E" },           // guest at the reception counter
  { where: 1, a: [1000, 1660], face: "W" },
  // Outside: car park, forecourt parking, sidewalk, garden
  { where: 0, a: [1600, 1150], b: [1600, 1650], y: 0.03 },
  { where: 0, a: [500, 1850], b: [900, 1850], y: 0.03, long: true },
  { where: 0, a: [1250, 2175], b: [1950, 2175], y: 0.12 },
  { where: 0, a: [1930, 380], b: [1930, 1040], y: 0, long: true },
  // Corridors / stairs
  { where: 1, a: [1175, 1100], b: [1175, 1540] },
  { where: 1, a: [1240, 1275], face: "N" },           // at the foot of the stairs
  { where: 2, a: [1225, 1110], b: [1225, 1620], long: true },
];

interface Nac {
  root: THREE.Group; body: THREE.Group; head: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  a?: THREE.Vector2; b?: THREE.Vector2; toB: boolean; pause: number; speed: number; ph: number; baseRot: number;
  seated?: boolean;
}

export interface NacCrowd { count: number; update(dt: number, t: number): void }

export function createNACs(th: TownHall): NacCrowd {
  const mats = new Map<string, THREE.Material>(), geos = new Map<string, THREE.BufferGeometry>();
  const lam = (c: string) => { let m = mats.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); mats.set(c, m); } return m; };
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#ffffff" }); // pure white, unlit: reads as "blank" NAC eyes
  const geo = <T extends THREE.BufferGeometry>(k: string, mk: () => T) => { let g = geos.get(k); if (!g) { g = mk(); geos.set(k, g); } return g as T; };
  const box = (p: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: string | THREE.Material, sh = true) => {
    const mesh = new THREE.Mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), typeof m === "string" ? lam(m) : m);
    mesh.position.set(x, y + h / 2, z); mesh.castShadow = sh; mesh.receiveShadow = true; p.add(mesh); return mesh;
  };
  // Short curved antenna: bends forward-sideways, ends in a small grey bead (no status colour).
  const antennaGeo = geo("nacAnt", () => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.005, 0.085, 0), new THREE.Vector3(0.075, 0.1, 0.03)), 10, 0.013, 6, false));
  const beadGeo = geo("nacBead", () => new THREE.SphereGeometry(0.028, 8, 6));

  /** Agent-shaped body (faces +z like OfficeScene3D agents), model units before NAC_SCALE. */
  function build(o: { shirt: string; pants: string; skin: string; hair: string; long?: boolean; reception?: boolean }) {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body); body.scale.setScalar(NAC_SCALE);
    box(body, 0.44, 0.48, 0.26, 0, 0.45, 0, o.shirt);
    if (o.reception) { // blazer: white shirt V + lapels
      box(body, 0.12, 0.2, 0.01, 0, 0.73, 0.131, RECEPTION.shirt, false);
      for (const s of [-1, 1]) { const l = box(body, 0.05, 0.22, 0.012, s * 0.075, 0.71, 0.134, "#0a2747", false); l.rotation.z = s * 0.35; }
    }
    const head = new THREE.Group(); head.position.set(0, 0.93, 0); body.add(head);
    box(head, 0.36, 0.34, 0.34, 0, 0.02, 0, o.skin);
    box(head, 0.4, 0.12, 0.38, 0, 0.32, 0, o.hair);                   // hair top
    if (o.long) {                                                       // long hair down to the shoulders
      box(head, 0.4, 0.5, 0.1, 0, -0.16, -0.17, o.hair);
      for (const s of [-1, 1]) box(head, 0.06, 0.4, 0.3, s * 0.2, -0.06, -0.02, o.hair, false);
    } else box(head, 0.4, 0.24, 0.1, 0, 0.1, -0.16, o.hair);
    for (const s of [-1, 1]) {
      box(head, 0.08, 0.1, 0.012, s * 0.08, 0.13, 0.172, "#3a3a3a", false); // dark socket behind the eye for contrast
      box(head, 0.055, 0.075, 0.02, s * 0.08, 0.142, 0.175, eyeMat, false);  // white eye
    }
    const ant = new THREE.Mesh(antennaGeo, lam("#6f7378")); ant.position.set(0, 0.44, 0); ant.castShadow = true; head.add(ant);
    const bead = new THREE.Mesh(beadGeo, lam("#bdbdbd")); bead.position.set(0.075, 0.54, 0.03); head.add(bead);
    const limb = (x: number, y: number, w: number, h: number, d: number, c: string) => { const g = new THREE.Group(); g.position.set(x, y, 0); body.add(g); box(g, w, h, d, 0, -h, 0, c); return g; };
    const legL = limb(-0.11, 0.45, 0.17, 0.45, 0.19, o.pants), legR = limb(0.11, 0.45, 0.17, 0.45, 0.19, o.pants);
    const armL = limb(-0.29, 0.91, 0.13, 0.42, 0.15, o.shirt), armR = limb(0.29, 0.91, 0.13, 0.42, 0.15, o.shirt);
    for (const a of [armL, armR]) box(a, 0.11, 0.08, 0.12, 0, -0.5, 0, o.skin, false); // hands
    return { root, body, head, legL, legR, armL, armR };
  }

  const parentOf = (w: 0 | 1 | 2) => (w === 0 ? th.site : th.floors[w]);
  const nacs: Nac[] = [];
  SPECS.forEach((s, i) => {
    const m = build({ shirt: GREYS[i % GREYS.length], pants: NAC_PANTS, skin: SKINS[(i * 7) % SKINS.length], hair: HAIRS[i % HAIRS.length], long: s.long });
    const y = s.y ?? (s.where === 0 ? 0 : FT);
    m.root.position.set(wx(s.a[0]), y, wz(s.a[1]));
    parentOf(s.where).add(m.root);
    const n: Nac = { ...m, toB: true, pause: (i % 5) * 0.7, speed: 0.45 + ((i * 37) % 20) / 100, ph: i * 1.7, baseRot: FACE[s.face || "S"] };
    if (s.b) { n.a = new THREE.Vector2(wx(s.a[0]), wz(s.a[1])); n.b = new THREE.Vector2(wx(s.b[0]), wz(s.b[1])); n.baseRot = Math.atan2(n.b.x - n.a.x, n.b.y - n.a.y); }
    m.root.rotation.y = n.baseRot;
    nacs.push(n);
  });

  /* ---------- Receptionist (Task 4): seated behind the lobby reception desk, facing the lobby (west) ---------- */
  {
    const SEAT = 0.62; // tall receptionist chair so the head clears the 1.1 m counter
    const r = build({ shirt: RECEPTION.blazer, pants: RECEPTION.skirt, skin: "#e3b48c", hair: RECEPTION.hair, long: true, reception: true });
    r.body.position.y = SEAT - 0.45 * NAC_SCALE;
    r.legL.rotation.x = r.legR.rotation.x = -Math.PI / 2;
    for (const lg of [r.legL, r.legR]) { // shins hanging from the knee + shoes
      box(lg, 0.15, 0.17, 0.4, 0, -0.45, -0.2, "#e3b48c", false);
      box(lg, 0.16, 0.1, 0.07, 0, -0.45, -0.43, "#1a1a1a", false);
    }
    r.armL.rotation.x = r.armR.rotation.x = -0.95; // hands resting towards the worktop
    // Chair (not scaled): gas-lift stool with backrest and foot ring
    const ch = new THREE.Group(); r.root.add(ch);
    const cyl = (rt: number, h: number, y: number, c: string) => { const m = new THREE.Mesh(geo(`c${rt},${h}`, () => new THREE.CylinderGeometry(rt, rt, h, 12)), lam(c)); m.position.y = y + h / 2; m.castShadow = true; ch.add(m); return m; };
    cyl(0.24, 0.04, 0, "#2a2e35"); cyl(0.03, SEAT - 0.1, 0.04, "#8a9097");
    const ring = new THREE.Mesh(geo("ftRing", () => new THREE.TorusGeometry(0.2, 0.015, 6, 20)), lam("#8a9097")); ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; ch.add(ring);
    box(ch, 0.44, 0.07, 0.42, 0, SEAT - 0.07, 0, "#1f2124");
    box(ch, 0.42, 0.45, 0.06, 0, SEAT + 0.05, -0.22, "#1f2124");
    r.root.position.set(wx(1190), FT, wz(1668)); r.root.rotation.y = FACE.W;
    th.floors[1].add(r.root);
    nacs.push({ ...r, toB: true, pause: 0, speed: 0, ph: 0.4, baseRot: FACE.W, seated: true });
  }

  const v = new THREE.Vector2();
  function step(n: Nac, dt: number, t: number) {
    if (n.seated) { // receptionist: look at the monitor / lobby, nod every ~7 s
      n.head.rotation.y = Math.sin(t * 0.35 + n.ph) * 0.45 + Math.sin(t * 0.9) * 0.05;
      const k = (t + 2) % 7; n.head.rotation.x = k < 0.9 ? Math.sin((k / 0.9) * Math.PI * 2) * 0.16 : 0;
      n.body.position.y = 0.62 - 0.45 * NAC_SCALE + Math.sin(t * 1.6) * 0.004;
      n.armL.rotation.x = -0.95 + Math.sin(t * 2.3) * 0.04; n.armR.rotation.x = -0.95 + Math.cos(t * 2.1) * 0.04;
      return;
    }
    const p = n.root.position;
    if (n.a && n.b && n.pause <= 0) { // walking leg
      const tgt = n.toB ? n.b : n.a; v.set(tgt.x - p.x, tgt.y - p.z); const d = v.length(), st = n.speed * dt;
      const want = Math.atan2(v.x, v.y); let da = want - n.root.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); n.root.rotation.y += da * Math.min(1, dt * 5);
      if (d <= st) { p.x = tgt.x; p.z = tgt.y; n.toB = !n.toB; n.pause = 1.5 + ((n.ph * 13) % 3); }
      else { p.x += (v.x / d) * st; p.z += (v.y / d) * st; }
      n.ph += dt * n.speed * 7; const s = Math.sin(n.ph) * 0.45;
      n.legL.rotation.x = s; n.legR.rotation.x = -s; n.armL.rotation.x = -s * 0.7; n.armR.rotation.x = s * 0.7;
      n.body.position.y = Math.abs(Math.sin(n.ph)) * 0.03; n.head.rotation.y *= 0.9;
      return;
    }
    // idle: breathing bob, slow look-around, slight arm sway, settle legs
    n.pause -= dt;
    n.legL.rotation.x *= 0.85; n.legR.rotation.x *= 0.85;
    n.body.position.y = Math.sin(t * 1.8 + n.ph) * 0.012 + 0.012;
    n.head.rotation.y = Math.sin(t * 0.45 + n.ph) * 0.5;
    n.armL.rotation.x = Math.sin(t * 1.1 + n.ph) * 0.08; n.armR.rotation.x = -Math.sin(t * 1.1 + n.ph) * 0.08;
    if (!n.a) { // stationary standers shift their stance a little
      let da = n.baseRot + Math.sin(t * 0.18 + n.ph) * 0.3 - n.root.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); n.root.rotation.y += da * Math.min(1, dt * 2);
    }
  }

  return {
    count: nacs.length,
    update(dt: number, t: number) { if (dt <= 0) return; for (const n of nacs) step(n, dt, t); },
  };
}
