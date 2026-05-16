/**
 * State type, persistence, and session-restore logic for plan mode.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TodoItem } from "./todos.js";

export interface PlanState {
  planModeEnabled: boolean;
  executionMode: boolean;
  todoItems: TodoItem[];
}

export const EMPTY_STATE: PlanState = {
  planModeEnabled: false,
  executionMode: false,
  todoItems: [],
};

export const STATE_KEY = "plan-mode";
export const EXECUTE_MARKER = "plan-mode-execute";

// ── Saved snapshot shape ──────────────────────────────────────────────────────

interface SavedState {
  enabled: boolean;
  todos?: TodoItem[];
  executing?: boolean;
}

// ── Session entry type guards ─────────────────────────────────────────────────

interface CustomEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

function isCustomEntry(e: { type: string }): e is CustomEntry {
  return e.type === "custom";
}

// ── Public API ────────────────────────────────────────────────────────────────

export function persistState(pi: ExtensionAPI, state: PlanState): void {
  pi.appendEntry(STATE_KEY, {
    enabled: state.planModeEnabled,
    todos: state.todoItems,
    executing: state.executionMode,
  } satisfies SavedState);
}

export function restoreState(ctx: ExtensionContext): PlanState {
  const entries = ctx.sessionManager.getEntries();
  const typed = entries as Array<{ type: string }>;

  // Find last saved state snapshot
  const lastSnapshot = [...typed]
    .reverse()
    .find((e): e is CustomEntry => isCustomEntry(e) && e.customType === STATE_KEY);

  const saved = lastSnapshot?.data as SavedState | undefined;
  if (!saved) return { ...EMPTY_STATE };

  const state: PlanState = {
    planModeEnabled: saved.enabled ?? false,
    executionMode: saved.executing ?? false,
    todoItems: saved.todos ?? [],
  };

  return state;
}
