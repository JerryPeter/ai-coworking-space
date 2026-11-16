// Shared, type-only interface for the two office renderers (tech plan 2). No runtime code.
import type { HumanState, RobotState } from "./characters";
import type { Preset } from "./layout";
import type { TimeOfDay } from "./palettes";

export type { OfficeMode, TimeOfDay } from "./palettes";

export interface OfficeRenderer {
  /** `task` = optional activity text for the label (pixel mode); null/empty → state label only. */
  setAgentState(id: string, state: HumanState, label: string, task?: string | null): void;
  setRobotState(state: RobotState, label: string): void;
  preset(name: Preset): void;
  focus(id: string): void;
  setTimeOfDay(tod: TimeOfDay, opts?: { instant?: boolean }): void;
  dispose(): void;
}
