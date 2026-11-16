// Pixel Office layout (pixel-office-design-spec.md 2.1 / 2.2 / 2.6, tech plan 3.2).
// Positions of agents, desks, bench and lounge spots are IMPORTED from layout.ts (single source of truth)
// and converted world → grid; only pixel-only decoration (windows, rugs, plants…) is defined here.
import { BENCH, DESKS, LOUNGE_SPOTS, STAIR, type FloorId, type LoungeSpot } from "./layout";

// ---------------- projection (spec 2.1 / 5.1) ----------------
/** Display tile size at the reference scale S = 2 (the classic 2:1 iso tile). */
export const TILE_W = 64, TILE_H = 32;
/** The scene is drawn into a low-res buffer (1 art pixel = 1 buffer px) and blitted up ×S. */
export const ART_SCALE = 2;
export const BT_W = TILE_W / ART_SCALE, BT_H = TILE_H / ART_SCALE; // 32 × 16 buffer px per tile
export const Z_PX = 8;                       // buffer px per world unit of height
export const GRID_W = 20, GRID_D = 14;       // tiles per floor (gx 0..20, gy 0..14)
export const WALL_H = 4;                     // world units (32 px)
export const WALL_T = 0.25;                  // wall thickness in tiles
// Origin: the leftmost floor corner (gx 0, gy 14) lands 8 px in from the left so the back-left wall's
// thickness fits; OY = wall 32 + cap 8 + headroom 16 (spec 2.1).
export const OX = 14 * (BT_W / 2) + 8, OY = 56;
export const BUF_W = (GRID_W + GRID_D) * (BT_W / 2) + 16;      // 560
export const BUF_H = (GRID_W + GRID_D) * (BT_H / 2) + OY + 8;  // 336

// World footprint of both floor slabs (room.ts builds x -20..20, z -14..14).
export const X_MIN = -20, Z_MIN = -14, WORLD_PER_TILE = 2;
/** World (x, z) → grid (gx, gy). 1 tile = 2 × 2 world units. */
export const toGrid = (x: number, z: number) => ({ gx: (x - X_MIN) / WORLD_PER_TILE, gy: (z - Z_MIN) / WORLD_PER_TILE });

/** Grid point (+ height in world units) → buffer px. Integer output (pixel art: no half pixels). */
export function isoProject(gx: number, gy: number, elev = 0, ox = OX, oy = OY) {
  return {
    x: Math.round(ox + (gx - gy) * (BT_W / 2)),
    y: Math.round(oy + (gx + gy) * (BT_H / 2) - elev * Z_PX),
  };
}
/** Inverse on the floor plane (hit-testing). */
export function screenToGrid(sx: number, sy: number, ox = OX, oy = OY) {
  const a = (sx - ox) / (BT_W / 2), b = (sy - oy) / (BT_H / 2);
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

// ---------------- tile grids (spec 2.2) ----------------
/** Tile material keys. "." = checker floor, "D" = desk zone (checker floor, kept for layout logic). */
export type TileKind = "." | "D" | "M" | "B" | "R" | "L" | "N" | "C" | "K";

function grid(fill: (gx: number, gy: number) => TileKind): TileKind[][] {
  return Array.from({ length: GRID_D }, (_, gy) => Array.from({ length: GRID_W }, (_, gx) => fill(gx, gy)));
}
const inR = (gx: number, gy: number, x0: number, x1: number, y0: number, y1: number) => gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1;

export const FLOOR_TILES: Record<FloorId, TileKind[][]> = {
  // Floor 0 · Workspace: meeting room (A), desks (B), Claude bench (B2), open work area rug (C), lobby (D).
  0: grid((gx, gy) =>
    inR(gx, gy, 0, 5, 0, 4) ? "M" : inR(gx, gy, 7, 15, 0, 4) ? "D" : inR(gx, gy, 16, 19, 0, 4) ? "B" : inR(gx, gy, 9, 16, 8, 12) ? "R" : "."),
  // Floor 1 · Lounge: TV corner rug, nap room, commons rug, balcony deck.
  1: grid((gx, gy) =>
    gx >= 16 ? "K" : inR(gx, gy, 1, 5, 1, 5) ? "L" : inR(gx, gy, 8, 15, 0, 4) ? "N" : inR(gx, gy, 9, 14, 8, 12) ? "C" : "."),
};

/** Back walls: "r" = back-right wall along gy = 0 (from gx 0 to `to`), "l" = back-left wall along gx = 0. */
export const WALLS: Record<FloorId, { r: number; l: number }> = {
  0: { r: GRID_W, l: GRID_D },
  1: { r: 16, l: GRID_D },     // no back wall above the balcony (spec 2.2) — sky shows through
};

/** Wall-mounted items. `wall` r → `u` runs along gx, l → along gy. Heights in world units. */
export interface WallItem { kind: "window" | "shelf" | "whiteboard" | "screen" | "tv" | "sign"; wall: "r" | "l"; u0: number; u1: number; h0: number; h1: number }
const win = (wall: "r" | "l", u0: number): WallItem => ({ kind: "window", wall, u0, u1: u0 + 1.5, h0: 1.4, h1: 3.4 });
export const WALL_ITEMS: Record<FloorId, WallItem[]> = {
  0: [
    { kind: "whiteboard", wall: "r", u0: 1.5, u1: 4.0, h0: 1.6, h1: 3.4 },
    win("r", 7.6), { kind: "shelf", wall: "r", u0: 10.75, u1: 12.25, h0: 0, h1: 3.6 }, win("r", 13.9),
    { kind: "screen", wall: "l", u0: 1.6, u1: 3.9, h0: 1.6, h1: 3.4 },
    win("l", 6.7), { kind: "shelf", wall: "l", u0: 8.3, u1: 9.3, h0: 0, h1: 3.6 }, win("l", 11.6),
    { kind: "sign", wall: "l", u0: 13.4, u1: 13.9, h0: 2.2, h1: 2.7 },
  ],
  1: [
    win("r", 5.0), win("r", 12.5),
    { kind: "tv", wall: "l", u0: 2.45, u1: 4.55, h0: 1.7, h1: 3.8 },
    win("l", 6.2), win("l", 10.8),
  ],
};

// ---------------- agent spots (spec 2.6) ----------------
export type Facing = "front" | "back";
export type PixelPose = "sit" | "stand" | "lie";
export interface PixelSpot { gx: number; gy: number; floor: FloorId; pose: PixelPose; facing: Facing; seatH: number }

/** Desk chair: on the camera side of the desk, facing it (BACK view). */
export function deskSpot(id: string): PixelSpot | null {
  const d = DESKS[id];
  if (!d) return null;
  const g = toGrid(d.x, d.z);
  return { gx: g.gx, gy: g.gy + 0.9, floor: 0, pose: "sit", facing: "back", seatH: 1.1 };
}

/** Lounge spot (layout.ts LOUNGE_SPOTS) → pixel pose/facing per spec 2.6. */
export function loungePixelSpot(s: LoungeSpot): PixelSpot {
  const g = toGrid(s.x, s.z);
  const id = s.id;
  if (id.startsWith("NAP")) return { gx: g.gx, gy: g.gy, floor: 1, pose: "lie", facing: "front", seatH: 0.6 };
  if (id === "TV-1" || id === "TV-2" || id === "TV-3") return { gx: g.gx, gy: g.gy, floor: 1, pose: "sit", facing: "back", seatH: 0.5 };
  if (id === "TV-4" || id === "TV-5") return { gx: g.gx, gy: g.gy, floor: 1, pose: "sit", facing: "front", seatH: 0.5 };
  if (id.startsWith("BEAN")) return { gx: g.gx, gy: g.gy, floor: 1, pose: "sit", facing: "front", seatH: 0.3 };
  if (id === "BAL-4" || id === "BAL-5") return { gx: g.gx, gy: g.gy, floor: 1, pose: "sit", facing: "front", seatH: 0.9 };
  return { gx: g.gx, gy: g.gy, floor: 1, pose: "stand", facing: id === "BAL-3" ? "front" : "back", seatH: 0 };
}

/** Claude CLI robot: at the tool bench (layout.ts BENCH), in front of the workbench. */
export const BENCH_GRID = toGrid(BENCH[0], BENCH[1]);
export const ROBOT_SPOT: PixelSpot = { gx: BENCH_GRID.gx - 0.25, gy: BENCH_GRID.gy + 0.6, floor: 0, pose: "stand", facing: "front", seatH: 0 };

export const LOUNGE_GRID = LOUNGE_SPOTS.map((s) => ({ id: s.id, ...toGrid(s.x, s.z) }));
// Staircase footprint (layout.ts STAIR): x ± width/2, z bottomZ → upperZ (rises toward the back).
export const STAIR_GRID = {
  gx0: toGrid(STAIR.x - STAIR.width / 2, 0).gx, gx1: toGrid(STAIR.x + STAIR.width / 2, 0).gx,
  gyFront: toGrid(0, STAIR.bottomZ).gy, gyBack: toGrid(0, STAIR.upperZ).gy,
};
