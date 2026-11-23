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
// Layout (floor-plan px, see townhall.ts wx/wz): 46 NACs + receptionist
//   Lantai 1 Ruang Kerja 5 · Lantai 2 Area Kerja Agen (orbs) 4 + Area Kolaborasi/Training/Library/Coffee 5
//   Lobby 4 · outside 9 · corridors/stairs 3 · Lantai 3 4
//   Area Olahraga (belakang gedung, site group, see townhall.ts "===== sports area =====") 12:
//     tenis 2 (rally berhadapan + bola bebas), basket 4 (half-court 2v2 + dribble/jump shot),
//     badminton 2 (rally + kok bebas), kolam 4 (2 berenang + 2 duduk di pinggir deck)
// Paths are short straight lanes inside open floor area (no wall crossings); walkers pace slowly and pause at the ends.
// Sports NAC are built/animated separately below (court/net/hoop/pool props already exist in townhall.ts; this
// file only adds the people + their held/free props - see Goku brief 2026-11-23 sports-nac_bulma-spec + CTO
// corrections). Each zone's update() runs off its own LOCAL clock that advances only while dt > 0 (never the
// global t), so prefers-reduced-motion (dt=0) freezes rallies/jumps cleanly instead of jumping ahead on resume.
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

interface NacSpec { where: 0 | 1 | 2 | 3; a: [number, number]; b?: [number, number]; face?: Face; y?: number; long?: boolean; sit?: boolean }

/** 0 = outdoor site group, 1/2/3 = floor group. y defaults to FT (slab top) inside, 0 outside. */
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
  // Behind the building (north strip): 2 slow walkers, 2 idle standers, 1 sitting on a crate
  { where: 0, a: [700, 250], b: [950, 250], y: 0.04 },
  { where: 0, a: [1300, 230], b: [1550, 230], y: 0.04 },
  { where: 0, a: [1190, 180], face: "S", y: 0.04 },
  { where: 0, a: [1700, 250], face: "W", y: 0.04 },
  { where: 0, a: [850, 210], y: 0.04, sit: true },
  // Lantai 2: 5 more NAC around the collaboration/training/library/coffee areas (keep clear of CTO/COO + orbs)
  { where: 2, a: [1480, 560], b: [1480, 700] },
  { where: 2, a: [1650, 540], face: "S" },            // facing the collaboration table
  { where: 2, a: [1480, 1010], b: [1700, 1010], long: true },
  { where: 2, a: [520, 1160], b: [850, 1160] },
  { where: 2, a: [700, 1600], face: "S" },            // Coffee Corner
  // Lantai 3: 4 NAC (avoid the break spots: Tempat Istirahat, Ruang Game)
  { where: 3, a: [620, 650], b: [620, 860] },
  { where: 3, a: [1100, 372], face: "S" },            // on the Balkon
  { where: 3, a: [1650, 650], b: [1650, 760], long: true },
  { where: 3, a: [1150, 1460], face: "N" },           // Koridor
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

  const parentOf = (w: 0 | 1 | 2 | 3) => (w === 0 ? th.site : th.floors[w]);
  const nacs: Nac[] = [];
  SPECS.forEach((s, i) => {
    const m = build({ shirt: GREYS[i % GREYS.length], pants: NAC_PANTS, skin: SKINS[(i * 7) % SKINS.length], hair: HAIRS[i % HAIRS.length], long: s.long });
    const y = s.y ?? (s.where === 0 ? 0 : FT);
    m.root.position.set(wx(s.a[0]), y, wz(s.a[1]));
    parentOf(s.where).add(m.root);
    const n: Nac = { ...m, toB: true, pause: (i % 5) * 0.7, speed: 0.45 + ((i * 37) % 20) / 100, ph: i * 1.7, baseRot: FACE[s.face || "S"] };
    if (s.b) { n.a = new THREE.Vector2(wx(s.a[0]), wz(s.a[1])); n.b = new THREE.Vector2(wx(s.b[0]), wz(s.b[1])); n.baseRot = Math.atan2(n.b.x - n.a.x, n.b.y - n.a.y); }
    m.root.rotation.y = n.baseRot;
    if (s.sit) {
      const SEAT = 0.42; // crate top (lower than the receptionist's 0.62 chair)
      m.body.position.y = SEAT - 0.45 * NAC_SCALE;
      m.legL.rotation.x = m.legR.rotation.x = -Math.PI / 2;
      n.seated = true;
      box(th.site, 0.5, 0.45, 0.5, wx(s.a[0]), s.y ?? 0.04, wz(s.a[1]), "#8a6a43");
    }
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

  /* ================= Sports NAC (Task 1, Goku brief 2026-11-23) =================
     12 new NAC in the existing outdoor sports area (townhall.ts "===== sports area ====="):
     tenis 2, basket 4, badminton 2, kolam 4 (2 berenang + 2 duduk). Built/animated independently
     of the generic SPECS/step() walkers above (zero risk of regressing the other 34 + receptionist):
     each zone keeps its own small closure state and a LOCAL clock that only advances when the
     caller passes dt > 0 - never reads the global t - so freezing for reduced motion (dt=0, see the
     returned update() below) truly freezes mid-rally/mid-jump instead of jumping ahead on resume.
     No `new THREE.Vector3()`/`Vector2()` (or any other allocation) happens inside any update() path. */
  const SPORT_LIGHT = ["#a3a3a3", "#adadad"]; // Bulma spec 2: brighter grey variant, sports-only
  const ACCENT_RACKET = "#5c6670", ACCENT_BASKET = "#7a4b3a"; // dim accent headbands, no names/labels
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));

  function addHeadband(head: THREE.Group, color: string) { box(head, 0.37, 0.05, 0.08, 0, 0.2, 0.15, color, false); }

  /** Racket prop, child of armR (~hand height, spec 2.3). Swings with the arm via armR.rotation. */
  function addRacket(armR: THREE.Group, kind: "tennis" | "badminton", accent: string) {
    const grp = new THREE.Group(); grp.position.set(0, -0.5, 0.05); armR.add(grp);
    if (kind === "tennis") {
      const handle = new THREE.Mesh(geo("rktHandleT", () => new THREE.CylinderGeometry(0.018, 0.02, 0.22, 6)), lam("#2b2e31"));
      handle.rotation.z = Math.PI / 2; handle.position.x = 0.11; grp.add(handle);
      const frame = new THREE.Mesh(geo("rktFrameT", () => new THREE.TorusGeometry(0.115, 0.012, 6, 16)), lam("#1d1f22"));
      frame.position.x = 0.31; grp.add(frame);
      const acc = new THREE.Mesh(geo("rktAccT", () => new THREE.TorusGeometry(0.115, 0.004, 4, 16, Math.PI * 0.4)), lam(accent));
      acc.position.set(0.31, 0, 0.001); grp.add(acc);
      const str = new THREE.Mesh(geo("rktStrT", () => new THREE.CircleGeometry(0.1, 10)),
        new THREE.MeshBasicMaterial({ color: "#e8e8e8", transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      str.position.x = 0.31; grp.add(str);
    } else {
      const handle = new THREE.Mesh(geo("rktHandleB", () => new THREE.CylinderGeometry(0.014, 0.016, 0.24, 6)), lam("#3a3a3a"));
      handle.rotation.z = Math.PI / 2; handle.position.x = 0.12; grp.add(handle);
      const frame = new THREE.Mesh(geo("rktFrameB", () => new THREE.TorusGeometry(0.095, 0.009, 6, 16)), lam("#2f2f2f"));
      frame.position.x = 0.3; grp.add(frame);
      const str = new THREE.Mesh(geo("rktStrB", () => new THREE.CircleGeometry(0.082, 10)),
        new THREE.MeshBasicMaterial({ color: "#f0f0f0", transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      str.position.x = 0.3; grp.add(str);
    }
  }
  function makeTennisBall() { return new THREE.Mesh(geo("tennisBall", () => new THREE.SphereGeometry(0.033, 10, 8)), lam("#c7e03a")); }
  function makeShuttle() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo("shuttleCork", () => new THREE.SphereGeometry(0.03, 8, 6)), lam("#e8d7b0")));
    const ring = new THREE.Mesh(geo("shuttleRing", () => new THREE.TorusGeometry(0.032, 0.006, 4, 10)), lam("#d8d8d8"));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; g.add(ring);
    const feather = new THREE.Mesh(geo("shuttleFeather", () => new THREE.ConeGeometry(0.075, 0.13, 8)), lam("#f5f5f5"));
    feather.position.y = 0.09; g.add(feather);
    return g;
  }

  /** Tennis (#1/#2) and badminton (#7/#8) share the same "always face the net, side-step, ball/kok
   *  is a free deterministic-parabola object" rally model (CTO corrections K1/K2). */
  function buildRallySport(cfg: {
    centerXW: number; ampXW: number; zA: number; zB: number; groundY: number;
    peakH: number; THalf: number; kind: "tennis" | "badminton"; accent: string;
    skinA: string; skinB: string; hairA: string; hairB: string;
  }) {
    const A = build({ shirt: SPORT_LIGHT[0], pants: NAC_PANTS, skin: cfg.skinA, hair: cfg.hairA });
    const B = build({ shirt: SPORT_LIGHT[1], pants: NAC_PANTS, skin: cfg.skinB, hair: cfg.hairB });
    A.root.position.set(cfg.centerXW, cfg.groundY, cfg.zA); A.root.rotation.y = FACE.S; // north side faces S (net)
    B.root.position.set(cfg.centerXW, cfg.groundY, cfg.zB); B.root.rotation.y = FACE.N; // south side faces N (net)
    th.site.add(A.root, B.root);
    addHeadband(A.head, cfg.accent); addHeadband(B.head, cfg.accent);
    addRacket(A.armR, cfg.kind, cfg.accent); addRacket(B.armR, cfg.kind, cfg.accent);
    const ball = cfg.kind === "tennis" ? makeTennisBall() : makeShuttle();
    th.site.add(ball);

    let clock = 0;
    const targetX = (k: number) => cfg.centerXW + Math.sin(k * 1.7) * cfg.ampXW; // deterministic "landing spot"
    const prevTarget = (k: number) => (k < 0 ? cfg.centerXW : targetX(k));
    const burstFrac = 0.3 / cfg.THalf, swingAmp = cfg.kind === "tennis" ? 0.6 : 0.5;
    return {
      update(dt: number) {
        clock += dt;
        const k = Math.floor(clock / cfg.THalf), p = (clock - k * cfg.THalf) / cfg.THalf;
        const aToB = k % 2 === 0; // k even: A (north) hits -> ball travels to B (south)
        let xA: number, xB: number;
        if (aToB) { xA = prevTarget(k - 1); xB = lerp(prevTarget(k - 2), targetX(k), ease(p)); }
        else { xB = prevTarget(k - 1); xA = lerp(prevTarget(k - 2), targetX(k), ease(p)); }
        A.root.position.x = xA; B.root.position.x = xB;
        // side-step shuffle for whichever one is gliding this half (body never rotates - K1)
        const shuffle = Math.sin(clock * 6) * 0.3, movA = aToB ? 0 : 1, movB = aToB ? 1 : 0;
        A.legL.rotation.x = shuffle * movA; A.legR.rotation.x = -shuffle * movA; A.armL.rotation.x = -shuffle * 0.2 * movA;
        B.legL.rotation.x = shuffle * movB; B.legR.rotation.x = -shuffle * movB; B.armL.rotation.x = -shuffle * 0.2 * movB;
        A.body.position.y = Math.sin(clock * 1.8) * 0.01; B.body.position.y = Math.sin(clock * 1.8 + 1.4) * 0.01;
        // hitter's forehand/overhead burst (~0.3s), synced to the moment the ball leaves their side (K1/K2)
        const burst = p < burstFrac ? Math.sin((p / burstFrac) * Math.PI) * swingAmp : 0;
        const base = cfg.kind === "badminton" ? -0.3 : 0;
        if (cfg.kind === "tennis") {
          if (aToB) { A.armR.rotation.z = burst; B.armR.rotation.z *= 0.8; }
          else { B.armR.rotation.z = burst; A.armR.rotation.z *= 0.8; }
        } else if (aToB) { A.armR.rotation.x = base + burst; B.armR.rotation.x *= 0.8; }
        else { B.armR.rotation.x = base + burst; A.armR.rotation.x *= 0.8; }
        // ball/kok: deterministic parabola from the hitter's x to this shot's landing x (K2)
        const fromX = aToB ? xA : xB, bx = lerp(fromX, targetX(k), p);
        const bz = aToB ? lerp(cfg.zA, cfg.zB, p) : lerp(cfg.zB, cfg.zA, p);
        ball.position.set(bx, cfg.groundY + 4 * cfg.peakH * p * (1 - p), bz);
      },
    };
  }

  /** Basketball (#3-#6): half-court 2v2 at the north hoop only (K3), not two pairs at two ends. */
  function buildBasketball() {
    const groundY = 0.06, hoopX = wx(1480), hoopZ = wz(-1130), hoopY = 3.05, HAND_H = 0.95;
    const handler = build({ shirt: SPORT_LIGHT[0], pants: NAC_PANTS, skin: SKINS[0], hair: HAIRS[0] });
    const defender = build({ shirt: SPORT_LIGHT[1], pants: NAC_PANTS, skin: SKINS[1], hair: HAIRS[1] });
    const cut1 = build({ shirt: SPORT_LIGHT[0], pants: NAC_PANTS, skin: SKINS[2], hair: HAIRS[2] });
    const cut2 = build({ shirt: SPORT_LIGHT[1], pants: NAC_PANTS, skin: SKINS[3], hair: HAIRS[3] });
    handler.root.position.set(wx(1480), groundY, wz(-720)); handler.root.rotation.y = FACE.N; // faces the hoop
    defender.root.position.set(wx(1480), groundY, wz(-860)); defender.root.rotation.y = FACE.S; // faces the handler
    cut1.root.position.set(wx(1340), groundY, wz(-950)); cut1.root.rotation.y = FACE.N;
    cut2.root.position.set(wx(1620), groundY, wz(-950)); cut2.root.rotation.y = FACE.N;
    for (const h of [handler, defender, cut1, cut2]) addHeadband(h.head, ACCENT_BASKET);
    defender.armL.rotation.z = 0.35; defender.armR.rotation.z = -0.35; // guard stance, arms out
    th.site.add(handler.root, defender.root, cut1.root, cut2.root);

    // Bright orange + thick dark seams: the court is #c0673e, a realistic #d9641f ball vanished against it.
    const ball = new THREE.Mesh(geo("bball", () => new THREE.SphereGeometry(0.14, 12, 8)), lam("#ff8a1f"));
    const seamH = new THREE.Mesh(geo("bballSeam", () => new THREE.TorusGeometry(0.14, 0.012, 4, 16)), lam("#1a1a1a"));
    const seamV = seamH.clone(); seamV.rotation.x = Math.PI / 2;
    ball.add(seamH, seamV); th.site.add(ball);

    let clock = 0;
    const T_JUMP = 6, JUMP_DUR = 0.9;
    return {
      update(dt: number) {
        clock += dt;
        const jt = clock % T_JUMP;
        const handX = handler.root.position.x + 0.22, handZ = handler.root.position.z;
        if (jt < JUMP_DUR) { // every ~6s: jump + shot arcs to the hoop, then comes back (K3)
          const q = jt / JUMP_DUR, jump4 = 4 * q * (1 - q);
          handler.body.position.y = jump4 * 0.35;
          handler.armL.rotation.x = handler.armR.rotation.x = -1.6 * jump4;
          const bx = q <= 0.5 ? lerp(handX, hoopX, q / 0.5) : lerp(hoopX, handX, (q - 0.5) / 0.5);
          const bz = q <= 0.5 ? lerp(handZ, hoopZ, q / 0.5) : lerp(hoopZ, handZ, (q - 0.5) / 0.5);
          ball.position.set(bx, HAND_H + (hoopY + 0.3 - HAND_H) * jump4, bz);
        } else { // normal dribble: bola memantul tangan<->lantai, |sin| (Bulma spec 4)
          handler.body.position.y = 0; handler.armR.rotation.x = -0.3;
          const bounce = Math.abs(Math.sin(clock * 3));
          ball.position.set(handX, groundY + (HAND_H - groundY) * bounce, handZ);
        }
        const shuffle = Math.sin(clock * 3) * 0.2;
        handler.legL.rotation.x = shuffle; handler.legR.rotation.x = -shuffle;
        defender.legL.rotation.x = -shuffle * 0.6; defender.legR.rotation.x = shuffle * 0.6;
        for (const [c, ph] of [[cut1, 0], [cut2, 1.6]] as const) {
          c.root.position.x = (c === cut1 ? wx(1340) : wx(1620)) + Math.sin(clock * 0.4 + ph) * 0.6;
          const cs = Math.sin(clock * 5 + ph) * 0.3;
          c.legL.rotation.x = cs; c.legR.rotation.x = -cs; c.armL.rotation.x = -cs * 0.6; c.armR.rotation.x = cs * 0.6;
        }
      },
    };
  }

  /** Pool swimmers (#9/#10): root rides the water surface (NOT FT), legs hidden - K4/spec 4-5. */
  function buildSwimmer(a: [number, number], b: [number, number], shirt: string, skin: string, hair: string, ph: number) {
    const m = build({ shirt, pants: NAC_PANTS, skin, hair });
    const waterY = 0.14, ax = wx(a[0]), bx = wx(b[0]), az = wz(a[1]);
    m.root.position.set(ax, waterY, az); m.legL.visible = false; m.legR.visible = false;
    th.site.add(m.root);
    let clock = 0, dir = 1, x = ax;
    const speed = 0.2, lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    return {
      update(dt: number) {
        clock += dt;
        x += dir * speed * dt;
        if (x >= hi) { x = hi; dir = -1; } else if (x <= lo) { x = lo; dir = 1; }
        m.root.position.x = x; m.root.rotation.y = dir > 0 ? FACE.E : FACE.W;
        m.body.position.y = -0.235 + Math.sin(clock * 1.2 + ph) * 0.025; // ~50% submerged (K4)
        const s = Math.sin(clock * 0.9 * 2 * Math.PI + ph);
        m.armL.rotation.x = s * 0.35; m.armR.rotation.x = -s * 0.35;
      },
    };
  }

  /** Pool-edge sitters (#11/#12): seated on the existing deck (top 0.12m), legs straight over the
   *  water (no shin/depth - K4), idle breathing + head look-around only (no arm animation). */
  function buildPoolSitter(px: number, py: number, shirt: string, skin: string, hair: string) {
    const m = build({ shirt, pants: NAC_PANTS, skin, hair });
    const SEAT = 0.12;
    m.root.position.set(wx(px), 0, wz(py)); m.root.rotation.y = FACE.N; // faces the pool
    m.body.position.y = SEAT - 0.45 * NAC_SCALE;
    m.legL.rotation.x = m.legR.rotation.x = -Math.PI / 2;
    m.armL.rotation.x = m.armR.rotation.x = -0.3; // relaxed, static
    th.site.add(m.root);
    let clock = 0; const ph = (px * 0.013) % (Math.PI * 2);
    return {
      update(dt: number) {
        clock += dt;
        m.body.position.y = SEAT - 0.45 * NAC_SCALE + Math.sin(clock * 1.8 + ph) * 0.012 + 0.012;
        m.head.rotation.y = Math.sin(clock * 0.45 + ph) * 0.5;
      },
    };
  }

  const sports = [
    buildRallySport({ centerXW: wx(800), ampXW: 3.0, zA: wz(-750), zB: wz(-180), groundY: 0.06,
      peakH: 1.5, THalf: 1.0, kind: "tennis", accent: ACCENT_RACKET, skinA: SKINS[0], skinB: SKINS[1], hairA: HAIRS[0], hairB: HAIRS[1] }),
    buildRallySport({ centerXW: (wx(1480) + wx(1620)) / 2, ampXW: 1.4, zA: wz(-1750), zB: wz(-1420), groundY: 0.06,
      peakH: 2.2, THalf: 1.4, kind: "badminton", accent: ACCENT_RACKET, skinA: SKINS[2], skinB: SKINS[3], hairA: HAIRS[2], hairB: HAIRS[3] }),
    buildBasketball(),
    buildSwimmer([750, -2520], [1050, -2520], SPORT_LIGHT[0], SKINS[4], HAIRS[0], 0),
    buildSwimmer([700, -2320], [950, -2320], SPORT_LIGHT[1], SKINS[5], HAIRS[1], 2.3),
    buildPoolSitter(850, -2190, SPORT_LIGHT[0], SKINS[0], HAIRS[2]),
    buildPoolSitter(1150, -2190, SPORT_LIGHT[1], SKINS[1], HAIRS[3]),
  ];
  const SPORTS_NAC_COUNT = 12; // 2 tenis + 4 basket + 2 badminton + 4 kolam

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
    count: nacs.length + SPORTS_NAC_COUNT,
    update(dt: number, t: number) {
      if (dt <= 0) return;
      for (const n of nacs) step(n, dt, t);
      for (const s of sports) s.update(dt);
    },
  };
}
