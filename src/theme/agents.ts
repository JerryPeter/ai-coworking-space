// Single source of truth for agent identity (spec 2.3). React reads cssVar; Three.js reads hex.
// Names/roles come from the design spec roster; live status/data always come from the API.

export type AgentKind = "agent" | "tool";

export interface AgentIdentity {
  id: string;            // profile id ("default", "goku_cto", ...) or "claude_cli"
  displayName: string;
  shortName: string;
  role: string;
  cssVar: string;        // e.g. "--agent-hawa"
  hex: string;           // dark hex (also used by the 3D scene)
  hexLight: string;
  kind: AgentKind;
  /** Fixed 3D-office desk (0..9). Claude CLI = 4, OpenClaw = 5..8, so new agents need an explicit free desk. */
  desk?: number;
}

export const CLAUDE_ID = "claude_cli";

export const AGENTS: AgentIdentity[] = [
  { id: "default", displayName: "Hawa The Second", shortName: "Hawa", role: "Lead Agent / Coordinator",
    cssVar: "--agent-hawa", hex: "#A78BFA", hexLight: "#7C5CE0", kind: "agent", desk: 0 },
  { id: "goku_cto", displayName: "Goku The CTO", shortName: "Goku", role: "Lead Engineer",
    cssVar: "--agent-goku", hex: "#38BDF8", hexLight: "#0284C7", kind: "agent", desk: 1 },
  { id: "kuririn_dev_lead", displayName: "Kuririn The Dev", shortName: "Kuririn", role: "Lead Developer",
    cssVar: "--agent-kuririn", hex: "#84CC16", hexLight: "#4D7C0F", kind: "agent", desk: 2 },
  { id: "bulma_uiux", displayName: "Bulma The UIUX", shortName: "Bulma", role: "UI/UX Designer",
    cssVar: "--agent-bulma", hex: "#F472B6", hexLight: "#DB2777", kind: "agent", desk: 3 },
  { id: "bejita_video_editor", displayName: "Bejita The Video Editor", shortName: "Bejita", role: "Video Editor",
    cssVar: "--agent-bejita", hex: "#3B82F6", hexLight: "#1D4ED8", kind: "agent", desk: 9 },
];

export const CLAUDE: AgentIdentity = {
  id: CLAUDE_ID, displayName: "Claude Code CLI", shortName: "Claude CLI", role: "Coding tool",
  cssVar: "--agent-claude", hex: "#F97316", hexLight: "#EA580C", kind: "tool",
};

export const ROSTER: AgentIdentity[] = [...AGENTS, CLAUDE];

const FALLBACK = (id: string): AgentIdentity => ({
  // A profile the spec doesn't know yet: neutral chrome color, never an invented agent color.
  id, displayName: id, shortName: id, role: "Not Available",
  cssVar: "--text-muted", hex: "#6B7285", hexLight: "#7A8194", kind: "agent",
});

export function identity(id: string): AgentIdentity {
  return ROSTER.find((a) => a.id === id) ?? FALLBACK(id);
}

/** Roster order index (unknown profiles sort after known ones). */
export function rosterIndex(id: string): number {
  const i = ROSTER.findIndex((a) => a.id === id);
  return i === -1 ? 99 : i;
}

export const color = (id: string) => `var(${identity(id).cssVar})`;
export const subtle = (id: string) => `var(${identity(id).cssVar}-subtle)`;

// 8x8 pixel avatar maps (spec 5.2.1), row 0 = top.
const SKIN = "#D4A373", EYE = "#1F2937", MOUTH = "#9C6644", GLASSES = "#111827";

interface PixelMap { rows: string[]; palette: Record<string, string>; overrides?: Record<string, string> }

export const PIXEL_MAPS: Record<string, PixelMap> = {
  default: {
    rows: [".A.AA.A.", "AAAAAAAA", "HHHHHHHH", "HSSSSSSH", "SSESSESS", "SSSSSSSS", "SSSMMSSS", "SSSSSSSS"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#2B1D14", A: "#F5C542" },
  },
  goku_cto: {
    rows: ["HHHHHHHH", "HHHHHHHH", "HSSSSSSH", "SSSSSSSS", "SGEGGEGS", "SSSSSSSS", "SSSMMSSS", "SSSSSSSS"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#1A1A1A", G: GLASSES },
  },
  kuririn_dev_lead: {
    rows: ["AAAAAAAA", "AAAAAAAA", "HSSSSSSH", "SSSSSSSS", "SSESSESS", "SSSSSSSS", "SSSMMSSS", "SSSSSSSS"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#3A2A1E", A: "#1F2937" },
  },
  bulma_uiux: {
    rows: ["..AAAAA.", "AAAAAAAA", "HHHHHHHH", "HSSSSSSH", "HSESSESH", "HSSSSSSH", "HSSMMSSH", "HSSSSSSH"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#4A2C1F", A: "#BE185D" },
  },
  bejita_video_editor: {
    // spiky upswept black hair with a sharp widow's peak, stern brows
    rows: ["H.H.H.HH", "HHHHHHHH", "HHHSSHHH", "HSSSSSSH", "SBBSSBBS", "SSESSESS", "SSSMMSSS", "SSSSSSSS"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#14141F", B: "#14141F" },
  },
  [CLAUDE_ID]: {
    rows: ["...A....", "...A....", "DDDDDDDD", "DFFFFFFD", "DFOFFOFD", "DFFFFFFD", "DFFOOFFD", "DDDDDDDD"],
    palette: { A: "#9CA3AF", D: "#2B2F3A", F: "#111827", O: "#FDBA74" },
    overrides: { "0,3": "#F97316" }, // row 0 antenna pixel is orange
  },
};

export function pixelCells(id: string): { x: number; y: number; fill: string }[] {
  const map = PIXEL_MAPS[id];
  if (!map) return [];
  const out: { x: number; y: number; fill: string }[] = [];
  map.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const fill = map.overrides?.[`${y},${x}`] ?? map.palette[ch];
      if (fill) out.push({ x, y, fill });
    }),
  );
  return out;
}
