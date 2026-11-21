// Office day/night preference (persisted). Pure data, no Three.js import.
export type TimeOfDay = "day" | "night";

export const TOD_KEY = "mc.office.timeOfDay";
export function readTod(): TimeOfDay {
  try { return localStorage.getItem(TOD_KEY) === "night" ? "night" : "day"; } catch { return "day"; }
}
export function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode / quota: ignore */ }
}

// Floor selector (Lantai 1/2/3, Atap, Semua, Pisah lantai), persisted.
export type FloorPref = 1 | 2 | 3 | 4 | "all" | "x";
export const MODE_KEY = "mc.office.floorMode";
export function readMode(): FloorPref {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "all" || v === "x") return v;
    const n = Number(v);
    return n === 1 || n === 2 || n === 3 || n === 4 ? n : "all";
  } catch { return "all"; }
}

// Town Hall visual settings (style + the reference's "Pengaturan visual" popup), persisted as one JSON blob.
export interface VisualPrefs {
  style: 1 | 2 | 3;
  weather: "clear" | "rain" | "snow";
  scope: "all" | "building";
  clouds: boolean;
  low: boolean;
  wood: boolean;
  vendors: boolean;
  labels: boolean;
}
export const VISUAL_KEY = "mc.office.visual";
export const VISUAL_DEFAULTS: VisualPrefs = { style: 1, weather: "clear", scope: "all", clouds: true, low: false, wood: false, vendors: true, labels: true };
export function readVisual(): VisualPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VISUAL_KEY) || "{}") as Partial<VisualPrefs>;
    const out = { ...VISUAL_DEFAULTS, ...v };
    if (![1, 2, 3].includes(out.style)) out.style = 1;
    if (!["clear", "rain", "snow"].includes(out.weather)) out.weather = "clear";
    if (out.scope !== "building") out.scope = "all";
    return out;
  } catch { return { ...VISUAL_DEFAULTS }; }
}
