// Pixel Office characters (pixel-office-design-spec.md 2.3). 12 × 20 buffer-px sprites drawn with fillRect,
// origin = feet centre. Identity colours are the same day and night; only offline dims them (voxel parity).
import { darken, mixHex } from "./palettes";
import { pixelEllipse, type Ctx } from "./pixel-draw";

export type SpriteFacing = "front" | "back";
export type SpritePose = "stand" | "sit" | "lie";

export interface Look {
  skin: string; hair: string; body: string; pants: string;
  kind: "hawa" | "pratama" | "bagas" | "susi" | "generic";
}

/** Spec 2.3.3 character table (body = agent colour from theme/agents.ts, passed in). */
export function lookFor(id: string, body: string): Look {
  switch (id) {
    case "default": return { skin: "#E0AC85", hair: "#3B2219", body, pants: "#4B3F72", kind: "hawa" };
    case "pratama_cto": return { skin: "#C68B59", hair: "#1A1A1A", body, pants: "#1E3A5F", kind: "pratama" };
    case "bagas_dev_lead": return { skin: "#8D5A3B", hair: "#1F1410", body, pants: "#2F4A6D", kind: "bagas" };
    case "susi_uiux": return { skin: "#F1C27D", hair: "#6B3A2A", body, pants: "#5B2245", kind: "susi" };
    default: return { skin: "#D4A373", hair: "#3A2A1E", body, pants: "#3A3F4B", kind: "generic" };
  }
}

/** Offline: desaturate toward a dim grey (voxel uses a flat 0.4 grey; this keeps a hint of identity). */
export function dim(c: string): string {
  const n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 0.55 + 0.4 * 255 * 0.45);
  const grey = "#" + [l, l, l].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("");
  return mixHex(grey, c, 0.15);
}

export interface Anim { typing: boolean; tick: number; bob: number; scanHead: number }

/** Draw a human. Returns the sprite's top y (buffer px) for label anchoring. */
export function drawHuman(ctx: Ctx, look: Look, fx: number, fy: number, pose: SpritePose, facing: SpriteFacing, a: Anim, offline: boolean): number {
  const T = offline ? dim : (c: string) => c;
  const skin = T(look.skin), hair = T(look.hair), body = T(look.body), pants = T(look.pants);
  const arm = darken(body, 0.18), shoe = T("#2B2630"), eye = "#1F1A17";

  if (pose === "lie") return drawLying(ctx, look, fx, fy, T);

  const seated = pose === "sit";
  const h = seated ? 19 : 20;
  const ox = Math.round(fx - 6), oy = Math.round(fy - h - a.bob);
  const R = (x: number, y: number, w: number, hh: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, w, hh); };
  const hx = a.scanHead; // reviewing: head scans 1 px left/right

  // Legs / shoes
  if (seated) {
    R(2, 15, 8, 2, pants); R(2, 17, 3, 2, pants); R(7, 17, 3, 2, pants);
    R(9, 15, 1, 4, darken(pants, 0.18));
  } else if (look.kind === "susi") {
    R(3, 15, 6, 2, pants); R(3, 17, 2, 2, skin); R(7, 17, 2, 2, skin); R(3, 19, 2, 1, shoe); R(7, 19, 2, 1, shoe);
  } else {
    R(3, 15, 6, 4, pants); R(6, 15, 1, 4, darken(pants, 0.2)); R(8, 15, 1, 4, darken(pants, 0.18));
    R(3, 19, 3, 1, shoe); R(6, 19, 3, 1, shoe);
  }
  // Torso + arms + hands (typing: hands bob 1 px on alternate ticks)
  R(1, 9, 10, 6, body); R(10, 9, 1, 6, darken(body, 0.18));
  const handUp = a.typing && a.tick % 2 === 0 ? 1 : 0;
  R(0, 9, 1, 5 - handUp, arm); R(11, 9, 1, 5 - handUp, arm);
  R(0, 14 - handUp, 1, 1, skin); R(11, 14 - handUp, 1, 1, skin);

  // Head
  const front = facing === "front";
  R(3 + hx, 3, 6, 6, front ? skin : hair);
  if (front) {
    R(8 + hx, 3, 1, 6, darken(skin, 0.18));
    R(4 + hx, 5, 1, 1, eye); R(7 + hx, 5, 1, 1, eye);
    R(5 + hx, 7, 2, 1, darken(skin, 0.25));
  } else {
    R(4 + hx, 8, 4, 1, skin); // neck
  }
  R(2 + hx, 0, 8, 3, hair);
  R(2 + hx, 3, 1, 3, hair); R(9 + hx, 3, 1, 3, hair);

  // Identity accessories (spec 2.3.3)
  switch (look.kind) {
    case "hawa":
      R(1 + hx, 3, 2, 9, hair); R(9 + hx, 3, 2, 9, hair);       // long hair to row 11
      R(2 + hx, 1, 8, 1, T("#E8EAF0"));                          // headset band
      R(1 + hx, 6, 2, 2, T("#E8EAF0"));                          // mic
      if (front) R(3, 10, 2, 2, T("#F5C542"));                   // gold lead pin
      break;
    case "pratama":
      if (front) { R(3 + hx, 5, 6, 1, T("#0F172A")); R(4 + hx, 5, 1, 1, T("#7DD3FC")); R(7 + hx, 5, 1, 1, T("#7DD3FC")); }
      R(2 + hx, 3, 1, 3, front ? skin : hair); R(9 + hx, 3, 1, 3, front ? darken(skin, 0.18) : hair); // short hair: no sides
      break;
    case "bagas":
      R(1 + hx, 0, 10, 3, T("#4D7C0F")); R(1 + hx, 2, 10, 1, T("#3F6212"));     // beanie + fold
      R(1 + hx, 4, 2, 3, T("#27272A")); R(9 + hx, 4, 2, 3, T("#27272A"));       // headphones
      break;
    case "susi":
      R(2 + hx, 3, 1, 6, hair); R(9 + hx, 3, 1, 6, hair);                      // bob to row 8
      R(1 + hx, 0, 9, 2, T("#DB2777")); R(6 + hx, -1, 1, 1, T("#DB2777"));     // beret + tip
      break;
    default:
      break;
  }
  return oy - (look.kind === "susi" ? 1 : 0);
}

/** Lying pose (nap): front sprite rotated 90°, head toward the back (screen right). */
function drawLying(ctx: Ctx, look: Look, fx: number, fy: number, T: (c: string) => string): number {
  const ox = Math.round(fx - 10), oy = Math.round(fy - 9);
  const R = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, w, h); };
  // x runs feet (0) → head (19); y is the body's width (0..8)
  R(0, 3, 1, 3, T("#2B2630"));                 // shoes
  R(1, 3, 4, 3, T(look.pants));                // legs
  R(5, 2, 6, 5, T(look.body));                 // torso
  R(5, 1, 6, 1, darken(T(look.body), 0.18)); R(5, 7, 6, 1, darken(T(look.body), 0.18)); // arms
  R(11, 2, 6, 5, T(look.skin));                // head
  R(12, 3, 1, 1, "#1F1A17"); R(12, 5, 1, 1, "#1F1A17"); // closed eyes
  R(17, 2, 2, 5, T(look.kind === "bagas" ? "#4D7C0F" : look.kind === "susi" ? "#DB2777" : look.hair));
  if (look.kind === "hawa" || look.kind === "susi") R(15, 1, 3, 7, T(look.hair));
  return oy - 4;
}

/** Floating "z" pixels above a sleeper, rising 1 px per tick, 3 staggered. */
export function drawZs(ctx: Ctx, x: number, y: number, tick: number, color: string) {
  for (let i = 0; i < 3; i++) {
    const t = (tick + i * 6) % 18;
    const zx = Math.round(x + 4 + i * 3), zy = Math.round(y - t);
    ctx.globalAlpha = 1 - t / 18;
    ctx.fillStyle = color;
    ctx.fillRect(zx, zy, 3, 1); ctx.fillRect(zx + 1, zy + 1, 1, 1); ctx.fillRect(zx, zy + 2, 3, 1);
  }
  ctx.globalAlpha = 1;
}

/** "?" over an agent whose state is unknown (voxel shows a question box). */
export function drawQuestion(ctx: Ctx, x: number, top: number) {
  const ox = Math.round(x - 2), oy = Math.round(top - 9);
  ctx.fillStyle = "#1F2937"; ctx.fillRect(ox - 1, oy - 1, 7, 9);
  ctx.fillStyle = "#F5C542";
  ctx.fillRect(ox, oy, 5, 1); ctx.fillRect(ox + 4, oy + 1, 1, 2); ctx.fillRect(ox + 2, oy + 3, 2, 1);
  ctx.fillRect(ox + 2, oy + 4, 1, 1); ctx.fillRect(ox + 2, oy + 6, 1, 1); ctx.fillRect(ox, oy + 1, 1, 1);
}

/** Claude Code CLI robot (spec 2.3.4). Returns the top y. */
export function drawRobot(ctx: Ctx, fx: number, fy: number, running: boolean, tick: number, statusHex: string, reducedMotion: boolean): number {
  const bob = running && !reducedMotion && Math.floor(tick / 4) % 2 === 0 ? 1 : 0;
  const ox = Math.round(fx - 6), oy = Math.round(fy - 20 - bob);
  const T = running ? (c: string) => c : (c: string) => mixHex(dim(c), c, 0.35); // idle: dim/grey
  const R = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = T(c); ctx.fillRect(ox + x, oy + y, w, h); };
  // antenna (tip blinks on 1 s / off 0.3 s while working)
  const tipOn = !running || reducedMotion || tick % 13 < 10;
  if (tipOn) R(5, 0, 2, 1, "#F97316");
  R(5, 1, 2, 1, "#9CA3AF"); R(5, 2, 1, 1, "#9CA3AF");
  // terminal head + screen with ">_" (cursor blinks while working)
  R(1, 3, 10, 7, "#2B2F3A"); R(1, 3, 10, 1, "#4B5563");
  R(2, 4, 8, 5, "#0F172A");
  const glyph = running ? "#F97316" : "#9A6A4A";
  R(3, 5, 1, 1, glyph); R(4, 6, 1, 1, glyph); R(3, 7, 1, 1, glyph);
  const cursorOn = !running || reducedMotion || Math.floor(tick / 5) % 2 === 0;
  if (cursorOn) R(5, 7, 3, 1, glyph);
  // body + chest panel with 2 status LEDs
  R(2, 10, 8, 6, "#F97316"); R(4, 11, 4, 3, "#EA580C");
  ctx.fillStyle = statusHex; ctx.fillRect(ox + 5, oy + 12, 1, 1); ctx.fillRect(ox + 6, oy + 12, 1, 1);
  // arms + claws
  R(0, 11, 2, 3, "#4B5563"); R(10, 11, 2, 3, "#4B5563"); R(0, 14, 1, 1, "#9CA3AF"); R(11, 14, 1, 1, "#9CA3AF");
  // treads
  R(1, 16, 10, 4, "#374151");
  for (const c of [2, 5, 8]) R(c, 18, 1, 1, "#6B7280");
  return oy;
}

export function drawShadow(ctx: Ctx, x: number, y: number, color: string, ring?: string) {
  if (ring) pixelEllipse(ctx, x, y, 9, 3, ring);
  pixelEllipse(ctx, x, y, 7, 2, color);
}
