import { lazy, Suspense, useEffect, useState } from "react";
import { useToken } from "./api/client";
import { AgentDrawerHost } from "./components/agents/AgentDrawer";
import { CronJobDrawerHost } from "./components/CronList";
import { AppShell } from "./components/layout/AppShell";
import { TokenForm } from "./components/layout/TokenForm";
import { Skeleton } from "./components/ui/States";
import { useRoute } from "./lib/router";
import { useSubtitleValue } from "./lib/subtitle";
import Activity from "./views/Activity";
import Agents from "./views/Agents";
import Calendar from "./views/Calendar";
import Dashboard from "./views/Dashboard";
import Graphify from "./views/Graphify";
import Memory from "./views/Memory";
import TaskBoard from "./views/TaskBoard";
import TokenMonitor from "./views/TokenMonitor";
import WorkflowView from "./views/Workflow";

// The 3D office pulls in Three.js; lazy-load it so other views don't pay for it.
const Office = lazy(() => import("./views/Office"));

export default function App() {
  const token = useToken();
  const { view } = useRoute();
  const subtitle = useSubtitleValue();
  // Remember whether we ever had a token, so a 401 can explain why the form reappeared.
  const [hadToken, setHadToken] = useState(!!token);
  useEffect(() => { if (token) setHadToken(true); }, [token]);

  if (!token) return <TokenForm expired={hadToken} />;

  return (
    <AppShell subtitle={subtitle}>
      {view === "dashboard" && <Dashboard />}
      {view === "agents" && <Agents />}
      {view === "tasks" && <TaskBoard />}
      {view === "workflow" && <WorkflowView />}
      {view === "graphify" && <Graphify />}
      {view === "token-monitor" && <TokenMonitor />}
      {view === "calendar" && <Calendar />}
      {view === "activity" && <Activity />}
      {view === "memory" && <Memory />}
      {view === "office" && (
        <Suspense fallback={<div style={{ padding: 24 }}><Skeleton h={480} r={12} /></div>}>
          <Office />
        </Suspense>
      )}
      {/* Drawers are URL-driven (?agent=, ?job=) so any view can open them and Back closes them. */}
      <AgentDrawerHost />
      <CronJobDrawerHost />
    </AppShell>
  );
}
