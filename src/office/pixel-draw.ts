// Pixel-art drawing primitives for the Pixel Office (pixel-office-design-spec.md 2.1 "Primitive helpers").
// Everything works in BUFFER pixels and fills with integer fillRect scanlines, so edges stay crisp
// (no anti-aliased seams between neighbouring tiles) when the buffer is upscaled with smoothing off.
import { darken, lighten } from "./palettes";
import { BT_H, BT_W, isoProject } from "./pixel-layout";

export type Ctx = CanvasRenderingContext2D;
export interface Pt { x: number; y: number }

/** Convex polygon fill by horizontal scanlines (sampled at pixel centres). */
export function fillPoly(ctx: Ctx, pts: Pt[], color: string, rowStep = 1) {
  ctx.fillStyle = color;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y += rowStep) {
    const yc = y + 0.5;
    let xl = Infinity, xr = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        const x = a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
    }
    const l = Math.round(xl), r = Math.round(xr);
    if (r > l) ctx.fillRect(l, y, r - l, 1);
  }
}

const P = isoProject;

/** One floor rhombus: 4 corners (back, right, front, left) of tile (gx, gy), w × d tiles. */
export function isoTile(ctx: Ctx, gx: number, gy: number, color: string, w = 1, d = 1, elev = 0) {
  fillPoly(ctx, [P(gx, gy, elev), P(gx + w, gy, elev), P(gx + w, gy + d, elev), P(gx, gy + d, elev)], color);
}

export interface BoxColors { top: string; left?: string; right?: string; rim?: boolean }

/** isoBox: footprint [gx, gx+w] × [gy, gy+d] tiles, from elevation e to e+h (world units).
 *  Faces: top, left (+gy, front-left) and right (+gx, front-right). Default shading spec 2.1:
 *  left = top darkened 18 %, right = top darkened 32 %; optional 1 px rim highlight. */
export function isoBox(ctx: Ctx, gx: number, gy: number, w: number, d: number, e: number, h: number, c: BoxColors) {
  const t = e + h;
  const left = c.left ?? darken(c.top, 0.18), right = c.right ?? darken(c.top, 0.32);
  if (h > 0) {
    fillPoly(ctx, [P(gx, gy + d, t), P(gx + w, gy + d, t), P(gx + w, gy + d, e), P(gx, gy + d, e)], left);
    fillPoly(ctx, [P(gx + w, gy, t), P(gx + w, gy + d, t), P(gx + w, gy + d, e), P(gx + w, gy, e)], right);
  }
  fillPoly(ctx, [P(gx, gy, t), P(gx + w, gy, t), P(gx + w, gy + d, t), P(gx, gy + d, t)], c.top);
  if (c.rim) {
    // 1 px highlight along the top face's two front edges.
    const hi = lighten(c.top, 0.12);
    line(ctx, P(gx, gy + d, t), P(gx + w, gy + d, t), hi);
    line(ctx, P(gx + w, gy, t), P(gx + w, gy + d, t), hi);
  }
}

/** 1 px pixel line (Bresenham) between two buffer points. */
export function line(ctx: Ctx, a: Pt, b: Pt, color: string) {
  ctx.fillStyle = color;
  let x0 = Math.round(a.x), y0 = Math.round(a.y);
  const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** A quad on a back-wall plane. wall "r" lies along gy = g0 (u = gx), wall "l" along gx = g0 (u = gy). */
export function wallQuad(ctx: Ctx, wall: "r" | "l", g0: number, u0: number, u1: number, h0: number, h1: number, color: string) {
  const at = (u: number, h: number) => (wall === "r" ? P(u, g0, h) : P(g0, u, h));
  fillPoly(ctx, [at(u0, h1), at(u1, h1), at(u1, h0), at(u0, h0)], color);
}

/** Vertical 1 px column on a wall plane at position u, heights h0..h1 (book spines, mullions, folds). */
export function wallCol(ctx: Ctx, wall: "r" | "l", g0: number, u: number, h0: number, h1: number, color: string, wpx = 1) {
  const a = wall === "r" ? P(u, g0, h1) : P(g0, u, h1);
  const b = wall === "r" ? P(u, g0, h0) : P(g0, u, h0);
  ctx.fillStyle = color;
  ctx.fillRect(a.x, a.y, wpx, Math.max(1, b.y - a.y));
}

/** Stepped ellipse from horizontal fillRects (shadows) — spec "pixelEllipse". */
export function pixelEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    if (w > 0) ctx.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
  }
}

/** Half extents of one tile in buffer px (for callers that offset by tile fractions). */
export const HALF_W = BT_W / 2, HALF_H = BT_H / 2;

/** "#RRGGBB" + alpha → rgba() string. */
export function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Night light pool: radial gradient squashed onto the iso floor plane (2:1), inner colour at `alpha`,
 *  fading to transparent at `radiusTiles`. Drawn in the low-res buffer, so the upscale makes it stepped. */
export function isoGlow(ctx: Ctx, x: number, y: number, radiusTiles: number, color: string, alpha: number) {
  const r = radiusTiles * HALF_W * Math.SQRT2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
