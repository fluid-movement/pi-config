import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { decide } from "./safety.js";
import { PLAN_MODE_PROMPT, executionPrompt } from "./prompts.js";
import {
  type PlanState,
  EMPTY_STATE,
  EXECUTE_MARKER,
  persistState,
  restoreState,
} from "./state.js";
import { updateStatus, askApproval, askRefinement } from "./ui.js";
import { type Todo, reconstructTodos } from "../todos.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "todo"] as const;
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
const EXECUTION_MODE_TOOLS = [...NORMAL_MODE_TOOLS, "todo"] as const;

function readTodos(ctx: ExtensionContext): Todo[] {
  return reconstructTodos(ctx).todos;
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let state: PlanState = { ...EMPTY_STATE };

  function applyToolSet(): void {
    if (state.planModeEnabled) pi.setActiveTools([...PLAN_MODE_TOOLS]);
    else if (state.executionMode) pi.setActiveTools([...EXECUTION_MODE_TOOLS]);
    else pi.setActiveTools([...NORMAL_MODE_TOOLS]);
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

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("plan", {
    description: "Toggle plan mode (blocks write/edit/mutating bash, focuses on planning)",
    handler: async (_args, ctx) => toggle(ctx),
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => toggle(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    const restored = restoreState(ctx);
    state = pi.getFlag("plan") === true
      ? { ...restored, planModeEnabled: true }
      : restored;
    if (state.planModeEnabled || state.executionMode) applyToolSet();
    const todos = readTodos(ctx);
    updateStatus(ctx, state, todos);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (state.planModeEnabled) {
      return {
        message: {
          customType: "plan-mode-context",
          content: PLAN_MODE_PROMPT,
          display: false,
        },
      };
    }
    if (state.executionMode) {
      const remaining = readTodos(ctx).filter((t) => !t.done);
      if (remaining.length > 0) {
        return {
          message: {
            customType: "plan-execution-context",
            content: executionPrompt(remaining),
            display: false,
          },
        };
      }
    }
  });

  pi.on("tool_call", async (event, _ctx) => {
    if (!state.planModeEnabled) return;
    const verdict = decide(event.toolName, event.input);
    if (verdict.block) return { block: true, reason: verdict.reason };
  });

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

  pi.on("agent_end", async (event, ctx) => {
    const todos = readTodos(ctx);

    // Check if execution is complete.
    if (state.executionMode) {
      updateStatus(ctx, state, todos);
      if (todos.length > 0 && todos.every((t) => t.done)) {
        const completedList = todos.map((t) => `~~${t.text}~~`).join("\n");
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

    // Inject execution prompt if todos were recorded by the agent via `todo add`.
    if (todos.length > 0) {
      const todoListText = todos.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
      pi.sendMessage(
        {
          customType: "plan-todo-list",
          content: `**Plan Steps (${todos.length}):**\n\n${todoListText}`,
          display: true,
        },
        { triggerTurn: false },
      );
    }

    const choice = await askApproval(ctx, todos.length);

    if (choice === "execute") {
      state = { planModeEnabled: false, executionMode: todos.length > 0 };
      pi.setActiveTools([...EXECUTION_MODE_TOOLS]);
      updateStatus(ctx, state, todos);
      const remaining = todos.filter((t) => !t.done);
      const execMessage = remaining.length > 0
        ? `Execute the plan. Start with: ${remaining[0].text}`
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
