// "Pixel Office" renderer (pixel-office-design-spec.md section 2, tech plan 3): Canvas 2D isometric
// pixel art. Plain class, not a React component; same imperative API as OfficeScene so Office.tsx
// can hold either one. No Three.js import at runtime (type-only imports).
//
// Rendering model (spec 2.0): every floor is drawn into a LOW-RES buffer (1 art px = 1 buffer px), then
// blitted onto the on-screen canvas scaled by an integer factor with smoothing off. Layers 0–4 (backdrop,
// floor, walls, furniture) are cached per (floor, time of day); only the dynamic layers redraw per frame.
import type { HumanState, RobotState } from "./characters";
import { DESKS, hasSeat, loungeSpotFor, type FloorId, type Preset } from "./layout";
import type { SceneOptions } from "./OfficeScene";
import { darken, lighten, mixHex, PIXEL_PALETTES, STATUS_DOT, type PixelPalette, type TimeOfDay } from "./palettes";
import { drawHuman, drawQuestion, drawRobot, drawShadow, drawZs, lookFor, type Anim } from "./pixel-characters";
import { fillPoly, isoBox, isoGlow, isoTile, rgba as rgbaHex, wallCol, wallQuad, type Ctx } from "./pixel-draw";
import {
  BENCH_GRID, BUF_H, BUF_W, deskSpot, FLOOR_TILES, GRID_D, GRID_W, isoProject, loungePixelSpot, ROBOT_SPOT, STAIR_GRID,
  WALL_H, WALL_ITEMS, WALL_T, WALLS, type PixelSpot, type TileKind, type WallItem,
} from "./pixel-layout";
import type { OfficeRenderer } from "./types";
import { buildFurniture, crtScreen, deskGeo, drawBulbs, drawChair, drawWallFurniture, sortItems, type DrawItem, type FurnitureSet } from "./pixel-furniture";

export type PixelSceneOptions = SceneOptions;

const P = isoProject;

interface Panel { floor: FloorId; x: number; y: number; s: number; caption?: string }
interface AgentData { state: HumanState; label: string; task: string | null }
/** A character's label anchor on its floor buffer (buffer px), collected while drawing. */
interface Anchor { id: string; floor: FloorId; x: number; feetY: number; top: number; state: string; text: string; name: string; muted: boolean }
interface Hit { id: string; x0: number; y0: number; x1: number; y1: number }

const TICK_MS = 100;               // spec 2.0: 10 fps animation tick
const FOCUS_MS = 2000;             // highlight ring after focus()
const LABEL_MAX = 26;              // spec 2.3.6 truncation
const TV_CYCLE = ["#5B7CFA", "#2DD4BF", "#A78BFA"];
const truncate = (t: string, n = LABEL_MAX) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

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
  private agents = new Map<string, AgentData>();
  private robot: { state: RobotState; label: string } | null = null;
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private anchors: Anchor[] = [];
  private hits: Hit[] = [];
  private hovered: string | null = null;
  private focusId: string | null = null;
  private focusUntil = 0;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private down: { x: number; y: number } | null = null;

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
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointerleave", this.onLeave);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.startTick();
  }

  // ---------------- animation tick (spec 2.0: 10 fps, paused while hidden, off for reduced motion) ----------------
  private startTick() {
    if (this.opts.reducedMotion || this.timer || document.hidden) return;
    this.timer = setInterval(() => { this.tick++; this.render(); }, TICK_MS);
  }
  private stopTick() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private onVisibility = () => { if (document.hidden) this.stopTick(); else { this.startTick(); this.render(); } };

  private makeBuffer() {
    const c = document.createElement("canvas");
    c.width = BUF_W; c.height = BUF_H;
    return c;
  }
  private get pal(): PixelPalette { return PIXEL_PALETTES[this.tod]; }

  // ---------------- public API (OfficeRenderer) ----------------
  setAgentState(id: string, state: HumanState, label: string, task?: string | null) {
    const prev = this.agents.get(id), t = task?.trim() || null;
    if (prev && prev.state === state && prev.label === label && prev.task === t) return;
    this.agents.set(id, { state, label, task: t });
    this.render();
  }
  setRobotState(state: RobotState, label: string) {
    if (this.robot && this.robot.state === state && this.robot.label === label) return;
    this.robot = { state, label };
    this.render();
  }
  preset(p: Preset) { this.current = p; this.layout(); this.render(); }

  /** Switch to the character's floor (like voxel) and ring it for 2 s. */
  focus(id: string) {
    const floor = this.floorOf(id);
    if (floor === null) return;
    const want: Preset = floor === 1 ? "lounge" : "workspace";
    if (want !== this.current) { this.current = want; this.layout(); this.opts.onPresetChange?.(want); }
    this.focusId = id;
    this.focusUntil = performance.now() + FOCUS_MS;
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => { this.focusId = null; this.render(); }, FOCUS_MS);
    this.render();
  }
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
    this.anchors = [];
    this.hits = [];
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
    this.drawLabels();
    this.canvas.style.cursor = this.hovered ? "pointer" : "";
    this.canvas.setAttribute("aria-label", this.summary());
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

    // Layer 2 — floor decals: daylight spill in front of the back-left windows (day only)
    if (p.windowSpill) {
      for (const it of WALL_ITEMS[f]) {
        if (it.kind === "window" && it.wall === "l") fillPoly(ctx, [P(0, it.u0), P(2, it.u0 + 0.5), P(2, it.u1 + 0.5), P(0, it.u1)], p.windowSpill);
      }
    }

    // Layer 3 — back walls with windows, curtains, shelves, whiteboard/TV
    this.drawWalls(ctx, f);
    drawWallFurniture(ctx, p, f);

    // Layer 4 — furniture, depth-sorted back → front (long pieces pre-sliced)
    const set = this.furnitureFor(f);
    for (const it of set.items) it.draw(ctx);
    drawBulbs(ctx, p, set.bulbs);

    // Layer 6 (static part) — night lamp glow: radial gradient on each lit shade, #FFB347 @ 40 % → transparent,
    // radius 3 tiles for desk lamps (floor lamp 2.5, side-table lamps 1.5).
    if (p.lampPool) for (const l of set.lights) isoGlow(ctx, l.x, l.y, l.radius, p.lampPool, 0.4);
  }

  private furnitureFor(f: FloorId) {
    const key = `${f}-${this.tod}`;
    let set = this.furniture.get(key);
    if (!set) { set = buildFurniture(f, this.pal, this.agentHex); this.furniture.set(key, set); }
    return set;
  }

  // ---------------- placement (spec 2.6, voxel parity: idle → lounge, everything else → desk) ----------------
  private spotOf(id: string): PixelSpot | null {
    if (id === this.opts.robot.id) return this.robot ? ROBOT_SPOT : null;
    const a = this.agents.get(id);
    if (!a || !hasSeat(id)) return null; // no data yet → not drawn (never invent a state)
    return a.state === "idle" ? loungePixelSpot(loungeSpotFor(id)) : deskSpot(id);
  }
  private floorOf(id: string): FloorId | null { return this.spotOf(id)?.floor ?? null; }

  // ---------------- dynamic layers (per frame): screens, chairs, characters (spec 2.5 layers 5–6) ----------------
  private drawDynamic(ctx: Ctx, f: FloorId) {
    const p = this.pal, t = this.tick, rm = this.opts.reducedMotion;
    if (f === 0) {
      // Desk CRTs by state (spec 2.4)
      for (const id of Object.keys(DESKS)) {
        const g = deskGeo(id);
        if (!g) continue;
        const st = this.agents.get(id)?.state, pts = crtScreen(g);
        const col = st === "working" ? mixHex(this.agentHex[id] ?? "#6B7285", "#000000", 0.15)
          : st === "reviewing" ? "#F5B83D" : st === "offline" ? "#111111" : p.crtScreenOff;
        const lit = st === "working" || st === "reviewing";
        if (lit && this.tod === "night") {
          // CRT glow: 2 px ring in the screen colour at 35 % + a 1-tile pool on the desk/floor
          isoGlow(ctx, (pts[0].x + pts[2].x) / 2, (pts[0].y + pts[2].y) / 2 + 10, 1, col, 0.18);
          fillPoly(ctx, [{ x: pts[0].x - 2, y: pts[0].y - 2 }, { x: pts[1].x + 2, y: pts[1].y - 2 }, { x: pts[2].x + 2, y: pts[2].y + 2 }, { x: pts[3].x - 2, y: pts[3].y + 2 }], rgbaHex(col, 0.35));
        }
        fillPoly(ctx, pts, col);
        if (lit) {
          fillPoly(ctx, pts.map((q) => ({ x: q.x, y: q.y + 1 })), "rgba(0, 0, 0, 0.25)", 2); // scanlines
          if (st === "working" && (rm || t % 10 < 5)) { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(pts[3].x + 1, pts[3].y - 2, 1, 1); }
        } else if (st !== "offline") {
          ctx.fillStyle = lighten(p.crtScreenOff, 0.35); ctx.fillRect(pts[0].x + 1, pts[0].y + 1, 1, 1); // reflection
        }
      }
      // Claude bench terminal + server rack LEDs (orange/green while running)
      const running = this.robot?.state === "running";
      const bx = BENCH_GRID.gx - 1.25, by = BENCH_GRID.gy - 1.5;
      wallQuad(ctx, "r", by + 0.5, bx + 1.0 + 1 / 16, bx + 1.6 - 1 / 16, 2.45, 2.95, running ? mixHex("#F97316", "#000000", 0.4) : "#0F172A");
      if (running) {
        const c = P(bx + 1.1, by + 0.5, 2.75);
        ctx.fillStyle = "#FDBA74"; ctx.fillRect(c.x, c.y, 1, 1); ctx.fillRect(c.x + 1, c.y + 1, 1, 1);
        if (rm || t % 10 < 5) ctx.fillRect(c.x + 3, c.y + 2, 2, 1);
      }
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 5; j++) {
          const q = P(19.28 + i * 0.14, 0.85, 3.2 - j * 0.55);
          const r = (i * 7 + j * 13 + Math.floor(t / 6) * 5) % 9;
          ctx.fillStyle = !running ? "#374151" : rm ? "#22C55E" : r < 3 ? "#22C55E" : r < 5 ? "#F97316" : "#374151";
          ctx.fillRect(q.x, q.y, 1, 1);
        }
      }
    } else {
      // TV: slow hard-swap colour cycle while someone watches, standby otherwise (spec 2.4)
      const watching = [...this.agents.entries()].some(([id, a]) => a.state === "idle" && hasSeat(id) && loungeSpotFor(id).zone === "tv");
      const col = watching ? TV_CYCLE[rm ? 0 : Math.floor(t / 20) % 3] : "#1E293B";
      if (watching && this.tod === "night") isoGlow(ctx, P(1.6, 3.5).x, P(1.6, 3.5).y, 2, col, 0.15); // TV glow pool on the rug
      wallQuad(ctx, "l", 0, 2.45 + 2 / 16, 4.55 - 2 / 16, 1.95, 3.55, col);
      if (watching) {
        wallQuad(ctx, "l", 0, 3.0, 3.2, 2.4, 2.65, "#FFFFFF");
        wallQuad(ctx, "l", 0, 3.6, 3.9, 2.9, 3.15, "#FFFFFF");
      }
    }

    // Chairs + characters, depth-sorted by feet (gx + gy), tie → smaller gx (spec 2.5 layer 5)
    const items: DrawItem[] = [];
    if (f === 0) {
      for (const id of Object.keys(DESKS)) {
        const sp = deskSpot(id)!;
        const occupied = this.spotOf(id)?.floor === 0;
        const stripe = this.agentHex[id] ?? "#8C94A5";
        items.push({ key: sp.gx + sp.gy - 0.01, top: 0, gx: sp.gx, draw: (c) => drawChair(c, p, sp.gx, sp.gy, occupied, stripe, "seat") });
        items.push({ key: sp.gx + sp.gy + 0.01, top: 0, gx: sp.gx, draw: (c) => drawChair(c, p, sp.gx, sp.gy, occupied, stripe, "rim") });
      }
    }
    for (const c of this.opts.characters) {
      const sp = this.spotOf(c.id);
      if (sp && sp.floor === f) items.push({ key: sp.gx + sp.gy, top: 1, gx: sp.gx, draw: (x) => this.drawAgent(x, c.id, sp) });
    }
    if (f === ROBOT_SPOT.floor && this.robot) {
      const sp = ROBOT_SPOT;
      items.push({ key: sp.gx + sp.gy, top: 1, gx: sp.gx, draw: (x) => this.drawRobotAt(x, sp) });
    }
    items.sort(sortItems).forEach((it) => it.draw(ctx));
  }

  private ringFor(id: string): string | undefined {
    const focused = this.focusId === id && performance.now() < this.focusUntil;
    if (this.hovered === id || (focused && (this.opts.reducedMotion || Math.floor(this.tick / 3) % 2 === 0))) {
      return id === this.opts.robot.id ? this.opts.robot.hex : this.agentHex[id];
    }
    return undefined;
  }

  private drawAgent(ctx: Ctx, id: string, sp: PixelSpot) {
    const a = this.agents.get(id)!, rm = this.opts.reducedMotion, t = this.tick;
    const ident = this.opts.characters.find((c) => c.id === id)!;
    const floorPt = P(sp.gx, sp.gy, 0), feet = P(sp.gx, sp.gy, sp.seatH);
    if (sp.pose !== "lie") drawShadow(ctx, floorPt.x, floorPt.y, this.pal.agentShadow, this.ringFor(id));
    const anim: Anim = {
      typing: !rm && a.state === "working",
      tick: t,
      bob: !rm && a.state === "idle" && sp.pose !== "lie" && Math.floor(t / 10) % 2 === 1 ? 1 : 0,
      scanHead: !rm && a.state === "reviewing" && Math.floor(t / 15) % 2 === 1 ? 1 : 0,
    };
    const top = drawHuman(ctx, lookFor(id, ident.hex), feet.x, feet.y, sp.pose, sp.facing, anim, a.state === "offline");
    if (sp.pose === "lie") {
      if (this.ringFor(id)) drawShadow(ctx, feet.x, feet.y + 2, "rgba(0,0,0,0)", this.ringFor(id));
      if (!rm) drawZs(ctx, feet.x + 6, top, t, this.pal.zText);
    }
    if (a.state === "unknown") drawQuestion(ctx, feet.x, top);
    // Label text: activity text from the API if any, else the state label (+ lounge activity, like voxel tags)
    const zone = a.state === "idle" ? loungeSpotFor(id).activity : null;
    const text = a.task ?? (zone ? `${a.label} · ${zone}` : a.label);
    this.anchors.push({ id, floor: sp.floor, x: feet.x, feetY: floorPt.y, top: a.state === "unknown" ? top - 10 : top, state: a.state, text, name: ident.shortName, muted: a.state === "offline" || (a.state === "idle" && !a.task) });
  }

  private drawRobotAt(ctx: Ctx, sp: PixelSpot) {
    const r = this.robot!, running = r.state === "running";
    const pt = P(sp.gx, sp.gy, 0);
    drawShadow(ctx, pt.x, pt.y, this.pal.agentShadow, this.ringFor(this.opts.robot.id));
    const top = drawRobot(ctx, pt.x, pt.y, running, this.tick, STATUS_DOT[r.state] ?? "#6B7285", this.opts.reducedMotion);
    if (r.state === "unknown") drawQuestion(ctx, pt.x, top);
    this.anchors.push({ id: this.opts.robot.id, floor: sp.floor, x: pt.x, feetY: pt.y, top: r.state === "unknown" ? top - 10 : top, state: r.state, text: r.label, name: "Claude Code CLI", muted: !running });
  }

  // ---------------- labels (spec 2.3.6) — drawn on the view canvas at display resolution ----------------
  private drawLabels() {
    const { ctx } = this, d = this.dpr;
    interface Pill { a: Anchor; vx: number; vy: number; compact: boolean; w: number; text: string; y: number }
    const pills: Pill[] = [];
    ctx.font = `600 ${11 * d}px Inter, system-ui, sans-serif`;
    for (const a of this.anchors) {
      const panel = this.panels.find((p) => p.floor === a.floor);
      if (!panel) continue;
      const vx = panel.x + a.x * panel.s, vy = panel.y + a.top * panel.s - 8 * d;
      // Hit box: sprite rect + 4 px padding (view px)
      this.hits.push({ id: a.id, x0: vx - 6 * panel.s - 4 * d, x1: vx + 6 * panel.s + 4 * d, y0: vy, y1: panel.y + a.feetY * panel.s + 4 * d });
      const hover = this.hovered === a.id;
      const compact = panel.s / d < 1.5 && !hover;   // small scale (Overview/mobile): status dot only
      const text = hover ? `${a.name} · ${a.text}` : truncate(a.text);
      const w = compact ? 0 : Math.ceil(ctx.measureText(text).width) + (8 + 6 + 6 + 8) * d;
      pills.push({ a, vx, vy, compact, w, text, y: vy });
    }
    // Collision: by y; an overlapping pill moves up 22 px (max 2 steps) and gets a leader line
    pills.sort((p, q) => p.vy - q.vy);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const H = 20 * d;
    for (const pl of pills) {
      if (pl.compact) continue;
      for (let step = 0; step <= 2; step++) {
        const y = pl.vy - step * 22 * d;
        const box = { x0: pl.vx - pl.w / 2, x1: pl.vx + pl.w / 2, y0: y - 4 * d - H, y1: y };
        const clash = placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
        if (!clash || step === 2) { pl.y = y; placed.push(box); break; }
      }
    }
    // Hovered pill last so it is on top
    pills.sort((p, q) => Number(this.hovered === p.a.id) - Number(this.hovered === q.a.id));
    for (const pl of pills) {
      const dot = STATUS_DOT[pl.a.state] ?? "#6B7285";
      if (pl.compact) {
        ctx.beginPath(); ctx.arc(pl.vx, pl.vy - 3 * d, 4 * d, 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill();
        ctx.beginPath(); ctx.arc(pl.vx, pl.vy - 3 * d, 3 * d, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill();
        continue;
      }
      this.drawPill(pl.vx, pl.y, pl.w, pl.text, dot, pl.a.muted && this.hovered !== pl.a.id, pl.y !== pl.vy ? pl.vy : null);
      this.hits.push({ id: pl.a.id, x0: pl.vx - pl.w / 2, x1: pl.vx + pl.w / 2, y0: pl.y - 4 * d - H, y1: pl.y });
    }
  }

  /** White pill with a hard 1-step shadow, tail, status dot and dark text. (x, bottomY) = tail tip. */
  private drawPill(x: number, bottom: number, w: number, text: string, dot: string, muted: boolean, leaderTo: number | null) {
    const { ctx } = this, d = this.dpr, H = 20 * d, r = 10 * d;
    const x0 = Math.round(x - w / 2), y0 = Math.round(bottom - 4 * d - H);
    ctx.save();
    ctx.globalAlpha = muted ? 0.7 : this.tod === "night" ? 0.96 : 1;
    if (leaderTo !== null) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(Math.round(x), Math.round(bottom), Math.max(1, Math.round(d)), Math.round(leaderTo - bottom));
    }
    const pill = (dy: number) => { ctx.beginPath(); roundRect(ctx, x0, y0 + dy, w, H, r); };
    pill(2 * d); ctx.fillStyle = "rgba(0, 0, 0, 0.18)"; ctx.fill();          // hard drop shadow 0 2px
    pill(0); ctx.fillStyle = "#FFFFFF"; ctx.fill();
    if (this.tod === "day") { ctx.lineWidth = Math.max(1, d); ctx.strokeStyle = "rgba(31, 41, 55, 0.18)"; ctx.stroke(); }
    ctx.beginPath();                                                            // tail 6 × 4
    ctx.moveTo(x - 3 * d, y0 + H - 0.5); ctx.lineTo(x + 3 * d, y0 + H - 0.5); ctx.lineTo(x, y0 + H + 4 * d); ctx.closePath();
    ctx.fillStyle = "#FFFFFF"; ctx.fill();
    ctx.beginPath(); ctx.arc(x0 + 11 * d, y0 + H / 2, 3 * d, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill();
    ctx.fillStyle = "#1F2937"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `600 ${11 * d}px Inter, system-ui, sans-serif`;
    ctx.fillText(text, x0 + 20 * d, y0 + H / 2 + 0.5 * d);
    ctx.restore();
  }

  private summary() {
    const where = this.current === "overview" ? "both floors" : this.current === "lounge" ? "Floor 1 lounge" : "Floor 0 workspace";
    const who = this.anchors.map((a) => `${a.name}: ${a.text}`).join("; ");
    return `Pixel office, ${where}${who ? ` — ${who}` : ""}`;
  }

  // ---------------- picking (click a character → drawer, like voxel) ----------------
  private hitAt(e: PointerEvent): string | null {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / (r.width || 1)) * this.canvas.width, y = ((e.clientY - r.top) / (r.height || 1)) * this.canvas.height;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h.id;
    }
    return null;
  }
  private onMove = (e: PointerEvent) => {
    const id = this.hitAt(e);
    if (id !== this.hovered) { this.hovered = id; this.render(); }
  };
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    if (!this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = null;
    if (moved > 5) return;
    const id = this.hitAt(e);
    if (id) this.opts.onSelect(id);
  };
  private onLeave = () => { if (this.hovered) { this.hovered = null; this.render(); } };

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
    this.stopTick();
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.ro.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.statics.clear();
    this.furniture.clear();
    this.canvas.remove();
  }
}

/** Rounded-rect path (ctx.roundRect where available). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
