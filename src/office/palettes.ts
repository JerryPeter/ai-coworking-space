// Day/Night palettes for both office renderers (pixel-office-design-spec.md section 3, tech plan 4).
// Pure data, no Three.js import: the Pixel renderer pulls this in without dragging WebGL code along.
import type { LightState, Preset } from "./layout";

export type TimeOfDay = "day" | "night";
export type OfficeMode = "voxel" | "pixel";

// ---------------- Voxel 3D (spec 3.1) ----------------

/** Base light state for a time of day, before the per-preset modifier. */
export interface VoxelBase {
  ambient: string; ambientI: number;
  sun: string; sunI: number; sunPos: [number, number, number];
  balcony: string; balconyI: number;
  background: string;
}

export const VOXEL_BASE: Record<TimeOfDay, VoxelBase> = {
  // Day: brief values (background kept darker than Susi's #BFD6EA sky on purpose: "still a 3D scene").
  day: { ambient: "#FFFFFF", ambientI: 0.9, sun: "#FFF5E0", sunI: 1.4, sunPos: [20, 30, 15], balcony: "#FFA040", balconyI: 0, background: "#1A2030" },
  // Night: Susi's corrected ambient (#8A93B8 instead of #1A1F2E, which renders side faces black).
  night: { ambient: "#8A93B8", ambientI: 0.55, sun: "#A0B4D0", sunI: 0.7, sunPos: [-15, 20, 10], balcony: "#FFA040", balconyI: 0.6, background: "#0B0D12" },
};

/** Spec 3.1 preset modifier: multiply the base intensity, blend the colour 15 % toward the preset tint.
 *  The tints are the existing LIGHT_STATES ambient colours (layout.ts), so floor moods still read. */
export const PRESET_MOD: Record<Preset, { k: number; tint: string | null }> = {
  workspace: { k: 1.05, tint: "#FFF4E6" },
  lounge: { k: 0.92, tint: "#E3EAFF" },
  overview: { k: 1.0, tint: null }, // identity: Overview shows the exact day/night base values
};

export interface VoxelLightState extends LightState {
  sunPos: [number, number, number];
  balcony: string;
  background: string;
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** Linear blend of two hex colours (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
/** Darken toward black by `amt` (0..1) — spec 2.1 face shading. */
export const darken = (h: string, amt: number) => mixHex(h, "#000000", amt);
export const lighten = (h: string, amt: number) => mixHex(h, "#FFFFFF", amt);

/** Light target = f(time of day, preset). Composes with the preset tween so a floor click never resets TOD. */
export function voxelLights(tod: TimeOfDay, preset: Preset): VoxelLightState {
  const b = VOXEL_BASE[tod], m = PRESET_MOD[preset];
  return {
    ambient: m.tint ? mixHex(b.ambient, m.tint, 0.15) : b.ambient, ambientI: b.ambientI * m.k,
    sun: m.tint ? mixHex(b.sun, m.tint, 0.15) : b.sun, sunI: b.sunI * m.k, sunPos: b.sunPos,
    balcony: b.balcony, balconyI: b.balconyI * m.k,
    background: b.background,
  };
}

// ---------------- Pixel Office (spec 3.2) ----------------

export interface PixelPalette {
  backdrop: string; sky: string;
  floorA: string; floorB: string; grout: string; slab: string;
  wall: string; wallShade: string; wallCap: string; wallSkirt: string; outline: string;
  windowGlass: string; windowShine: string | null; moonStrip: string | null; windowFrame: string;
  curtain: string; curtainShade: string; windowSpill: string | null;
  lampShade: string; lampRim: string | null; lampPool: string | null;
  bulb: string; bulbHalo: string | null;
  deskTop: string; deskSide: string; deskTrim: string;
  crtCase: string; crtScreenOff: string; lampMetal: string;
  chair: string; chairBase: string;
  shelfWood: string; shelfEdge: string; bookSpines: string[];
  sofa: string; sofaBack: string; sofaSeam: string; napCushion: string; tvCabinet: string;
  rugLounge: string; rugOpen: string; carpetMeeting: string; benchMat: string; napFloor: string;
  partition: string; partitionCap: string; whiteboard: string;
  deckA: string; deckB: string; railWood: string; railPost: string; stairTop: string; stairSide: string;
  agentShadow: string; zText: string;
}

export const PIXEL_PALETTES: Record<TimeOfDay, PixelPalette> = {
  day: {
    backdrop: "#A89070", sky: "#BFE0F5",
    floorA: "#E8D9B0", floorB: "#DDD0A5", grout: "#D2C394", slab: "#B89A6A",
    wall: "#C4A882", wallShade: "#B39672", wallCap: "#D8C29E", wallSkirt: "#8B6A45", outline: "#5A3E22",
    windowGlass: "#E8F4FF", windowShine: "#FFFFFF", moonStrip: null, windowFrame: "#8B6A45",
    curtain: "#C8553D", curtainShade: "#A8432F", windowSpill: "rgba(255, 246, 216, 0.30)",
    lampShade: "#D4A843", lampRim: null, lampPool: null,
    bulb: "#C9B27A", bulbHalo: null,
    deskTop: "#A0714F", deskSide: "#8B5E3C", deskTrim: "#6E4A2E",
    crtCase: "#B9B2A3", crtScreenOff: "#3A4A40", lampMetal: "#5E5A55",
    chair: "#4A3F3A", chairBase: "#2F2926",
    shelfWood: "#6B4226", shelfEdge: "#82552F",
    bookSpines: ["#C8553D", "#E0A33A", "#4F8A5B", "#3E6E9E", "#8E5BA6", "#D9C7A0", "#B23A48", "#2F6F6A"],
    sofa: "#7E9A8C", sofaBack: "#6A8578", sofaSeam: "#5A7266", napCushion: "#C9B79C", tvCabinet: "#5A3E2B",
    rugLounge: "#B5654B", rugOpen: "#9DA77F", carpetMeeting: "#8FA3B5", benchMat: "#B7A88C", napFloor: "#CDB991",
    partition: "#B89A6A", partitionCap: "#D8C29E", whiteboard: "#F4F1E8",
    deckA: "#B9875A", deckB: "#A6764C", railWood: "#8B5E3C", railPost: "#5E5A55", stairTop: "#C9A877", stairSide: "#A6865A",
    agentShadow: "rgba(70, 45, 20, 0.28)", zText: "#E8EAF0",
  },
  night: {
    backdrop: "#3A2810", sky: "#141A2C",
    floorA: "#9C7A42", floorB: "#876A38", grout: "#7A5F31", slab: "#5A4220",
    wall: "#6B4E2A", wallShade: "#5C4224", wallCap: "#7E5E36", wallSkirt: "#4A3418", outline: "#24180A",
    windowGlass: "#1A2035", windowShine: null, moonStrip: "#3D5A80", windowFrame: "#4A3418",
    curtain: "#7E3426", curtainShade: "#5E2519", windowSpill: null,
    lampShade: "#FFB347", lampRim: "#FFF1C1", lampPool: "#FFB347",
    bulb: "#FFD27A", bulbHalo: "rgba(255, 179, 71, 0.40)",
    deskTop: "#7A5230", deskSide: "#6B4226", deskTrim: "#4E3119",
    crtCase: "#7D776C", crtScreenOff: "#151B18", lampMetal: "#3E3A36",
    chair: "#2E2724", chairBase: "#1C1816",
    shelfWood: "#4A2E14", shelfEdge: "#5C3A1B",
    bookSpines: ["#8E3B2A", "#A07428", "#37613F", "#2C4E70", "#643F75", "#9A8C6F", "#7E2833", "#21504C"],
    sofa: "#4E6258", sofaBack: "#41524A", sofaSeam: "#34433C", napCushion: "#7E7262", tvCabinet: "#3A281B",
    rugLounge: "#7A3F2E", rugOpen: "#5E6649", carpetMeeting: "#4E5C6B", benchMat: "#5E523E", napFloor: "#6E5730",
    partition: "#5E4526", partitionCap: "#7E5E36", whiteboard: "#B9B4A8",
    deckA: "#6E4E30", deckB: "#5E4128", railWood: "#5C3A1F", railPost: "#3E3A36", stairTop: "#7A5C33", stairSide: "#5E4526",
    agentShadow: "rgba(10, 6, 2, 0.45)", zText: "#FFFFFF",
  },
};

/** Status colours (copied from OfficeScene STATUS_HEX + spec 2.3.6; not imported, so no Three.js). */
export const STATUS_DOT: Record<string, string> = {
  working: "#22C55E", reviewing: "#F5B83D", idle: "#8394AE", online: "#22C55E",
  offline: "#6B7285", unknown: "#6B7285", running: "#22C55E", not_running: "#8394AE",
};

// ---------------- persistence (tech plan 4.3) ----------------
export const TOD_KEY = "mc.office.timeOfDay";
export const MODE_KEY = "mc.office.mode";
export function readTod(): TimeOfDay {
  try { return localStorage.getItem(TOD_KEY) === "night" ? "night" : "day"; } catch { return "day"; }
}
export function readMode(): OfficeMode {
  try { return localStorage.getItem(MODE_KEY) === "pixel" ? "pixel" : "voxel"; } catch { return "voxel"; }
}
export function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode / quota: ignore */ }
}
