// Right-side detail drawer (spec 5.10): scrim, Esc closes, focus trap, focus restore,
// 200ms slide-in / 160ms ease-in close.
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement | null>, initial: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    initial.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open, ref, initial]);
}

export function Drawer({
  open, onClose, title, subtitle, avatar, tabs, tab, onTab, children, label,
}: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; avatar?: ReactNode;
  tabs?: { id: string; label: string }[]; tab?: string; onTab?: (id: string) => void; children: ReactNode; label?: string;
}) {
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); }
    else if (mounted) {
      setClosing(true);
      const t = window.setTimeout(() => { setMounted(false); setClosing(false); }, 160);
      return () => window.clearTimeout(t);
    }
  }, [open, mounted]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
  useFocusTrap(open && mounted, panel, closeBtn);

  if (!mounted) return null;
  return createPortal(
    <>
      <div className={`scrim${closing ? " closing" : ""}`} onClick={close} aria-hidden="true" />
      <div ref={panel} className={`drawer${closing ? " closing" : ""}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : "Details")}>
        <div className="drawer-head">
          {avatar}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title truncate">{title}</div>
            {subtitle && <div className="drawer-sub truncate">{subtitle}</div>}
          </div>
          <button ref={closeBtn} className="icon-btn" aria-label="Close" onClick={close}><X size={18} /></button>
        </div>
        {tabs && (
          <div className="drawer-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onTab?.(t.id)}>{t.label}</button>
            ))}
          </div>
        )}
        <div className="drawer-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  useFocusTrap(open, panel, closeBtn);
  if (!open) return null;
  return createPortal(
    <>
      <div className="scrim modal-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="modal" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="drawer-title" style={{ flex: 1 }}>{title}</div>
          <button ref={closeBtn} className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
