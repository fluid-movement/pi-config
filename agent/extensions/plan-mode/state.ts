/**
 * State type, persistence, and session-restore logic for plan mode.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PlanState {
  planModeEnabled: boolean;
  executionMode: boolean;
}

export const EMPTY_STATE: PlanState = {
  planModeEnabled: false,
  executionMode: false,
};

export const STATE_KEY = "plan-mode";
export const EXECUTE_MARKER = "plan-mode-execute";

interface SavedState {
  enabled: boolean;
  executing?: boolean;
}

interface CustomEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

function isCustomEntry(e: { type: string }): e is CustomEntry {
  return e.type === "custom";
}

export function persistState(pi: ExtensionAPI, state: PlanState): void {
  pi.appendEntry(STATE_KEY, {
    enabled: state.planModeEnabled,
    executing: state.executionMode,
  } satisfies SavedState);
}

export function restoreState(ctx: ExtensionContext): PlanState {
  const entries = ctx.sessionManager.getEntries();
  const typed = entries as Array<{ type: string }>;

  const lastSnapshot = [...typed]
    .reverse()
    .find((e): e is CustomEntry => isCustomEntry(e) && e.customType === STATE_KEY);

  const saved = lastSnapshot?.data as SavedState | undefined;
  if (!saved) return { ...EMPTY_STATE };

  return {
    planModeEnabled: saved.enabled ?? false,
    executionMode: saved.executing ?? false,
  };
}
