// Single source of truth for office coordinates (tech plan 2.1). Every number comes from Susi's
// two-floor spec (office-redesign-spec.md); section references are given inline.
// World axes: +x east, +z toward the default camera, +y up. Yaw = atan2(dx, dz), 0 faces +z.

export type FloorId = 0 | 1;
export type Pose = "stand" | "sit" | "lean" | "lie";
export type ZoneId = "tv" | "balcony" | "nap" | "commons";
export type XZ = [number, number];

export const FLOOR_H = 6;                          // spec 1.1
export const floorY = (f: FloorId) => f * FLOOR_H; // the ONLY place that knows Floor 1's height
export const floorOfY = (y: number): FloorId => (y > FLOOR_H / 2 ? 1 : 0);

/** A settled position for a character. y = floorY(floor) + yOff. */
export interface Spot {
  x: number; z: number; floor: FloorId;
  yaw: number;
  pose: Pose;
  yOff: number;       // root y relative to the floor surface (spec 4.1)
}

export interface DeskSpot extends Spot { exit: XZ; width: number; name: string }

const PI = Math.PI;

// ---------- Floor 0: individual desks (spec 2.B) ----------
const desk = (name: string, x: number, width: number): DeskSpot =>
  ({ name, x, z: -8.0, floor: 0, yaw: 0, pose: "sit", yOff: -0.25, exit: [x + 2, -8.0], width });
export const DESKS: Record<string, DeskSpot> = {
  default: desk("Hawa", -3.0, 2.4),
  pratama_cto: desk("Pratama", 1.0, 2.0),
  bagas_dev_lead: desk("Bagas", 5.0, 2.0),
  susi_uiux: desk("Susi", 9.0, 2.0),
};
export const hasSeat = (id: string) => !!DESKS[id];

// Claude Code CLI bench (spec 2.B / 9.3, answer 11.d: the robot never leaves the bench)
export const BENCH: XZ = [15.5, -9.0];
export const ROBOT_POS: [number, number, number] = [15.5, 0, -10.05];

// ---------- Staircase (spec 6) ----------
export const STAIR = {
  x: -18.45,
  steps: 12, rise: 0.5, tread: 0.7, width: 2.6,
  frontZ: 12.4,                 // front face of step 0
  bottomZ: 13.1,                // STAIR.bottom (y 0)
  upperZ: 4.7,                  // STAIR.upper (y 6, top step)
  topZ: 3.4,                    // STAIR.top (y 6, on the slab)
  lanes: [-19.05, -18.65, -18.25, -17.85], // per roster index (spec 6.2)
};
export const stairLane = (index: number) => STAIR.lanes[index] ?? STAIR.x;
export const HUB0: XZ = [-15.8, 12.6];   // floor 0 stair approach
export const HUB1: XZ = [-15.0, 2.0];    // floor 1 landing hub

/** Floor-0 route from a desk to the stair foot (spec 6.3), excluding the stair itself. */
export function deskToStair(id: string): XZ[] {
  const d = DESKS[id];
  return [[d.x, d.z], d.exit, [d.exit[0], -4.5], [-7, -4.5], [-7, -1], HUB0];
}

// ---------- Floor 1: lounge spots (spec 3 + 4) ----------
export interface LoungeSpot extends Spot {
  id: string;
  zone: ZoneId;
  activity: string;   // name-tag suffix (spec 4.2)
  approach: XZ[];     // floor-1 waypoints from HUB1 to just before the spot
}
const tvApproachSide = (z: number): XZ[] => [[-13.9, -1.5], [-13.5, z]];
const tvApproachBack = (x: number): XZ[] => [[-13.9, -1.5], [-13.6, -10.6], [x, -11.0]];
const napApproach = (x: number): XZ[] => [[2.5, -1.0], [2.5, -4.0], [x, -7.4]];
const balEast: XZ[] = [[8.0, 1.5], [12.0, 1.5], [14.0, 1.5]];
// Spec routes BAL-3 HUB1 → (8, 9.5) directly, which cuts through BEAN-1; (8, 3) keeps the commons clear.
const balSouth: XZ[] = [[8.0, 3.0], [8.0, 9.5], [12.0, 9.5]];

const L = (id: string, zone: ZoneId, x: number, z: number, pose: Pose, yaw: number, yOff: number, approach: XZ[]): LoungeSpot =>
  ({ id, zone, x, z, floor: 1, pose, yaw, yOff, approach, activity: ACTIVITY[zone] });
const ACTIVITY: Record<ZoneId, string> = { tv: "watching TV", balcony: "on the balcony", nap: "napping", commons: "in the commons" };

export const LOUNGE_SPOTS: LoungeSpot[] = [
  L("TV-1", "tv", -12.2, -8.6, "sit", -PI / 2, -0.75, tvApproachSide(-8.6)),
  L("TV-2", "tv", -12.2, -7.0, "sit", -PI / 2, -0.75, tvApproachSide(-7.0)),
  L("TV-3", "tv", -12.2, -5.4, "sit", -PI / 2, -0.75, tvApproachSide(-5.4)),
  L("TV-4", "tv", -16.3, -12.3, "sit", 0, -0.75, tvApproachBack(-16.3)),
  L("TV-5", "tv", -14.7, -12.3, "sit", 0, -0.75, tvApproachBack(-14.7)),
  L("BAL-1", "balcony", 18.9, -2.0, "lean", PI / 2, 0, balEast),
  L("BAL-2", "balcony", 18.9, 1.5, "lean", PI / 2, 0, balEast),
  L("BAL-3", "balcony", 15.5, 13.0, "lean", 0, 0, [...balSouth, [15.5, 12.0]]),
  L("BAL-4", "balcony", 14.9, 7.0, "sit", PI / 2, -0.25, [...balSouth, [14.0, 8.4]]),
  L("BAL-5", "balcony", 17.1, 7.0, "sit", -PI / 2, -0.25, [...balSouth, [14.0, 8.4], [17.1, 8.4]]),
  L("NAP-1", "nap", -1.15, -8.3, "lie", 0, 1.0, napApproach(-1.15)),
  L("NAP-2", "nap", 2.85, -8.3, "lie", 0, 1.0, napApproach(2.85)),
  L("NAP-3", "nap", 6.85, -8.3, "lie", 0, 1.0, napApproach(6.85)),
  L("BEAN-1", "commons", 1.0, 7.0, "sit", 0, -0.75, [[1.0, 8.4]]),
  L("BEAN-2", "commons", 4.0, 8.0, "sit", -0.3, -0.75, [[4.0, 9.4]]),
];
// BEAN approach (spec): (spot.x, spot.z + 1.4) — sit facing +z means arriving from the front.

/** Fixed assignment (spec 4.3 / answer 11.c). */
export const ZONE_OF: Record<string, string> = {
  default: "TV-2",
  pratama_cto: "BAL-1",
  bagas_dev_lead: "NAP-2",
  susi_uiux: "BAL-3",
};
const FALLBACK_ORDER = ["TV-1", "TV-3", "BAL-2", "NAP-1", "NAP-3", "BAL-4", "BAL-5", "TV-4", "TV-5", "BEAN-1", "BEAN-2"];
const spotById = (id: string) => LOUNGE_SPOTS.find((s) => s.id === id)!;

function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/** Fixed table first; unknown ids hash + linear-probe over the fallback order (tech plan 4.3). */
export function loungeSpotFor(id: string, roster: string[] = Object.keys(ZONE_OF)): LoungeSpot {
  if (ZONE_OF[id]) return spotById(ZONE_OF[id]);
  const taken = new Set(Object.values(ZONE_OF));
  for (const other of roster) {
    if (other === id) break;
    if (!ZONE_OF[other]) taken.add(loungeSpotFor(other, roster).id);
  }
  const start = fnv1a(id) % FALLBACK_ORDER.length;
  for (let i = 0; i < FALLBACK_ORDER.length; i++) {
    const sid = FALLBACK_ORDER[(start + i) % FALLBACK_ORDER.length];
    if (!taken.has(sid)) return spotById(sid);
  }
  return spotById(FALLBACK_ORDER[start]);
}

/** Full 3D route desk → lounge spot (spec 6.3). Points are world [x, y, z]. */
export function deskToLounge(id: string, index: number): [number, number, number][] {
  const lane = stairLane(index);
  const spot = loungeSpotFor(id);
  const f0 = deskToStair(id).map(([x, z]) => [x, 0, z] as [number, number, number]);
  const climb: [number, number, number][] = [[lane, 0, STAIR.bottomZ], [lane, FLOOR_H, STAIR.upperZ], [lane, FLOOR_H, STAIR.topZ]];
  const f1 = [HUB1, ...spot.approach, [spot.x, spot.z] as XZ].map(([x, z]) => [x, FLOOR_H, z] as [number, number, number]);
  return [...f0, ...climb, ...f1];
}

// ---------- Camera presets (spec 7) ----------
export type Preset = "overview" | "workspace" | "lounge";
export interface PresetDef {
  pos: [number, number, number]; target: [number, number, number];
  minDist: number; maxDist: number;
  minPolar: number; maxPolar: number;     // degrees
  minAzimuth: number; maxAzimuth: number; // degrees
  floors: [boolean, boolean];
}
export const PRESETS: Record<Preset, PresetDef> = {
  overview: { pos: [34, 22, 38], target: [0, 4, 0], minDist: 25, maxDist: 75, minPolar: 50, maxPolar: 80, minAzimuth: -15, maxAzimuth: 95, floors: [true, true] },
  workspace: { pos: [4, 24, 30], target: [0, 1, -1], minDist: 12, maxDist: 50, minPolar: 25, maxPolar: 72, minAzimuth: -25, maxAzimuth: 80, floors: [true, false] },
  lounge: { pos: [6, 30, 32], target: [-1, 7, -1], minDist: 12, maxDist: 50, minPolar: 25, maxPolar: 70, minAzimuth: -25, maxAzimuth: 85, floors: [true, true] },
};

// ---------- Light state per preset (spec 8.1) ----------
export interface LightState { ambient: string; ambientI: number; sun: string; sunI: number; balconyI: number }
export const LIGHT_STATES: Record<Preset, LightState> = {
  workspace: { ambient: "#FFF4E6", ambientI: 0.75, sun: "#FFF1DC", sunI: 0.85, balconyI: 0.0 },
  lounge: { ambient: "#E3EAFF", ambientI: 0.5, sun: "#DCE6FF", sunI: 0.7, balconyI: 0.4 },
  overview: { ambient: "#FFFFFF", ambientI: 0.6, sun: "#FFFFFF", sunI: 0.8, balconyI: 0.4 },
};
export const SUN_POS: [number, number, number] = [18, 34, 22];
export const SUN_TARGET: [number, number, number] = [0, 3, 0];
// Balcony sky glow (task brief, not in Susi's spec): 3rd and last light (spec budget max 3).
export const BALCONY_LIGHT = { pos: [16, 9, 0] as [number, number, number], color: "#FFF5E0", distance: 18 };

// ---------- CSS2D labels (spec 7 / 3) ----------
export interface ZoneLabel { text: string; floor: FloorId; pos: [number, number, number] } // pos local to the floor
export const ZONE_LABELS: ZoneLabel[] = [
  { text: "Meeting Room", floor: 0, pos: [-14, 0.2, -3.6] },
  { text: "Desks", floor: 0, pos: [2.5, 0.2, -3.6] },
  { text: "Claude Tool Bench", floor: 0, pos: [16, 0.2, -3.6] },
  { text: "Open Work Area", floor: 0, pos: [7, 0.2, 13.4] },
  { text: "Lobby", floor: 0, pos: [-14, 0.2, 2] },
  { text: "TV Corner", floor: 1, pos: [-15, 0.2, -2.0] },
  { text: "Balcony", floor: 1, pos: [16, 0.2, -6] },
  { text: "Rest Room", floor: 1, pos: [3, 0.2, -5.0] },
];
