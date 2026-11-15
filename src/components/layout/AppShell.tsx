// App shell (spec 4.4 + 5.1): fixed sidebar, sticky top bar, scrolling content.
import {
  Activity, Box, Brain, CalendarDays, LayoutDashboard, LogOut, Moon, PanelLeftClose, PanelLeftOpen,
  RefreshCw, SquareKanban, Sun, TriangleExclamationPoint, Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { checkHealth, endpoints, refetchAll, setToken, useApi, useConnection } from "../../api/client";
import { cronHealth } from "../../lib/derive";
import { href, navigate, useRoute, type ViewId } from "../../lib/router";
import { clock, relative, useNow } from "../../lib/time";
import { useTheme } from "../../theme/ThemeProvider";
import { StatusBadge } from "../ui/StatusBadge";

interface NavDef { id: ViewId; label: string; title: string; Icon: ComponentType<{ size?: number; className?: string }>; key: string }
export const NAV: NavDef[] = [
  { id: "dashboard", label: "Dashboard", title: "Dashboard", Icon: LayoutDashboard, key: "d" },
  { id: "agents", label: "Agents", title: "Agents", Icon: Users, key: "a" },
  { id: "tasks", label: "Task Board", title: "Task Board", Icon: SquareKanban, key: "t" },
  { id: "calendar", label: "Calendar", title: "Calendar", Icon: CalendarDays, key: "c" },
  { id: "activity", label: "Activity", title: "Activity", Icon: Activity, key: "v" },
  { id: "memory", label: "Memory", title: "Memory & Knowledge", Icon: Brain, key: "m" },
  { id: "office", label: "3D Office", title: "3D Office", Icon: Box, key: "o" },
];

const POLL_MS = 30_000;
const SIDEBAR_KEY = "mc.sidebar.collapsed";

function useViewportWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function AppShell({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  const { view } = useRoute();
  const { theme, toggle } = useTheme();
  const width = useViewportWidth();
  const narrow = width < 1280;
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; }
  });
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const collapsed = narrow ? !narrowExpanded : userCollapsed;

  const toggleSidebar = () => {
    if (narrow) setNarrowExpanded((v) => !v);
    else setUserCollapsed((v) => {
      try { localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  };
  const toggleRef = useRef(toggleSidebar);
  toggleRef.current = toggleSidebar;

  // Keyboard: "[" toggles the sidebar; "g" then d/a/t/c/v/m/o navigates (spec 8).
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "[") { toggleRef.current(); return; }
      if (e.key === "g") { gAt = Date.now(); return; }
      if (Date.now() - gAt < 1200) {
        const n = NAV.find((x) => x.key === e.key);
        if (n) { navigate(n.id); gAt = 0; }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Health check for the API connection dot (unauthenticated /health).
  useEffect(() => {
    void checkHealth();
    const t = window.setInterval(() => { if (!document.hidden) void checkHealth(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  const conn = useConnection();
  const now = useNow(5_000);
  const agents = useApi(endpoints.agents, POLL_MS);
  const jobs = useApi(endpoints.cronJobs, POLL_MS);
  const kanban = useApi(endpoints.summary, POLL_MS);
  const failing = cronHealth(jobs.data?.jobs)?.failing.length ?? 0;
  const openTasks = (() => {
    const b = kanban.data?.kanban.by_status;
    if (!b) return null;
    return Object.entries(b).filter(([k]) => k !== "done" && k !== "archived").reduce((a, [, v]) => a + v, 0);
  })();

  // Gateway: online when at least one profile's gateway.lock pid is verified alive.
  const gw = agents.data?.agents;
  const gatewayStatus = !gw ? null : gw.some((a) => a.status === "running") ? "online"
    : gw.every((a) => a.status === "stopped") ? "offline" : "unknown";

  const age = conn.lastSuccess ? now - conn.lastSuccess : null;
  const stale = age != null && age > POLL_MS * 2;
  const down = conn.reachable === false;
  const navDef = NAV.find((n) => n.id === view)!;

  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}${narrow ? " overlay" : ""}`} aria-label="Primary">
        <div className="sidebar-brand">
          <span className="brand-mark"><Box size={16} /></span>
          <span className="brand-name fade-label">Mission Control</span>
          <span className="brand-tag fade-label">v2</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavItem key={n.id} def={n} active={view === n.id} collapsed={collapsed}
              badge={n.id === "dashboard" && failing > 0 ? <span className="nav-badge-dot" title={`${failing} failing cron job${failing > 1 ? "s" : ""}`} /> : n.id === "tasks" && openTasks ? <span className="nav-count fade-label">{openTasks}</span> : null}
              onNavigate={() => { if (narrow) setNarrowExpanded(false); }} />
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer">
          <div className="api-line" title={conn.reachable === false ? "API unreachable" : conn.reachable ? "API reachable" : "Checking API"}>
            <span className="dot" style={{ background: conn.reachable === false ? "var(--outcome-failed)" : conn.reachable ? "var(--status-online)" : "var(--status-unknown)" }} />
            <span className="fade-label">API :8742</span>
          </div>
          <button className="nav-item" style={{ margin: "2px 0" }} onClick={() => setToken(null)} title="Forget token">
            <LogOut size={18} className="nav-icon" /><span className="fade-label">Forget token</span>
          </button>
          <button className="nav-item" style={{ margin: "2px 0" }} onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="Toggle sidebar ( [ )">
            {collapsed ? <PanelLeftOpen size={18} className="nav-icon" /> : <PanelLeftClose size={18} className="nav-icon" />}
            <span className="fade-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className={`main${collapsed || narrow ? " collapsed" : ""}`}>
        <header className="topbar">
          <h1 className="topbar-title">{navDef.title}{subtitle && <span className="topbar-sub">{subtitle}</span>}</h1>
          <div className="topbar-spacer" />
          {gatewayStatus === "online" && <StatusBadge status="online" label="Gateway online" title="A profile's gateway.lock pid is alive (verified via /proc)" />}
          {gatewayStatus === "offline" && <StatusBadge status="offline" label="Gateway offline" />}
          {gatewayStatus === "unknown" && <StatusBadge status="unknown" label="Gateway unknown" />}
          <div className={`freshness${down ? " down" : stale ? " stale" : ""}`}>
            <button className="icon-btn" aria-label="Refresh now" title="Refresh now" onClick={() => { void checkHealth(); refetchAll(); }}>
              <RefreshCw size={16} className={conn.fetching > 0 ? "spin" : undefined} />
            </button>
            <span className="tabular" title={conn.lastSuccess ? `Last successful fetch ${clock(conn.lastSuccess)}` : undefined}>
              {conn.lastSuccess == null ? "Loading…" : stale || down ? `Stale · ${relative(conn.lastSuccess, now)}` : `Updated ${relative(conn.lastSuccess, now)}`}
            </span>
          </div>
          <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>
        {down && (
          <div className="outage-banner" role="alert">
            <TriangleExclamationPoint size={16} />
            Can't reach Mission Control API on :8742.{conn.lastSuccess ? ` Showing last data from ${clock(conn.lastSuccess)}.` : ""}
          </div>
        )}
        <main key={view} className={`content${view === "office" ? " flush" : ""}${down ? " dimmed" : ""}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({ def, active, collapsed, badge, onNavigate }: { def: NavDef; active: boolean; collapsed: boolean; badge: ReactNode; onNavigate: () => void }) {
  const [tip, setTip] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const ref = useRef<HTMLAnchorElement>(null);
  const show = () => {
    if (!collapsed) return;
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setTip(r.top + r.height / 2 - 12);
    }, 300);
  };
  const hide = () => { if (timer.current) window.clearTimeout(timer.current); setTip(null); };
  return (
    <a ref={ref} href={href(def.id)} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}
      aria-label={collapsed ? def.label : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={onNavigate}>
      <def.Icon size={18} className="nav-icon" />
      <span className="fade-label">{def.label}</span>
      {badge}
      {tip != null && collapsed && <span className="nav-tip" style={{ top: tip }}>{def.label}</span>}
    </a>
  );
}
