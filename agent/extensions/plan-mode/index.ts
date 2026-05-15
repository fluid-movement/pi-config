/**
 * Unified Plan Mode Extension - Main Entry Point
 * 
 * Modern TypeScript with best practices:
 * - constants.ts: Centralized configuration
 * - state.ts: Type-safe state management
 * - types.ts: Strong typing
 * - utils.ts: Reusable utilities
 * - workflow.ts: Core logic
 * - interview.ts: Interview UI
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Mutable, createMutable } from "./state";
import { TodoItem, PlanModeState } from "./types";
import {
  STATUS_KEY,
  PLANNING_TEXT,
  IMPLEMENTATION_MODE_MESSAGE,
  PLAN_REJECTED_MESSAGE
} from "./constants";
import { setupWorkflow } from "./workflow";
import { getAssistantContent } from "./utils";

export default function planModeExtension(pi: ExtensionAPI): void {
  // Type-safe state management using Mutable pattern
  const planModeEnabled = createMutable(false);
  const executionMode = createMutable(false);
  const todoItems = createMutable<TodoItem[]>([]);

  /**
   * Update UI status with error handling
   */
  function updateStatus(ctx: ExtensionContext): void {
    try {
      if (executionMode.value && todoItems.value.length > 0) {
        const completed = todoItems.value.filter((t) => t.completed).length;
        ctx.ui.setStatus(
          STATUS_KEY,
          ctx.ui.theme.fg("accent", `${completed}/${todoItems.value.length}`)
        );
      } else if (planModeEnabled.value) {
        ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", PLANNING_TEXT));
      } else {
        ctx.ui.setStatus(STATUS_KEY, undefined);
      }
    } catch (error) {
      console.error("Status update failed:", error);
      ctx.ui.notify(`UI update error: ${error.message}`, "error");
    }
  }

  /**
   * Persist state with error handling
   */
  function persistState(ctx: ExtensionContext): void {
    try {
      const stateData: PlanModeState = {
        active: planModeEnabled.value,
        executing: executionMode.value,
        todos: todoItems.value,
        timestamp: new Date().toISOString(),
      };
      pi.appendEntry(STATUS_KEY, stateData);
    } catch (error) {
      console.error("Persist failed:", error);
      ctx.ui.notify(`Save failed: ${error.message}`, "error");
    }
  }

  // Set up workflow with proper type-safe state objects
  setupWorkflow(
    pi,
    planModeEnabled,
    executionMode,
    todoItems,
    updateStatus,
    persistState
  );
}
