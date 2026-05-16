/**
 * State type, persistence, and session-restore logic for plan mode.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { markCompletedSteps, type TodoItem } from "./todos.js";

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

interface TextBlock {
  type: "text";
  text: string;
}

interface AssistantMessageShape {
  role: "assistant";
  content: TextBlock[];
}

interface MessageEntry {
  type: "message";
  message: {
    role: string;
    content: unknown;
  };
}

function isCustomEntry(e: { type: string }): e is CustomEntry {
  return e.type === "custom";
}

function isMessageEntry(e: { type: string }): e is MessageEntry {
  return e.type === "message" && "message" in e;
}

function isAssistantMessage(m: { role: string; content: unknown }): m is AssistantMessageShape {
  return m.role === "assistant" && Array.isArray(m.content);
}

function isTextBlock(b: unknown): b is TextBlock {
  return typeof b === "object" && b !== null && (b as TextBlock).type === "text" && typeof (b as TextBlock).text === "string";
}

function getAssistantText(m: AssistantMessageShape): string {
  return m.content.filter(isTextBlock).map((b) => b.text).join("\n");
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

  // On resume in execution mode: replay [DONE:n] markers from messages after
  // the last execute-marker entry to rebuild completion state accurately.
  if (state.executionMode && state.todoItems.length > 0) {
    let executeIndex = -1;
    for (let i = typed.length - 1; i >= 0; i--) {
      const e = typed[i];
      if (isCustomEntry(e) && e.customType === EXECUTE_MARKER) {
        executeIndex = i;
        break;
      }
    }

    const assistantTexts: string[] = [];
    for (let i = executeIndex + 1; i < typed.length; i++) {
      const e = typed[i];
      if (isMessageEntry(e) && isAssistantMessage(e.message)) {
        assistantTexts.push(getAssistantText(e.message));
      }
    }
    markCompletedSteps(assistantTexts.join("\n"), state.todoItems);
  }

  return state;
}
