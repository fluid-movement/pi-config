/**
 * Constants for Plan Mode extension
 * Centralized configuration and magic strings
 */

export const STATUS_KEY = "plan-mode";
export const PLANNING_TEXT = "PLANNING";
export const EXECUTION_TEXT = "EXECUTION";

export const COMMAND_BLOCKED_MESSAGE = "Plan mode active. Use /plan to enable write/edit tools.";
export const GIT_COMMAND_BLOCKED = "Plan mode: mutating git commands are not allowed.";
export const REDIRECT_BLOCKED = "Plan mode: file redirects are not allowed.";

export const IMPLEMENTATION_MODE_MESSAGE = "Implementation Mode: Plan approved! Starting work...";
export const PLAN_REJECTED_MESSAGE = "Plan Rejected: Returning to planning phase";

export const PLAN_MODE_TOOLS = ["read", "bash"] as const;
export const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"] as const;

export const READY_INDICATORS = [
  "ready to implement",
  "proceed with",
  "execute the plan",
  "start implementation",
  "begin work",
  "approve this plan",
  "shall I proceed",
  "can I start",
  "plan is complete"
] as const;

// Interview UI constants
export const INTERVIEW_OPTIONS = [
  "Proceed with recommended approach (Option A)",
  "Use alternative method (Option B)",
  "Skip this step for now (Option C)"
] as const;
