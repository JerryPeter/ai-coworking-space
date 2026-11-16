// "Pixel Office" renderer (pixel-office-design-spec.md section 2, tech plan 3): Canvas 2D isometric
// pixel art. Plain class, not a React component; same imperative API as OfficeScene so Office.tsx
// can hold either one. No Three.js import at runtime (type-only imports).
//
// Rendering model (spec 2.0): every floor is drawn into a LOW-RES buffer (1 art px = 1 buffer px), then
// blitted onto the on-screen canvas scaled by an integer factor with smoothing off. Layers 0–4 (backdrop,
// floor, walls, furniture) are cached per (floor, time of day); only the dynamic layers redraw per frame.
import type { HumanState, RobotState } from "./characters";
import type { FloorId, Preset } from "./layout";
import type { SceneOptions } from "./OfficeScene";
import { darken, PIXEL_PALETTES, type PixelPalette, type TimeOfDay } from "./palettes";
import { fillPoly, isoBox, isoTile, wallCol, wallQuad, type Ctx } from "./pixel-draw";
import {
  BUF_H, BUF_W, FLOOR_TILES, GRID_D, GRID_W, isoProject, STAIR_GRID, WALL_H, WALL_ITEMS, WALL_T, WALLS,
  type TileKind, type WallItem,
} from "./pixel-layout";
import type { OfficeRenderer } from "./types";
import { buildFurniture, crtScreen, deskGeo, drawBulbs, drawWallFurniture, type FurnitureSet } from "./pixel-furniture";

export type PixelSceneOptions = SceneOptions;

const P = isoProject;

interface Panel { floor: FloorId; x: number; y: number; s: number; caption?: string }

export class PixelOfficeScene implements OfficeRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private tod: TimeOfDay = "day";
  private current: Preset = "overview";
  private firstFrame = false;
  private dpr = 1;
  private panels: Panel[] = [];
  /** Cached static layers per `${floor}-${tod}`. */
  private statics = new Map<string, HTMLCanvasElement>();
  /** Per-floor frame buffers (static blit + dynamic layers). */
  private frames: HTMLCanvasElement[] = [];
  private furniture = new Map<string, FurnitureSet>();
  private agentHex: Record<string, string> = {};

  constructor(private host: HTMLElement, private opts: PixelSceneOptions) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pixel-office";
    this.canvas.style.imageRendering = "pixelated";
    if (!CSS.supports?.("image-rendering", "pixelated")) this.canvas.style.imageRendering = "crisp-edges";
    this.canvas.setAttribute("role", "img");
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available in this browser");
    this.ctx = ctx;
    this.frames = [this.makeBuffer(), this.makeBuffer()];
    opts.characters.forEach((c) => { this.agentHex[c.id] = c.hex; });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  private makeBuffer() {
    const c = document.createElement("canvas");
    c.width = BUF_W; c.height = BUF_H;
    return c;
  }
  private get pal(): PixelPalette { return PIXEL_PALETTES[this.tod]; }

  // ---------------- public API (OfficeRenderer) ----------------
  setAgentState(_id: string, _state: HumanState, _label: string, _task?: string | null) {}
  setRobotState(_state: RobotState, _label: string) {}
  preset(p: Preset) { this.current = p; this.layout(); this.render(); }
  focus(_id: string) {}
  setTimeOfDay(tod: TimeOfDay) {
    if (tod === this.tod) return;
    this.tod = tod;     // instant palette swap; the static cache is keyed by tod
    this.render();
  }

  // ---------------- sizing ----------------
  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.layout();
    this.render();
  }

  /** Integer scale when it fits (spec 2.0), half steps between 1 and 2, plain fit below 1 (phones). */
  private static scaleFor(fit: number) {
    return fit >= 2 ? Math.floor(fit) : fit >= 1 ? Math.floor(fit * 2) / 2 : fit;
  }

  private layout() {
    const W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    const maxS = 4 * d; // never more than 4 css px per art px
    if (this.current === "overview") {
      // Side by side (spec 4.3): Floor 0 left, Floor 1 right, captions above each panel.
      const gap = 16 * d, cap = 22 * d, top = 56 * d;
      const pw = (W - gap * 3) / 2, ph = H - top - cap - 40 * d;
      const s = Math.min(maxS, PixelOfficeScene.scaleFor(Math.min(pw / BUF_W, ph / BUF_H)));
      const bw = BUF_W * s, bh = BUF_H * s;
      const y = Math.round(top + cap + Math.max(0, (ph - bh) / 2));
      const x0 = Math.round((W - (bw * 2 + gap)) / 2);
      this.panels = [
        { floor: 0, x: x0, y, s, caption: "Workspace" },
        { floor: 1, x: Math.round(x0 + bw + gap), y, s, caption: "Lounge" },
      ];
      return;
    }
    const s = Math.min(maxS, PixelOfficeScene.scaleFor(Math.min(W / BUF_W, H / BUF_H)));
    const bw = BUF_W * s, bh = BUF_H * s;
    // Centre, but keep clear of the top toolbar when there is vertical slack.
    const y = Math.round(Math.max((H - bh) / 2, Math.min(56 * d, H - bh)));
    this.panels = [{ floor: this.current === "lounge" ? 1 : 0, x: Math.round((W - bw) / 2), y, s }];
  }

  // ---------------- frame ----------------
  private render() {
    const { ctx, canvas, pal } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = pal.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of this.panels) {
      const frame = this.frames[p.floor];
      const fctx = frame.getContext("2d")!;
      fctx.imageSmoothingEnabled = false;
      fctx.drawImage(this.staticFor(p.floor), 0, 0);
      this.drawDynamic(fctx, p.floor);
      const bw = Math.round(BUF_W * p.s), bh = Math.round(BUF_H * p.s);
      if (p.floor === 1 && this.panels.length === 1) {
        // Single Floor 1 view: continue the sky past the buffer edges so it doesn't read as a box.
        ctx.fillStyle = pal.sky;
        ctx.fillRect(0, 0, p.x + 1, p.y + P(0, GRID_D).y * p.s);
        ctx.fillRect(p.x + bw - 1, 0, canvas.width - p.x - bw + 1, p.y + P(GRID_W, 0).y * p.s);
        ctx.fillRect(p.x, 0, bw, p.y + 1);
      }
      ctx.drawImage(frame, p.x, p.y, bw, bh);
      if (p.caption) {
        ctx.font = `600 ${12 * this.dpr}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillStyle = this.tod === "day" ? "#3A2A14" : "#E8D9B0";
        ctx.fillText(p.caption, p.x + 4 * this.dpr, p.y - 4 * this.dpr);
      }
    }
    this.canvas.setAttribute("aria-label", `Pixel office, ${this.current === "overview" ? "both floors" : this.current === "lounge" ? "Floor 1 lounge" : "Floor 0 workspace"}`);
    if (!this.firstFrame) { this.firstFrame = true; this.opts.onFirstFrame?.(); }
  }

  private staticFor(f: FloorId) {
    const key = `${f}-${this.tod}`;
    let c = this.statics.get(key);
    if (!c) {
      c = this.makeBuffer();
      const x = c.getContext("2d")!;
      x.imageSmoothingEnabled = false;
      this.drawFloor(x, f);
      this.statics.set(key, c);
    }
    return c;
  }

  // ---------------- layer 0–3: backdrop, floor, walls (spec 2.2) ----------------
  private tileColor(k: TileKind, gx: number, gy: number): string {
    const p = this.pal;
    switch (k) {
      case "M": return p.carpetMeeting;
      case "B": return p.benchMat;
      case "R": case "C": return p.rugOpen;
      case "L": return p.rugLounge;
      case "N": return p.napFloor;
      case "K": return gx % 2 === 0 ? p.deckA : p.deckB; // planks: stripes along gx, not a checker
      default: return (gx + gy) % 2 === 0 ? p.floorA : p.floorB;
    }
  }

  /** Draw one floor (0 = workspace, 1 = lounge) into a buffer context: backdrop, tiles, slab, walls. */
  drawFloor(ctx: Ctx, f: FloorId) {
    const p = this.pal;
    // Layer 0 — backdrop (+ sky above the balcony on Floor 1)
    ctx.fillStyle = p.backdrop;
    ctx.fillRect(0, 0, BUF_W, BUF_H);
    if (f === 1) this.drawSky(ctx);

    // Floor slab first (its top face is then covered by the tiles): 4 px thick front edges (dollhouse cut).
    isoBox(ctx, 0, 0, GRID_W, GRID_D, -0.5, 0.5, { top: p.slab, left: p.slab, right: p.outline });
    // Layer 1 — tiles, back to front. Plain floor gets a 1 px grout line on its two back edges:
    // the tile is filled in grout, then refilled 1 px lower (the overflow is covered by the next row).
    const tiles = FLOOR_TILES[f];
    for (let gy = 0; gy < GRID_D; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const k = tiles[gy][gx];
        const col = this.tileColor(k, gx, gy);
        if (k === "." || k === "D") {
          const a = P(gx, gy), b = P(gx + 1, gy), c = P(gx + 1, gy + 1), d = P(gx, gy + 1);
          fillPoly(ctx, [a, b, c, d], p.grout);
          fillPoly(ctx, [a, b, c, d].map((q) => ({ x: q.x, y: q.y + 1 })), col);
        } else {
          isoTile(ctx, gx, gy, col);
        }
      }
    }
    if (f === 1) this.drawStairwell(ctx);

    // Layer 3 — back walls with windows, curtains, shelves, whiteboard/TV
    this.drawWalls(ctx, f);
    drawWallFurniture(ctx, p, f);

    // Layer 4 — furniture, depth-sorted back → front (long pieces pre-sliced)
    const set = this.furnitureFor(f);
    for (const it of set.items) it.draw(ctx);
    drawBulbs(ctx, p, set.bulbs);
  }

  private furnitureFor(f: FloorId) {
    const key = `${f}-${this.tod}`;
    let set = this.furniture.get(key);
    if (!set) { set = buildFurniture(f, this.pal, this.agentHex); this.furniture.set(key, set); }
    return set;
  }

  // ---------------- dynamic layers (per frame) ----------------
  private drawDynamic(ctx: Ctx, f: FloorId) {
    const p = this.pal;
    if (f === 0) {
      for (const id of Object.keys(this.agentHex)) {
        const g = deskGeo(id);
        if (g) fillPoly(ctx, crtScreen(g), p.crtScreenOff);
      }
    }
  }

  private drawSky(ctx: Ctx) {
    const p = this.pal;
    // Floor 1 is upstairs: everything behind the back floor edges is sky (it shows above the balcony,
    // where there is no back wall).
    const r = P(GRID_W, 0), back = P(0, 0), l = P(0, GRID_D);
    fillPoly(ctx, [{ x: 0, y: 0 }, { x: BUF_W, y: 0 }, { x: BUF_W, y: r.y }, r, back, l, { x: 0, y: l.y }], p.sky);
    const a = P(WALLS[1].r, 0, WALL_H + 3);
    if (this.tod === "day") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(a.x + 14, 24, 8, 3); ctx.fillRect(a.x + 17, 22, 5, 2);
      ctx.fillRect(a.x + 40, 46, 8, 3); ctx.fillRect(a.x + 43, 44, 5, 2);
    } else {
      ctx.fillStyle = "#E8EAF0";
      [[6, 10], [20, 30], [34, 14], [48, 40], [58, 22], [12, 52], [28, 64], [52, 70], [40, 90], [62, 100]]
        .forEach(([x, y]) => ctx.fillRect(a.x + x, y, 1, 1));
      // 6 × 6 pixel moon
      ctx.fillStyle = "#F3EBD0";
      ctx.fillRect(a.x + 39, 14, 4, 6); ctx.fillRect(a.x + 38, 15, 6, 4);
    }
  }

  private drawStairwell(ctx: Ctx) {
    const p = this.pal, s = STAIR_GRID;
    // Opening in the Floor 1 slab where the stair comes up: dark well, the top steps' treads sunk below
    // the floor (each one 4 px lower), and the well's far rim lit like a cut edge.
    const w = s.gx1 - s.gx0;
    isoTile(ctx, s.gx0, s.gyBack, darken(p.stairSide, 0.45), w, s.gyFront - s.gyBack);
    for (let i = 0; i < 5; i++) {
      const gy = s.gyBack + i * 0.7, drop = 0.5 * (i + 1);
      const tread = isoProject(s.gx0, gy, -drop);
      if (tread.y > P(s.gx0, s.gyFront).y) break;
      isoTile(ctx, s.gx0, gy, darken(p.stairTop, 0.12 * i), w, 0.55, -drop);
    }
  }

  private drawWalls(ctx: Ctx, f: FloorId) {
    const p = this.pal, w = WALLS[f];
    // Back-left wall (along gx = 0): its visible face faces +gx → the darker "right face" shade.
    isoBox(ctx, -WALL_T, -WALL_T, WALL_T, w.l + WALL_T, 0, WALL_H, { top: p.wallCap, right: p.wallShade, left: p.wall });
    wallQuad(ctx, "l", 0, 0, w.l, 0, 0.375, p.wallSkirt);
    // Back-right wall (along gy = 0): visible face faces +gy → base wall colour.
    isoBox(ctx, 0, -WALL_T, w.r, WALL_T, 0, WALL_H, { top: p.wallCap, left: p.wall, right: p.wallShade });
    wallQuad(ctx, "r", 0, 0, w.r, 0, 0.375, p.wallSkirt);
    for (const it of WALL_ITEMS[f]) this.drawWallItem(ctx, it);
  }

  private drawWallItem(ctx: Ctx, it: WallItem) {
    const p = this.pal, W = it.wall;
    const q = (u0: number, u1: number, h0: number, h1: number, c: string) => wallQuad(ctx, W, 0, u0, u1, h0, h1, c);
    const px = 1 / 16; // one buffer pixel along the wall, in tiles (a tile edge spans 16 px horizontally)
    switch (it.kind) {
      case "window": {
        const fr = 1 / 8; // 1 px of height in world units
        q(it.u0, it.u1, it.h0, it.h1, p.windowFrame);
        q(it.u0 + px, it.u1 - px, it.h0 + fr, it.h1 - fr, p.windowGlass);
        if (p.windowShine) q(it.u0 + px, it.u1 - px, it.h1 - 2 * fr, it.h1 - fr, p.windowShine);
        if (p.moonStrip) {
          // 2 px diagonal moon strip across each pane
          for (let i = 0; i < 6; i++) wallCol(ctx, W, 0, it.u0 + (3 + i) * px, it.h0 + 0.4 + i * fr, it.h0 + 0.65 + i * fr, p.moonStrip, 1);
          for (let i = 0; i < 6; i++) wallCol(ctx, W, 0, it.u0 + (14 + i) * px, it.h0 + 0.4 + i * fr, it.h0 + 0.65 + i * fr, p.moonStrip, 1);
        }
        wallCol(ctx, W, 0, (it.u0 + it.u1) / 2, it.h0, it.h1, p.windowFrame);
        // Curtains: 3 px strips each side with fold lines, rod across the top
        q(it.u0 - 3 * px, it.u0 + px, it.h0 - fr, it.h1 + fr, p.curtain);
        q(it.u1 - px, it.u1 + 3 * px, it.h0 - fr, it.h1 + fr, p.curtain);
        wallCol(ctx, W, 0, it.u0 - 2 * px, it.h0 - fr, it.h1 + fr, p.curtainShade);
        wallCol(ctx, W, 0, it.u1 + 1 * px, it.h0 - fr, it.h1 + fr, p.curtainShade);
        q(it.u0 - 5 * px, it.u1 + 5 * px, it.h1 + fr, it.h1 + 2 * fr, p.windowFrame);
        break;
      }
      case "whiteboard":
        q(it.u0, it.u1, it.h0, it.h1, p.lampMetal);
        q(it.u0 + 1 / 16, it.u1 - 1 / 16, it.h0 + 1 / 8, it.h1 - 1 / 8, p.whiteboard);
        break;
      case "screen":
      case "tv":
        q(it.u0, it.u1, it.h0, it.h1, "#111827");
        break;
      case "sign":
        q(it.u0, it.u1, it.h0, it.h1, p.whiteboard);
        break;
      case "shelf":
        break; // drawn as furniture (it has depth)
    }
  }

  // ---------------- lifecycle ----------------
  dispose() {
    this.ro.disconnect();
    this.statics.clear();
    this.canvas.remove();
  }
}
