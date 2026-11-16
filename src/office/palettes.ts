// Office day/night preference (persisted). Pure data, no Three.js import.
export type TimeOfDay = "day" | "night";

export const TOD_KEY = "mc.office.timeOfDay";
export function readTod(): TimeOfDay {
  try { return localStorage.getItem(TOD_KEY) === "night" ? "night" : "day"; } catch { return "day"; }
}
export function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode / quota: ignore */ }
}
