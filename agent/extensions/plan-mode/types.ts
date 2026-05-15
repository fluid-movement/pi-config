/**
 * Type definitions for Plan Mode extension
 */

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
}

export interface PlanModeState {
  active: boolean;
  executing: boolean;
  todos: TodoItem[];
  timestamp: string;
}

export const SAFE_COMMAND_PATTERNS: RegExp[] = [
  /^\s*cat\b/,
  /^\s*ls\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*wc\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*git\s+(status|log|diff|show|branch)\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*which\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*date\b/,
];

export const MUTATING_GIT_COMMANDS: RegExp[] = [
  /^\s*git\s+commit/,
  /^\s*git\s+push/,
  /^\s*git\s+pull/,
  /^\s*git\s+merge/,
  /^\s*git\s+rebase/,
  /^\s*git\s+reset/,
  /^\s*git\s+cherry-pick/,
  /^\s*git\s+branch\s+-D/,
  /^\s*git\s+branch\s+-d/,
  /^\s*git\s+tag\s+-d/,
];

export const UNSAFE_SHELL_CHARS = /[;&`\n]/;
export const REDIRECT_PATTERN = />{1,2}/;
