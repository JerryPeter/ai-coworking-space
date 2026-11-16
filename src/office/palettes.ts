// Day/Night palettes for the 3D office renderer. Pure data, no Three.js import.
import type { LightState, Preset } from "./layout";

export type TimeOfDay = "day" | "night";

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

// ---------------- persistence (tech plan 4.3) ----------------
export const TOD_KEY = "mc.office.timeOfDay";
export function readTod(): TimeOfDay {
  try { return localStorage.getItem(TOD_KEY) === "night" ? "night" : "day"; } catch { return "day"; }
}
export function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode / quota: ignore */ }
}
