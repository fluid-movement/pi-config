/**
 * Tool-call safety policy for plan mode.
 * Pure functions — no side effects, no pi imports.
 */

export type Verdict = { block: true; reason: string } | { block: false };

const ALLOWED: readonly RegExp[] = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*yarn\s+(list|info|why|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*curl\s/i,
  /^\s*wget\s+-O\s*-/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
];

const BLOCKED: readonly RegExp[] = [
  // Redirects and subshells
  /(^|[^<])>(?!>)/,
  />>/,
  /[;`]/,
  /\$\(/,
  // Unsafe pipes
  /\|\s*(rm|xargs|sudo|chmod|chown|mv|cp|wget|curl)\b/,
  // Destructive file ops
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  // Package managers (install/mutate)
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  // Mutating git ops
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  // System control
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  // Interactive editors
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

export function decideBash(command: string): Verdict {
  for (const pattern of BLOCKED) {
    if (pattern.test(command)) {
      return {
        block: true,
        reason: `Plan mode: command blocked — matched destructive pattern. Only read-only commands are allowed. Use /plan to exit plan mode first.\nCommand: ${command}`,
      };
    }
  }
  if (ALLOWED.some((p) => p.test(command))) {
    return { block: false };
  }
  return {
    block: true,
    reason: `Plan mode: command not in allowlist. Only read-only commands (ls, cat, grep, git status/log/diff, etc.) are allowed. Use /plan to exit plan mode first.\nCommand: ${command}`,
  };
}

export function decide(toolName: string, input: unknown): Verdict {
  switch (toolName) {
    case "write":
    case "edit":
      return {
        block: true,
        reason: "Plan mode is active — file mutations are not allowed. Use /plan to exit plan mode.",
      };
    case "bash": {
      const command = (input as { command?: unknown })?.command;
      return decideBash(typeof command === "string" ? command : "");
    }
    default:
      return { block: false };
  }
}
