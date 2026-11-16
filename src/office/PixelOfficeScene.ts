// "Pixel Office" renderer (pixel-office-design-spec.md section 2, tech plan 3): Canvas 2D isometric
// pixel art. Plain class, not a React component; same imperative API as OfficeScene so Office.tsx
// can hold either one. No Three.js import at runtime (type-only imports).
import type { HumanState, RobotState } from "./characters";
import type { Preset } from "./layout";
import type { SceneOptions } from "./OfficeScene";
import { PIXEL_PALETTES, type TimeOfDay } from "./palettes";
import type { OfficeRenderer } from "./types";

export type PixelSceneOptions = SceneOptions;

export class PixelOfficeScene implements OfficeRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private tod: TimeOfDay = "day";
  private current: Preset = "overview";
  private firstFrame = false;

  constructor(private host: HTMLElement, private opts: PixelSceneOptions) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pixel-office";
    this.canvas.style.imageRendering = "pixelated";
    // Firefox spelling; the later assignment wins only where "pixelated" is unsupported.
    if (!CSS.supports?.("image-rendering", "pixelated")) this.canvas.style.imageRendering = "crisp-edges";
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available in this browser");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  setAgentState(_id: string, _state: HumanState, _label: string, _task?: string | null) {}
  setRobotState(_state: RobotState, _label: string) {}
  preset(p: Preset) { this.current = p; this.draw(); }
  focus(_id: string) {}
  setTimeOfDay(tod: TimeOfDay) { this.tod = tod; this.draw(); }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.canvas.width = w; this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false; // reset by a canvas resize
    this.draw();
  }

  private draw() {
    const { ctx, canvas } = this;
    ctx.fillStyle = PIXEL_PALETTES[this.tod].floorA;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1F2937";
    ctx.font = "600 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Pixel Office — ${this.current === "lounge" ? "Floor 1" : "Floor 0"}`, canvas.width / 2, canvas.height / 2);
    if (!this.firstFrame) { this.firstFrame = true; this.opts.onFirstFrame?.(); }
  }

  dispose() {
    this.ro.disconnect();
    this.canvas.remove();
  }
}
