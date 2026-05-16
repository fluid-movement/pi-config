/**
 * System prompt constants for plan mode and execution mode.
 */

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
- When you have a solid plan, present it to the user and call the \`todo\` tool
  once per step (action: "add") to record each step in order.

Do NOT attempt to make changes — just describe what you would do and record the steps.`;

export function executionPrompt(todos: ReadonlyArray<{ id: number; text: string }>): string {
  const todoList = todos.map((t) => `#${t.id}: ${t.text}`).join("\n");
  return `[EXECUTING PLAN — Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order. After completing a step, call \`todo\` with action "toggle"
and the step's id before moving on to the next step.`;
}
