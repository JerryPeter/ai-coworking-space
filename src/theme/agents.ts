// Single source of truth for agent identity (spec 2.3). React reads cssVar; Three.js reads hex.
// Names/roles come from the design spec roster; live status/data always come from the API.

export type AgentKind = "agent" | "tool";

export interface AgentIdentity {
  id: string;            // profile id ("default", "pratama_cto", ...) or "claude_cli"
  displayName: string;
  shortName: string;
  role: string;
  cssVar: string;        // e.g. "--agent-hawa"
  hex: string;           // dark hex (also used by the 3D scene)
  hexLight: string;
  kind: AgentKind;
}

export const CLAUDE_ID = "claude_cli";

export const AGENTS: AgentIdentity[] = [
  { id: "default", displayName: "Hawa The Second", shortName: "Hawa", role: "Lead Agent / Coordinator",
    cssVar: "--agent-hawa", hex: "#A78BFA", hexLight: "#7C5CE0", kind: "agent" },
  { id: "pratama_cto", displayName: "Pratama The CTO", shortName: "Pratama", role: "Lead Engineer",
    cssVar: "--agent-pratama", hex: "#38BDF8", hexLight: "#0284C7", kind: "agent" },
  { id: "bagas_dev_lead", displayName: "Bagas The Dev", shortName: "Bagas", role: "Lead Developer",
    cssVar: "--agent-bagas", hex: "#84CC16", hexLight: "#4D7C0F", kind: "agent" },
  { id: "susi_uiux", displayName: "Susi The UIUX", shortName: "Susi", role: "UI/UX Designer",
    cssVar: "--agent-susi", hex: "#F472B6", hexLight: "#DB2777", kind: "agent" },
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
  pratama_cto: {
    rows: ["HHHHHHHH", "HHHHHHHH", "HSSSSSSH", "SSSSSSSS", "SGEGGEGS", "SSSSSSSS", "SSSMMSSS", "SSSSSSSS"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#1A1A1A", G: GLASSES },
  },
  bagas_dev_lead: {
    rows: ["AAAAAAAA", "AAAAAAAA", "HSSSSSSH", "SSSSSSSS", "SSESSESS", "SSSSSSSS", "SSSMMSSS", "SSSSSSSS"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#3A2A1E", A: "#1F2937" },
  },
  susi_uiux: {
    rows: ["..AAAAA.", "AAAAAAAA", "HHHHHHHH", "HSSSSSSH", "HSESSESH", "HSSSSSSH", "HSSMMSSH", "HSSSSSSH"],
    palette: { S: SKIN, E: EYE, M: MOUTH, H: "#4A2C1F", A: "#BE185D" },
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
