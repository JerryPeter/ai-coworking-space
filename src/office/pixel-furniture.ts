// Pixel Office furniture (pixel-office-design-spec.md 2.4 / 2.5). Every piece is built from isoBox /
// polygon / fillRect calls — no images, no sprites. Positions come from layout.ts via pixel-layout.ts.
//
// Draw order (spec 2.5, painter's algorithm): items sort by the footprint's FRONT corner (gx1 + gy1), tie →
// lower top first, tie → smaller gx. Long pieces (meeting table, sofas, partitions, railings, TV cabinet)
// are split into ≤ 1-tile slices so the key stays correct where they pass other objects. Things that rest
// ON another piece (CRT and lamp on a desk, pillow on a bed) are drawn inside that piece's composite item.
import { DESKS, LOUNGE_SPOTS, type FloorId } from "./layout";
import { darken, lighten, type PixelPalette } from "./palettes";
import { fillPoly, isoBox, line, pixelEllipse, wallCol, wallQuad, type BoxColors, type Ctx, type Pt } from "./pixel-draw";
import { BENCH_GRID, GRID_D, GRID_W, isoProject, STAIR_GRID, WALL_H, WALL_ITEMS, toGrid, type WallItem } from "./pixel-layout";

const P = isoProject;

export interface DrawItem { key: number; top: number; gx: number; draw: (ctx: Ctx) => void }
/** A light source for the night glow pass (task 6): buffer px position + radius in tiles. */
export interface LampLight { x: number; y: number; radius: number; kind: "desk" | "floor" | "mini" }

export interface FurnitureSet { items: DrawItem[]; lights: LampLight[]; bulbs: Pt[] }

export const sortItems = (a: DrawItem, b: DrawItem) => a.key - b.key || a.top - b.top || a.gx - b.gx;

// ---------------- desk geometry (shared with the dynamic layer) ----------------
export interface DeskGeo { id: string; cx: number; gx0: number; gy0: number; w: number; d: number }
export function deskGeo(id: string): DeskGeo | null {
  const s = DESKS[id];
  if (!s) return null;
  const g = toGrid(s.x, s.z);
  const w = id === "default" ? 1.4 : 1.2, d = id === "default" ? 0.65 : 0.6;
  return { id, cx: g.gx, gx0: g.gx - w / 2, gy0: g.gy - d / 2, w, d };
}
const DESK_TOP_H = 2.2;
const CRT = { w: 0.5, d: 0.4, e: 2.4, h: 1.1 };
/** Camera-facing (+gy) face of a desk's CRT, inset 1 px: the screen polygon. */
export function crtScreen(g: DeskGeo): Pt[] {
  const x0 = g.cx - CRT.w / 2, x1 = g.cx + CRT.w / 2, gy = g.gy0 + 0.08 + CRT.d;
  const tl = P(x0, gy, CRT.e + CRT.h), tr = P(x1, gy, CRT.e + CRT.h), br = P(x1, gy, CRT.e), bl = P(x0, gy, CRT.e);
  return [{ x: tl.x + 1, y: tl.y + 2 }, { x: tr.x - 1, y: tr.y + 2 }, { x: br.x - 1, y: br.y - 2 }, { x: bl.x + 1, y: bl.y - 2 }];
}
/** Desk lamp anchor (front-right corner of the desk top). */
export function lampAnchor(g: DeskGeo): Pt { return P(g.gx0 + g.w - 0.12, g.gy0 + g.d - 0.15, DESK_TOP_H); }

/** Chair at the agent's desk spot (drawn in the dynamic layer: its back depends on whether someone sits). */
export function drawChair(ctx: Ctx, pal: PixelPalette, gx: number, gy: number, occupied: boolean, stripe: string, part: "seat" | "rim") {
  const s = 0.4, e = 1.0;
  if (part === "seat") {
    const base = P(gx, gy, 0);
    ctx.fillStyle = pal.chairBase;
    ctx.fillRect(base.x - 3, base.y - 1, 7, 2);           // 4-star base
    const seatBottom = P(gx, gy, e);
    ctx.fillRect(base.x, seatBottom.y, 1, base.y - seatBottom.y); // single post
    isoBox(ctx, gx - s / 2, gy - s / 2, s, s, e, 0.15, { top: pal.chair });
    if (!occupied) {
      // Empty chair: full back on the camera side
      isoBox(ctx, gx - s / 2, gy + s / 2 - 0.08, s, 0.08, e, 1.2, { top: pal.chair });
      line(ctx, P(gx - s / 2, gy + s / 2, e + 1.0), P(gx + s / 2, gy + s / 2, e + 1.0), stripe);
    }
    return;
  }
  if (occupied) {
    // Seated agent: only a 2 px rim of the back, so it never covers the agent (spec 2.4)
    isoBox(ctx, gx - s / 2, gy + s / 2 - 0.08, s, 0.08, e, 0.25, { top: pal.chair });
    line(ctx, P(gx - s / 2, gy + s / 2, e + 0.15), P(gx + s / 2, gy + s / 2, e + 0.15), stripe);
  }
}

// ---------------- builder ----------------
class Builder {
  items: DrawItem[] = [];
  lights: LampLight[] = [];
  bulbs: Pt[] = [];
  constructor(readonly pal: PixelPalette) {}

  /** A plain box; sliced into ≤ 1-tile pieces along any axis longer than 1.5 tiles. */
  box(gx: number, gy: number, w: number, d: number, e: number, h: number, c: BoxColors) {
    const nx = w > 1.5 ? Math.ceil(w) : 1, ny = d > 1.5 ? Math.ceil(d) : 1;
    const sw = w / nx, sd = d / ny;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x = gx + i * sw, y = gy + j * sd;
        this.items.push({ key: x + sw + y + sd, top: e + h, gx: x, draw: (ctx) => isoBox(ctx, x, y, sw, sd, e, h, c) });
      }
    }
  }
  /** A composite piece with its own draw function; key = its footprint's front corner. */
  piece(gxFront: number, gyFront: number, top: number, draw: (ctx: Ctx) => void, gx = gxFront) {
    this.items.push({ key: gxFront + gyFront, top, gx, draw });
  }
}

// ---------------- pieces ----------------
function plant(b: Builder, gx: number, gy: number) {
  b.piece(gx + 0.15, gy + 0.15, 2, (ctx) => {
    isoBox(ctx, gx - 0.15, gy - 0.15, 0.3, 0.3, 0, 0.6, { top: darken("#B5653A", 0.25), left: "#B5653A", right: darken("#B5653A", 0.25) });
    const t = P(gx, gy, 0.6);
    const diamond = (cx: number, cy: number, w: number, c: string) =>
      fillPoly(ctx, [{ x: cx, y: cy - w / 4 }, { x: cx + w / 2, y: cy }, { x: cx, y: cy + w / 4 }, { x: cx - w / 2, y: cy }], c);
    diamond(t.x, t.y - 3, 12, "#3E8E4E");
    diamond(t.x, t.y - 7, 10, "#4FA35F");
    diamond(t.x, t.y - 11, 7, "#4FA35F");
    ctx.fillStyle = "#7CC47F";
    ctx.fillRect(t.x - 2, t.y - 9, 1, 1); ctx.fillRect(t.x + 1, t.y - 13, 1, 1); ctx.fillRect(t.x + 3, t.y - 6, 1, 1);
  });
}

function deskLamp(ctx: Ctx, pal: PixelPalette, a: Pt, scale = 1) {
  ctx.fillStyle = pal.lampMetal;
  ctx.fillRect(a.x - 1, a.y - 1, 3, 2);                    // base 3 × 2
  ctx.fillRect(a.x, a.y - 1 - 7 * scale, 1, 7 * scale);    // pole 1 × 7
  const top = a.y - 1 - 7 * scale - 4;
  ctx.fillStyle = pal.lampShade;                            // shade: trapezoid 3 → 6 px wide, 4 px tall
  ctx.fillRect(a.x - 1, top, 3, 1); ctx.fillRect(a.x - 1, top + 1, 4, 1);
  ctx.fillRect(a.x - 2, top + 2, 5, 1); ctx.fillRect(a.x - 2, top + 3, 6, 1);
  if (pal.lampRim) { ctx.fillStyle = pal.lampRim; ctx.fillRect(a.x - 2, top + 4, 6, 1); }
}

function desk(b: Builder, g: DeskGeo, folders: string[]) {
  const pal = b.pal;
  const { gx0, gy0, w, d, cx } = g;
  b.piece(gx0 + w, gy0 + d, DESK_TOP_H + CRT.h + 0.2, (ctx) => {
    // Two pedestals with drawer lines, then the top slab (rim highlight)
    for (const px of [gx0 + 0.04, gx0 + w - 0.29]) {
      isoBox(ctx, px, gy0 + 0.03, 0.25, d - 0.06, 0, DESK_TOP_H - 0.15, { top: pal.deskSide, left: pal.deskSide, right: darken(pal.deskSide, 0.2) });
      for (const h of [0.7, 1.4]) line(ctx, P(px + 0.03, gy0 + d - 0.03, h), P(px + 0.22, gy0 + d - 0.03, h), pal.deskTrim);
    }
    isoBox(ctx, gx0, gy0, w, d, DESK_TOP_H - 0.15, 0.15, { top: pal.deskTop, left: pal.deskSide, right: darken(pal.deskSide, 0.2), rim: true });
    // CRT (stand + beige case). The screen face is painted per state in the dynamic layer.
    isoBox(ctx, cx - 0.08, gy0 + 0.2, 0.16, 0.16, DESK_TOP_H, 0.2, { top: pal.lampMetal });
    isoBox(ctx, cx - CRT.w / 2, gy0 + 0.08, CRT.w, CRT.d, CRT.e, CRT.h, { top: pal.crtCase, left: darken(pal.crtCase, 0.12), right: darken(pal.crtCase, 0.3) });
    // Clutter: mug + paper (+ Hawa's folder stack in the other agents' colours)
    const mug = P(gx0 + 0.2, gy0 + d - 0.18, DESK_TOP_H);
    ctx.fillStyle = "#E8EAF0"; ctx.fillRect(mug.x, mug.y - 3, 2, 3);
    const paper = P(gx0 + 0.5, gy0 + d - 0.12, DESK_TOP_H);
    ctx.fillStyle = "#F3EEDF"; ctx.fillRect(paper.x, paper.y - 1, 4, 2);
    folders.forEach((c, i) => { const f = P(gx0 + 0.22, gy0 + 0.25, DESK_TOP_H); ctx.fillStyle = c; ctx.fillRect(f.x - 2, f.y - 2 - i * 2, 5, 2); });
    deskLamp(ctx, pal, lampAnchor(g));
  }, gx0);
  const la = lampAnchor(g);
  b.lights.push({ x: la.x, y: la.y - 10, radius: 3, kind: "desk" });
}

/** Wall-mounted bookshelf (drawn with the walls, layer 3) — boards + seeded book spines. */
export function bookshelf(ctx: Ctx, pal: PixelPalette, it: WallItem, seed: number) {
  const depth = 0.3, W = it.wall;
  if (W === "r") isoBox(ctx, it.u0, 0, it.u1 - it.u0, depth, 0, it.h1, { top: pal.shelfEdge, left: pal.shelfWood, right: darken(pal.shelfWood, 0.25) });
  else isoBox(ctx, 0, it.u0, depth, it.u1 - it.u0, 0, it.h1, { top: pal.shelfEdge, left: darken(pal.shelfWood, 0.25), right: pal.shelfWood });
  let rnd = seed * 9301 + 49297;
  const next = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  const px = 1 / 16;
  const levels = [0.25, 1.1, 1.95, 2.8];
  for (const h0 of levels) {
    const h1 = h0 + 0.75;
    wallQuad(ctx, W, depth, it.u0 + px, it.u1 - px, h0, h1, darken(pal.shelfWood, 0.4)); // shelf cavity
    let u = it.u0 + 2 * px, leaned = false;
    while (u < it.u1 - 3 * px) {
      const wpx = next() < 0.5 ? 1 : 2, hh = 0.5 + Math.floor(next() * 3) * 0.125;
      const color = pal.bookSpines[Math.floor(next() * pal.bookSpines.length)];
      if (!leaned && next() < 0.15) {
        // one leaning book per shelf: a 2-step diagonal
        wallCol(ctx, W, depth, u, h0, h0 + hh - 0.25, color, 1);
        wallCol(ctx, W, depth, u + px, h0 + 0.25, h0 + hh, color, 1);
        leaned = true; u += 3 * px; continue;
      }
      wallCol(ctx, W, depth, u, h0, h0 + hh, color, wpx);
      u += (wpx + (next() < 0.25 ? 1 + Math.floor(next() * 2) : 0)) * px;
    }
    wallQuad(ctx, W, depth, it.u0, it.u1, h0 - 0.125, h0, pal.shelfEdge); // board
  }
}

function sofa(b: Builder, gx: number, gy: number, w: number, d: number, backSide: "+gx" | "-gy") {
  const pal = b.pal;
  const seat: BoxColors = { top: pal.sofa, left: darken(pal.sofa, 0.12), right: darken(pal.sofa, 0.25) };
  const back: BoxColors = { top: pal.sofaBack, left: darken(pal.sofaBack, 0.1), right: darken(pal.sofaBack, 0.22) };
  if (backSide === "+gx") {
    // Long along gy, faces −gx (TV wall); back + arms on the camera side
    b.box(gx, gy, w - 0.15, d, 0, 0.5, seat);
    b.box(gx + w - 0.15, gy, 0.15, d, 0, 1.4, back);
    b.box(gx, gy - 0.12, w, 0.12, 0, 0.9, back);
    b.box(gx, gy + d, w, 0.12, 0, 0.9, back);
    // seams + throw pillow sit on the seat: drawn right after the seat slice they lie on
    const seams = [gy + d / 3, gy + (2 * d) / 3];
    b.items.push({ key: gx + w - 0.15 + gy + d + 0.001, top: 0.6, gx, draw: (ctx) => {
      seams.forEach((s) => line(ctx, P(gx + 0.05, s, 0.5), P(gx + w - 0.2, s, 0.5), pal.sofaSeam));
    } });
  } else {
    // Loveseat against the back-right wall, faces the camera (+gy)
    b.box(gx, gy, w, 0.15, 0, 1.4, back);
    b.box(gx, gy + 0.15, w, d - 0.15, 0, 0.5, seat);
    b.box(gx - 0.12, gy, 0.12, d, 0, 0.9, back);
    b.box(gx + w, gy, 0.12, d, 0, 0.9, back);
    b.items.push({ key: gx + w + gy + d + 0.001, top: 0.6, gx, draw: (ctx) => {
      line(ctx, P(gx + w / 2, gy + 0.2, 0.5), P(gx + w / 2, gy + d - 0.02, 0.5), pal.sofaSeam);
      const pl = P(gx + 0.25, gy + 0.3, 0.5);
      ctx.fillStyle = "#F5C542"; ctx.fillRect(pl.x - 2, pl.y - 3, 4, 3);
    } });
  }
}

function railing(b: Builder, x0: number, y0: number, x1: number, y1: number) {
  const pal = b.pal, len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 0.7));
  for (let i = 0; i <= n; i++) {
    const gx = x0 + ((x1 - x0) * i) / n, gy = y0 + ((y1 - y0) * i) / n;
    b.box(gx - 0.04, gy - 0.04, 0.08, 0.08, 0, 1.6, { top: pal.railPost });
  }
  const t = 0.08;
  b.box(Math.min(x0, x1) - t / 2, Math.min(y0, y1) - t / 2, Math.abs(x1 - x0) + t, Math.abs(y1 - y0) + t, 1.6, 0.12, { top: pal.railWood });
}

function daybed(b: Builder, gx: number, gyHead: number) {
  const pal = b.pal, w = 0.9, d = 2.1, x = gx - w / 2;
  b.piece(x + w, gyHead + d, 0.75, (ctx) => {
    isoBox(ctx, x, gyHead, w, d, 0, 0.35, { top: pal.sofaBack, left: darken(pal.sofaBack, 0.1), right: darken(pal.sofaBack, 0.22) });
    isoBox(ctx, x + 0.04, gyHead + 0.04, w - 0.08, d - 0.08, 0.35, 0.25, { top: pal.napCushion });
    isoBox(ctx, x - 0.02, gyHead - 0.1, w + 0.04, 0.15, 0, 0.9, { top: pal.sofaBack });           // headboard
    isoBox(ctx, x + 0.15, gyHead + 0.1, w - 0.3, 0.35, 0.6, 0.12, { top: "#E8EAF0" });           // pillow
    isoBox(ctx, x + 0.03, gyHead + d - 1.0, w - 0.06, 0.97, 0.6, 0.06, { top: "#7A62B8" });     // blanket
  }, x);
}

function smallTable(b: Builder, gx: number, gy: number, s: number, h: number, top: string, side: string, extra?: (ctx: Ctx) => void) {
  b.piece(gx + s / 2, gy + s / 2, h, (ctx) => {
    isoBox(ctx, gx - 0.05, gy - 0.05, 0.1, 0.1, 0, h - 0.12, { top: side });
    isoBox(ctx, gx - s / 2, gy - s / 2, s, s, h - 0.12, 0.12, { top, left: side, right: darken(side, 0.2), rim: true });
    extra?.(ctx);
  }, gx - s / 2);
}

// ---------------- per floor ----------------
export function buildFurniture(f: FloorId, pal: PixelPalette, agentHex: Record<string, string>): FurnitureSet {
  const b = new Builder(pal);
  if (f === 0) floor0(b, agentHex);
  else floor1(b);
  b.items.sort(sortItems);
  return { items: b.items, lights: b.lights, bulbs: b.bulbs };
}

function floor0(b: Builder, agentHex: Record<string, string>) {
  const pal = b.pal;
  const deskTop: BoxColors = { top: pal.deskTop, left: pal.deskSide, right: darken(pal.deskSide, 0.2), rim: true };
  // Meeting room (A): long table, 8 chair stubs (M1–M8), low partitions with doorway gaps, plant
  b.box(1.25, 2.1, 3.5, 1.3, 0, 2.2, deskTop);
  for (const gx of [1.55, 2.45, 3.35, 4.25]) {
    for (const gy of [1.55, 3.65]) {
      b.piece(gx + 0.2, gy + 0.2, 1.4, (ctx) => {
        isoBox(ctx, gx - 0.2, gy - 0.2, 0.4, 0.4, 0, 1.1, { top: pal.chair });
        line(ctx, P(gx - 0.2, gy + 0.2, 0.9), P(gx + 0.2, gy + 0.2, 0.9), "#8C94A5");
      }, gx - 0.2);
    }
  }
  const part: BoxColors = { top: pal.partitionCap, left: pal.partition, right: darken(pal.partition, 0.15) };
  b.box(6, 0, 0.15, 2.5, 0, 1.2, part); b.box(6, 3.5, 0.15, 1.65, 0, 1.2, part);
  b.box(0, 5, 2, 0.15, 0, 1.2, part); b.box(3, 5, 3, 0.15, 0, 1.2, part);
  plant(b, 5.4, 0.55);

  // Desks (B): one per DESKS entry, Hawa first with the folder stack
  const others = Object.keys(DESKS).filter((id) => id !== "default").map((id) => agentHex[id]).filter(Boolean);
  for (const id of Object.keys(DESKS)) {
    const g = deskGeo(id)!;
    desk(b, g, id === "default" ? [...others, "#F97316"] : []);
  }

  // Claude Tool Bench (B2): workbench with a terminal, server rack (LEDs are dynamic)
  const bx = BENCH_GRID.gx - 1.25, by = BENCH_GRID.gy - 1.5;
  b.piece(bx + 2.5, by + 1, 3.2, (ctx) => {
    isoBox(ctx, bx, by, 2.5, 1, 0, 2.05, { top: pal.lampMetal, left: darken(pal.lampMetal, 0.1), right: darken(pal.lampMetal, 0.3) });
    isoBox(ctx, bx, by, 2.5, 1, 2.05, 0.15, { top: pal.deskTop, left: pal.deskSide, right: darken(pal.deskSide, 0.2), rim: true });
    isoBox(ctx, bx + 1.0, by + 0.15, 0.6, 0.35, 2.2, 1.0, { top: "#2B2F3A", left: "#1F2430", right: "#161A22" });
  }, bx);
  b.box(19.2, 0.3, 0.55, 0.55, 0, 3.6, { top: "#2B2F3A", left: "#1F2430", right: "#161A22" });
  plant(b, 19.4, 4.6);

  // Open work area (C): two small tables, water cooler, plants
  smallTable(b, 10.6, 9.6, 1.0, 2.0, pal.deskTop, pal.deskSide);
  smallTable(b, 14.4, 10.6, 1.0, 2.0, pal.deskTop, pal.deskSide);
  b.piece(19.5, 7.7, 3, (ctx) => {
    isoBox(ctx, 19.1, 7.3, 0.4, 0.4, 0, 2.0, { top: "#E8EAF0", left: "#D2D6DE", right: "#B8BDC8" });
    isoBox(ctx, 19.15, 7.35, 0.3, 0.3, 2.0, 0.7, { top: "#BFE3F5", left: "#A8D4EC", right: "#8FC2DE" });
  }, 19.1);
  plant(b, 8.3, 13.3); plant(b, 19.3, 12.9);

  // Stair lobby (D): 6 stacked steps rising toward the back (gy decreasing), drawn back → front
  const s = STAIR_GRID, run = (s.gyFront - s.gyBack) / 6;
  for (let i = 5; i >= 0; i--) {
    const gy0 = s.gyFront - (i + 1) * run;
    b.box(s.gx0, gy0, s.gx1 - s.gx0, run, 0, ((i + 1) * WALL_H) / 6, { top: pal.stairTop, left: pal.stairSide, right: darken(pal.stairSide, 0.15) });
  }
  railing(b, s.gx1 + 0.05, s.gyBack, s.gx1 + 0.05, s.gyFront);
}

function floor1(b: Builder) {
  const pal = b.pal;
  // TV corner: cabinet under the wall TV, 3-seat sofa facing it, loveseat on the back wall, coffee table
  b.box(0.12, 2.25, 0.5, 2.5, 0, 1.0, { top: pal.tvCabinet, left: darken(pal.tvCabinet, 0.15), right: lighten(pal.tvCabinet, 0.06) });
  const tv = LOUNGE_SPOTS.filter((s) => s.id === "TV-1" || s.id === "TV-3").map((s) => toGrid(s.x, s.z));
  sofa(b, tv[0].gx - 0.3, tv[0].gy - 0.45, 0.7, tv[1].gy - tv[0].gy + 0.9, "+gx");
  const ls = LOUNGE_SPOTS.filter((s) => s.id === "TV-4" || s.id === "TV-5").map((s) => toGrid(s.x, s.z));
  sofa(b, ls[0].gx - 0.45, 0.2, ls[1].gx - ls[0].gx + 0.9, ls[0].gy - 0.15, "-gy");
  smallTable(b, 2.4, 3.5, 1.0, 0.8, pal.deskTop, pal.deskSide, (ctx) => {
    const t = P(2.4, 3.5, 0.8);
    ctx.fillStyle = "#F5C542"; ctx.fillRect(t.x - 2, t.y - 4, 4, 3); ctx.fillStyle = "#FFF6D8"; ctx.fillRect(t.x - 1, t.y - 5, 2, 1);
  });
  plant(b, 0.5, 5.7); plant(b, 6.9, 0.5);

  // Rest / nap room: low partition with doorway, three daybeds (NAP-1..3), side tables + mini lamps, floor lamp
  const part: BoxColors = { top: pal.partitionCap, left: pal.partition, right: darken(pal.partition, 0.15) };
  b.box(8, 5, 2.75, 0.18, 0, 1.2, part); b.box(11.75, 5, 4.25, 0.18, 0, 1.2, part);
  for (const sp of LOUNGE_SPOTS.filter((s) => s.zone === "nap")) {
    const g = toGrid(sp.x, sp.z);
    daybed(b, g.gx, g.gy - 1.0);
  }
  for (const gx of [10.4, 12.4]) {
    smallTable(b, gx, 1.0, 0.45, 0.8, pal.tvCabinet, darken(pal.tvCabinet, 0.1), (ctx) => deskLamp(ctx, pal, P(gx, 1.0, 0.8), 0.6));
    const a = P(gx, 1.0, 0.8);
    b.lights.push({ x: a.x, y: a.y - 6, radius: 1.5, kind: "mini" });
  }
  b.piece(14.85, 0.85, 3.4, (ctx) => {
    const a = P(14.7, 0.7, 0);
    ctx.fillStyle = pal.lampMetal; ctx.fillRect(a.x - 2, a.y - 1, 5, 2); ctx.fillRect(a.x, a.y - 25, 1, 24);
    ctx.fillStyle = pal.lampShade;
    ctx.fillRect(a.x - 2, a.y - 31, 5, 1); ctx.fillRect(a.x - 3, a.y - 30, 7, 2); ctx.fillRect(a.x - 4, a.y - 28, 9, 2);
    if (pal.lampRim) { ctx.fillStyle = pal.lampRim; ctx.fillRect(a.x - 4, a.y - 26, 9, 1); }
  }, 14.55);
  const fl = P(14.7, 0.7, 0);
  b.lights.push({ x: fl.x, y: fl.y - 28, radius: 2.5, kind: "floor" });

  // Commons: beanbags (BEAN-1/2) in accent colours, plants
  LOUNGE_SPOTS.filter((s) => s.zone === "commons").forEach((sp, i) => {
    const g = toGrid(sp.x, sp.z), c = pal.bookSpines[i === 0 ? 0 : 3];
    b.piece(g.gx + 0.4, g.gy + 0.4, 0.6, (ctx) => {
      const o = P(g.gx, g.gy, 0);
      pixelEllipse(ctx, o.x, o.y - 2, 9, 4, darken(c, 0.25));
      pixelEllipse(ctx, o.x, o.y - 4, 8, 3, c);
      pixelEllipse(ctx, o.x - 1, o.y - 6, 5, 2, lighten(c, 0.15));
    }, g.gx - 0.4);
  });
  plant(b, 8.3, 13.3); plant(b, 15.3, 6.9);

  // Stair landing: railing around the well
  const s = STAIR_GRID;
  railing(b, s.gx1 + 0.05, s.gyBack, s.gx1 + 0.05, s.gyFront);

  // Balcony: railing on the 3 outer edges, planters, bistro table + 2 chairs (BAL-4/5), string lights
  railing(b, 16.05, 0.05, GRID_W - 0.05, 0.05);
  railing(b, GRID_W - 0.05, 0.05, GRID_W - 0.05, GRID_D - 0.05);
  railing(b, 16.05, GRID_D - 0.05, GRID_W - 0.05, GRID_D - 0.05);
  for (const [gx, gy] of [[16.3, 0.35], [16.3, 12.9]] as const) {
    b.piece(gx + 1.2, gy + 0.45, 1.2, (ctx) => {
      isoBox(ctx, gx, gy, 1.2, 0.45, 0, 0.8, { top: "#3E8E4E", left: "#B5653A", right: darken("#B5653A", 0.25) });
      ctx.fillStyle = "#4FA35F";
      for (let i = 0; i < 4; i++) { const t = P(gx + 0.2 + i * 0.27, gy + 0.22, 0.8); ctx.fillRect(t.x - 1, t.y - 4, 3, 4); }
      ctx.fillStyle = "#E0A33A"; const fl2 = P(gx + 0.6, gy + 0.22, 0.8); ctx.fillRect(fl2.x, fl2.y - 5, 1, 1);
    }, gx);
  }
  const bal = LOUNGE_SPOTS.filter((s) => s.id === "BAL-4" || s.id === "BAL-5").map((s) => toGrid(s.x, s.z));
  const tx = (bal[0].gx + bal[1].gx) / 2, ty = bal[0].gy;
  smallTable(b, tx, ty, 0.45, 1.5, pal.deskTop, pal.lampMetal);
  for (const g of bal) {
    b.piece(g.gx + 0.18, g.gy + 0.18, 1.3, (ctx) => {
      isoBox(ctx, g.gx - 0.18, g.gy - 0.18, 0.36, 0.36, 0, 0.9, { top: pal.railWood });
    }, g.gx - 0.18);
  }
  // String lights: hung from 3 poles on the outer rail (spec puts them at gx 16, where they would float
  // across the room in a fixed iso view), sagging 1 px between bulbs.
  for (const gy of [0.05, 7, GRID_D - 0.05]) b.box(GRID_W - 0.09, gy - 0.04, 0.08, 0.08, 0, 3.2, { top: pal.railPost });
  for (let gy = 0.5; gy < GRID_D; gy += 1) {
    const sag = Math.sin(((gy % 7) / 7) * Math.PI) * 0.5;
    b.bulbs.push(P(GRID_W - 0.05, gy, 3.1 - sag));
  }
}

/** Wall-mounted items that need furniture art (bookshelves) — drawn with the walls. */
export function drawWallFurniture(ctx: Ctx, pal: PixelPalette, f: FloorId) {
  WALL_ITEMS[f].forEach((it, i) => { if (it.kind === "shelf") bookshelf(ctx, pal, it, i + 1 + f * 7); });
}

/** String lights along the balcony edge (static; lit at night). */
export function drawBulbs(ctx: Ctx, pal: PixelPalette, bulbs: Pt[]) {
  if (!bulbs.length) return;
  for (let i = 1; i < bulbs.length; i++) line(ctx, { x: bulbs[i - 1].x, y: bulbs[i - 1].y + 1 }, { x: bulbs[i].x, y: bulbs[i].y + 1 }, darken(pal.railPost, 0.2));
  for (const p of bulbs) {
    if (pal.bulbHalo) { ctx.fillStyle = pal.bulbHalo; ctx.fillRect(p.x - 1, p.y, 4, 4); }
    ctx.fillStyle = pal.bulb; ctx.fillRect(p.x, p.y + 1, 2, 2);
  }
}
