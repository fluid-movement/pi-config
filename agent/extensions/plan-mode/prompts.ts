/**
 * System prompt constants for plan mode and execution mode.
 */

import type { TodoItem } from "./todos.js";

export const PLAN_MODE_PROMPT = `[PLAN MODE ACTIVE]
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls
- You CANNOT use: edit, write (file modifications are blocked)
- Bash is restricted to an allowlist of read-only commands

Goals:
- Explore the codebase and clarify the user's intent freely
- Ask clarifying questions when requirements are ambiguous
- Propose an approach and identify which files would need to change
- Create a detailed numbered plan under a "Plan:" header when ready:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes — just describe what you would do.
When the plan is solid, present it and await the user's decision.`;

export function executionPrompt(remaining: readonly TodoItem[]): string {
  const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
  return `[EXECUTING PLAN — Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order. After completing a step, call the mark_step_done tool
with the step number before moving on to the next step.`;
}
