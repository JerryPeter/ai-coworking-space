// Lets a view put a subtitle/count next to the page title in the top bar (spec 4.4).
import { useEffect, useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

export function useSubtitleValue(): string | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

export function usePageSubtitle(text: string | null | undefined) {
  useEffect(() => {
    current = text ?? null;
    listeners.forEach((l) => l());
    return () => { current = null; listeners.forEach((l) => l()); };
  }, [text]);
}
