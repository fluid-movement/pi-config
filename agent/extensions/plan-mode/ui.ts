/**
 * UI helpers for plan mode — status, widget, and approval dialogs.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanState } from "./state.js";

export function updateStatus(ctx: ExtensionContext, state: PlanState): void {
  const { planModeEnabled, executionMode, todoItems } = state;

  // Footer badge
  if (executionMode && todoItems.length > 0) {
    const completed = todoItems.filter((t) => t.completed).length;
    ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
  } else if (planModeEnabled) {
    ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
  } else {
    ctx.ui.setStatus("plan-mode", undefined);
  }

  // Todo widget above editor
  if (executionMode && todoItems.length > 0) {
    const lines = todoItems.map((item) => {
      if (item.completed) {
        return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text));
      }
      return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
    });
    ctx.ui.setWidget("plan-todos", lines);
  } else {
    ctx.ui.setWidget("plan-todos", undefined);
  }
}

export type ApprovalChoice = "execute" | "stay" | "refine";

export async function askApproval(
  ctx: ExtensionContext,
  todoCount: number,
): Promise<ApprovalChoice | undefined> {
  if (!ctx.hasUI) return undefined;

  const executeLabel = todoCount > 0 ? "Execute the plan (track progress)" : "Execute the plan";
  const choice = await ctx.ui.select("Plan mode — what next?", [
    executeLabel,
    "Stay in plan mode",
    "Refine the plan",
  ]);

  if (!choice) return undefined;
  if (choice.startsWith("Execute")) return "execute";
  if (choice === "Refine the plan") return "refine";
  return "stay";
}

export async function askRefinement(ctx: ExtensionContext): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  const text = await ctx.ui.editor("Refine the plan:", "");
  return text?.trim() || undefined;
}
