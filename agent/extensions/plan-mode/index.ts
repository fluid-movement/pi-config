import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { decide } from "./safety.js";
import { extractTodoItems, markCompletedSteps } from "./todos.js";
import { PLAN_MODE_PROMPT, executionPrompt } from "./prompts.js";
import {
  type PlanState,
  EMPTY_STATE,
  STATE_KEY,
  EXECUTE_MARKER,
  persistState,
  restoreState,
} from "./state.js";
import { updateStatus, askApproval, askRefinement } from "./ui.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"] as const;
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export default function planModeExtension(pi: ExtensionAPI): void {
  let state: PlanState = { ...EMPTY_STATE };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function applyToolSet(): void {
    pi.setActiveTools(state.planModeEnabled ? [...PLAN_MODE_TOOLS] : [...NORMAL_MODE_TOOLS]);
  }

  function toggle(ctx: ExtensionContext): void {
    state = { ...EMPTY_STATE, planModeEnabled: !state.planModeEnabled };
    applyToolSet();
    persistState(pi, state);
    updateStatus(ctx, state);
    ctx.ui.notify(
      state.planModeEnabled
        ? "Plan mode ON — mutations blocked."
        : "Plan mode OFF — all tools restored.",
      "info",
    );
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("plan", {
    description: "Toggle plan mode (blocks write/edit/mutating bash, focuses on planning)",
    handler: async (_args, ctx) => toggle(ctx),
  });

  pi.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (state.todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan.", "info");
        return;
      }
      const list = state.todoItems
        .map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`)
        .join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => toggle(ctx),
  });

  // ── Events ───────────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const restored = restoreState(ctx);
    // --plan flag forces plan mode on regardless of saved state
    state = pi.getFlag("plan") === true
      ? { ...restored, planModeEnabled: true }
      : restored;
    if (state.planModeEnabled || state.executionMode) applyToolSet();
    updateStatus(ctx, state);
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    if (state.planModeEnabled) {
      return {
        message: {
          customType: "plan-mode-context",
          content: PLAN_MODE_PROMPT,
          display: false,
        },
      };
    }
    if (state.executionMode && state.todoItems.length > 0) {
      const remaining = state.todoItems.filter((t) => !t.completed);
      return {
        message: {
          customType: "plan-execution-context",
          content: executionPrompt(remaining),
          display: false,
        },
      };
    }
  });

  // Intercept tool calls — our safety net even when tools are in the active list.
  pi.on("tool_call", async (event, _ctx) => {
    if (!state.planModeEnabled) return;
    const verdict = decide(event.toolName, event.input);
    if (verdict.block) return { block: true, reason: verdict.reason };
  });

  // Strip stale plan-mode context messages when plan mode is off.
  pi.on("context", async (event) => {
    if (state.planModeEnabled) return;

    return {
      messages: event.messages.filter((m) => {
        const msg = m as { customType?: string; role?: string; content?: unknown };
        if (
          msg.customType === "plan-mode-context" ||
          msg.customType === "plan-execution-context"
        ) {
          return false;
        }
        if (msg.role !== "user") return true;
        const content = msg.content;
        if (typeof content === "string") return !content.includes("[PLAN MODE ACTIVE]");
        if (Array.isArray(content)) {
          return !content.some(
            (c) =>
              typeof c === "object" &&
              c !== null &&
              (c as { type?: string; text?: string }).type === "text" &&
              (c as { type?: string; text?: string }).text?.includes("[PLAN MODE ACTIVE]"),
          );
        }
        return true;
      }),
    };
  });

  // Track [DONE:n] markers during execution.
  pi.on("turn_end", async (event, ctx) => {
    if (!state.executionMode || state.todoItems.length === 0) return;

    const msg = event.message as { role?: string; content?: unknown };
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    const text = (msg.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

    if (markCompletedSteps(text, state.todoItems) > 0) updateStatus(ctx, state);
    persistState(pi, state);
  });

  pi.on("agent_end", async (event, ctx) => {
    // Check if execution is complete.
    if (state.executionMode && state.todoItems.length > 0) {
      if (state.todoItems.every((t) => t.completed)) {
        const completedList = state.todoItems.map((t) => `~~${t.text}~~`).join("\n");
        pi.sendMessage(
          {
            customType: "plan-complete",
            content: `**Plan Complete!** ✓\n\n${completedList}`,
            display: true,
          },
          { triggerTurn: false },
        );
        state = { ...EMPTY_STATE };
        pi.setActiveTools([...NORMAL_MODE_TOOLS]);
        updateStatus(ctx, state);
        persistState(pi, state);
      }
      return;
    }

    // After a planning turn: show approval dialog.
    if (!state.planModeEnabled || !ctx.hasUI) return;

    // Extract todos from last assistant message.
    const messages = event.messages as Array<{ role?: string; content?: unknown }>;
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && Array.isArray(m.content));

    if (lastAssistant?.content && Array.isArray(lastAssistant.content)) {
      const text = (lastAssistant.content as Array<{ type?: string; text?: string }>)
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      const extracted = extractTodoItems(text);
      if (extracted.length > 0) state = { ...state, todoItems: extracted };
    }

    // Show extracted plan steps.
    if (state.todoItems.length > 0) {
      const todoListText = state.todoItems
        .map((t, i) => `${i + 1}. ☐ ${t.text}`)
        .join("\n");
      pi.sendMessage(
        {
          customType: "plan-todo-list",
          content: `**Plan Steps (${state.todoItems.length}):**\n\n${todoListText}`,
          display: true,
        },
        { triggerTurn: false },
      );
    }

    const choice = await askApproval(ctx, state.todoItems.length);

    if (choice === "execute") {
      const todos = state.todoItems;
      state = { planModeEnabled: false, executionMode: todos.length > 0, todoItems: todos };
      pi.setActiveTools([...NORMAL_MODE_TOOLS]);
      updateStatus(ctx, state);
      const execMessage =
        todos.length > 0
          ? `Execute the plan. Start with: ${todos[0].text}`
          : "Execute the plan you just created.";
      pi.sendMessage(
        { customType: EXECUTE_MARKER, content: execMessage, display: true },
        { triggerTurn: true },
      );
      persistState(pi, state);
    } else if (choice === "refine") {
      const refinement = await askRefinement(ctx);
      if (refinement) pi.sendUserMessage(refinement);
    }
    // "stay" — do nothing, remain in plan mode
  });
}
