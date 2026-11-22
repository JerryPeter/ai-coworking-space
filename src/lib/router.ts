// Minimal hash router: "#/<view>?a=b". Hash routing because the FastAPI static mount only
// serves index.html at "/", so deep paths like /agents would 404 on reload.
import { useSyncExternalStore } from "react";

export type ViewId = "dashboard" | "agents" | "tasks" | "calendar" | "activity" | "memory" | "office" | "workflow";
export const VIEW_IDS: ViewId[] = ["dashboard", "agents", "tasks", "calendar", "activity", "memory", "office", "workflow"];

export interface Route { view: ViewId; params: URLSearchParams }

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const view = (VIEW_IDS as string[]).includes(path) ? (path as ViewId) : "dashboard";
  return { view, params: new URLSearchParams(query) };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

export function href(view: ViewId, params?: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v != null && v !== "") q.set(k, v); });
  const s = q.toString();
  return `#/${view}${s ? `?${s}` : ""}`;
}

export function navigate(view: ViewId, params?: Record<string, string | null | undefined>, replace = false) {
  const h = href(view, params);
  if (replace) {
    history.replaceState(null, "", h);
    current = parse();
    listeners.forEach((l) => l());
  } else {
    window.location.hash = h;
  }
}

/** Set/clear query params on the current view (pushes history so Back closes drawers). */
export function setParams(patch: Record<string, string | null | undefined>, replace = false) {
  const p = new URLSearchParams(current.params);
  Object.entries(patch).forEach(([k, v]) => { if (v == null || v === "") p.delete(k); else p.set(k, v); });
  const obj: Record<string, string> = {};
  p.forEach((v, k) => { obj[k] = v; });
  navigate(current.view, obj, replace);
}
