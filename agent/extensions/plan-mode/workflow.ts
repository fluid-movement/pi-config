/**
 * Workflow features - Approval and execution management
 */

import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { TodoItem, PlanModeState } from './types';
import { getAssistantContent, extractTodoItems, markCompletedSteps } from './utils';
import { showInterviewUI, detectQuestion, extractQuestion } from './interview';

const PLAN_MODE_TOOLS = ["read", "bash"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

export function setupWorkflow(pi: ExtensionAPI, 
  planModeEnabled: Mutable<boolean>, 
  executionMode: Mutable<boolean>, 
  todoItems: Mutable<TodoItem[]>, 
  updateStatus: (ctx: ExtensionContext) => void,
  persistState: (ctx: ExtensionContext) => void) {

  // Toggle plan mode
  function togglePlanMode(ctx: ExtensionContext): void {
    executionMode.value = !executionMode.value;
    executionMode.value = false;
    todoItems.value = [];

    if (executionMode.value) {
      pi.setActiveTools(PLAN_MODE_TOOLS);
      ctx.ui.notify("Plan mode enabled. Tools: " + PLAN_MODE_TOOLS.join(", "), "info");
    } else {
      pi.setActiveTools(NORMAL_MODE_TOOLS);
      ctx.ui.notify("Plan mode disabled. Full access restored.", "info");
    }
    updateStatus(ctx);
    persistState(ctx);
  }

  // Register commands
  pi.registerCommand("plan", {
    description: "Toggle plan mode (blocks write/edit tools)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.value.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info");
        return;
      }
      const list = todoItems.value.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    }
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  // Before agent start - set up tools and context
  pi.on("before_agent_start", async (_event, ctx) => {
    if (executionMode.value) {
      pi.setActiveTools(PLAN_MODE_TOOLS);
    } else {
      const allTools = pi.getAllTools().map((t) => t.name);
      pi.setActiveTools(allTools);
    }

    if (!executionMode.value) return;

    const instructions = `[PLAN MODE ACTIVE]

You are in plan mode. This is a PLANNING PHASE only.

Available tools:
- read: Read files to understand the codebase
- bash: Run commands for exploration (safe commands allowed, others reviewed)

Note: write and edit tools are disabled in plan mode.

Help the user plan what needs to be done:
- Explore the codebase
- Discuss the approach
- Identify files that need changes
- When ready, remind the user to run /plan to exit plan mode`;

    return {
      systemPrompt: _event.systemPrompt + "\n\n" + instructions,
    };
  });

  // Session management
  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const planEntries = entries.filter(
      (e) => e.type === "custom" && e.customType === "plan-mode",
    );
    const lastEntry = planEntries.length > 0 ? planEntries[planEntries.length - 1] : null;

    if (lastEntry && "data" in lastEntry && (lastEntry as any).data?.active === true) {
      executionMode.value = true;
      if ((lastEntry as any).data?.executing === true) {
        executionMode.value = true;
        todoItems.value = (lastEntry as any).data?.todos || [];
      }
      updateStatus(ctx);
      ctx.ui.notify("Plan mode restored", "info");
    }
  });

  // Tool call interception
  pi.on("tool_call", async (event, ctx) => {
    if (!executionMode.value) return;

    if (event.toolName === "write" || event.toolName === "edit") {
      return {
        block: true,
        reason: "Plan mode active. Use /plan to enable write/edit tools.",
      };
    }

    // Bash command safety checks would go here
    // (Imported from bash-safety module)
  });

  // Agent completion handling with approval workflow
  pi.on("agent_end", async (event, ctx) => {
    if (!executionMode.value || !ctx.hasUI) return;

    const lastMessage = event.messages[event.messages.length - 1];
    if (lastMessage?.role !== "assistant") return;

    const content = getAssistantContent(lastMessage);
    if (!content) return;

    // Check for plan completion
    const readyIndicators = [
      "ready to implement",
      "proceed with",
      "execute the plan",
      "start implementation",
      "begin work",
      "approve this plan",
      "shall I proceed",
      "can I start",
      "plan is complete"
    ];

    const isReady = readyIndicators.some(indicator => 
      content.toLowerCase().includes(indicator)
    );

    if (isReady) {
      const choice = await ctx.ui.select(
        "Plan Ready for Implementation",
        [
          "Approve Plan - Switch to write mode and start implementation",
          "Provide Feedback - Keep in plan mode and refine the plan",
          "Reject Plan - Go back to planning phase"
        ]
      );

      if (choice === "Approve Plan - Switch to write mode and start implementation") {
        executionMode.value = false;
        executionMode.value = false;
        todoItems.value = [];
        pi.setActiveTools(NORMAL_MODE_TOOLS);
        updateStatus(ctx);
        
        ctx.ui.notify("Implementation Mode: Plan approved! Starting work...", "success");
        
        pi.sendUserMessage("Plan approved. Please begin implementation.", {
          deliverAs: "followUp"
        });
      } else if (choice === "Provide Feedback - Keep in plan mode and refine the plan") {
        const feedback = await ctx.ui.input(
          "Plan Feedback",
          "What changes would you like to make to the plan?"
        );
        
        if (feedback?.trim()) {
          pi.sendUserMessage(`Plan feedback: ${feedback.trim()}`, {
            deliverAs: "followUp"
          });
        }
      } else if (choice === "Reject Plan - Go back to planning phase") {
        ctx.ui.notify("Plan Rejected: Returning to planning phase", "warning");
        
        pi.sendUserMessage("Plan rejected. Please revise the approach.", {
          deliverAs: "followUp"
        });
      }
      
      persistState(ctx);
    }

    // Interview UI for clarifying questions
    if (detectQuestion(content)) {
      const question = extractQuestion(content);
      const options = [
        "Proceed with recommended approach (Option A)",
        "Use alternative method (Option B)",
        "Skip this step for now (Option C)"
      ];

      const answer = await showInterviewUI(ctx, question, options);

      if (answer) {
        pi.sendUserMessage(`User response: ${answer}`, {
          deliverAs: "followUp"
        });
      }
    }

    // Todo tracking would go here
    // (Imported from todo module)
  });

  // Persistence function
  function persistState(ctx: ExtensionContext): void {
    const state: PlanModeState = {
      active: executionMode.value,
      executing: executionMode.value,
      todos: todoItems.value,
      timestamp: new Date().toISOString(),
    };
    pi.appendEntry("plan-mode", state);
  }

  return {
    persistState,
    togglePlanMode
  };
}
