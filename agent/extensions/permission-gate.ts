/**
 * Permission Gate Extension
 * 
 * Enhanced security extension that prevents catastrophic commands and provides
 * configurable safety controls with audit logging.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Configuration interface
interface PermissionGateConfig {
  logBlockedCommands: boolean;
  logFilePath: string;
  autoBlockInNonInteractive: boolean;
  customPatterns: string[];
  whitelistPatterns: string[];
}

// Default configuration
const DEFAULT_CONFIG: PermissionGateConfig = {
  logBlockedCommands: true,
  logFilePath: "~/.pi/permission-gate.log",
  autoBlockInNonInteractive: true,
  customPatterns: [],
  whitelistPatterns: []
};

// Dangerous command categories with patterns
const DANGEROUS_PATTERNS = {
  // File system destruction
  fileDestruction: [
    /\brm\s+(-rf?|--recursive)\b/i,
    /\brmdir\b/i,
    /\bshred\b/i,
    /\bdd\b/i,
    /\btruncate\b/i,
    /\bfdisk\b/i,
    /\bmkfs\b/i,
    /\bformat\b/i,
  ],
  
  // System control
  systemControl: [
    /\bsudo\b/i,
    /\bsu\b/i,
    /\breboot\b/i,
    /\bshutdown\b/i,
    /\bpoweroff\b/i,
    /\bhalt\b/i,
    /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
    /\bservice\s+\S+\s+(start|stop|restart)/i,
    /\bkillall\b/i,
    /\bpkill\b/i,
    /\bkill\s+(-9|-SIGKILL)\b/i,
  ],
  
  // Dangerous permissions
  dangerousPermissions: [
    /\b(chmod|chown)\b.*777/i,
    /\bchmod\b.*[0-7]77/i,
    /\bchmod\b.*a\+w/i,
    /\bchown\b.*:.*/i,
  ],
  
  // Fork bombs and resource exhaustion
  resourceExhaustion: [
    /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*;\s*:\s*\}/,
    /while\s+true/,
    /for\s*\(\s*\)/,
    /\b(yes|cat|dd)\s+\/dev\/zero/,
    /\b(yes|cat|dd)\s+\/dev\/random/,
  ],
  
  // Package managers (install/uninstall)
  packageManagers: [
    /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
    /\byarn\s+(add|remove|install|publish)/i,
    /\bpnpm\s+(add|remove|install|publish)/i,
    /\bpip\s+(install|uninstall)/i,
    /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
    /\bbrew\s+(install|uninstall|upgrade)/i,
    /\bcargo\s+(install|uninstall)/i,
    /\bgem\s+(install|uninstall)/i,
  ],
  
  // Network and remote execution
  networkDangerous: [
    /\bwget\s+.*\|\s*(sh|bash|zsh)/,
    /\bcurl\s+.*\|\s*(sh|bash|zsh)/,
    /\bcurl\s+.*-o\s*\/\s*tmp\s*\|/,
    /\bnc\s+.*-e\s+\/bin\/bash/,
    /\bssh\s+.*"(rm|dd|shred)"/,
  ],
  
  // File system writing to critical locations
  criticalPathWriting: [
    /\b(mv|cp|dd)\s+.*\s+(\/|~\/\.|\/etc|\/usr|\/bin|\/sbin|\/lib)/,
    /\b>\s*(\/dev\/sd[a-z]|\/dev\/nvme)/,
    /\b>\s*(\/etc\/passwd|\/etc\/shadow)/,
    /\becho\s+.*\s+>\s*(\/etc\/|\/usr\/)/,
  ],
  
  // Git dangerous operations
  gitDangerous: [
    /\bgit\s+push\s+--force/,
    /\bgit\s+reset\s+--hard/,
    /\bgit\s+clean\s+(-f|--force)/,
    /\bgit\s+branch\s+(-D|--delete)/,
    /\bgit\s+remote\s+rm/,
  ],
};

// Severity levels for UI feedback
const SEVERITY_LEVELS = {
  fileDestruction: { level: "CRITICAL", color: "red", icon: "[CRITICAL]" },
  systemControl: { level: "CRITICAL", color: "red", icon: "[CRITICAL]" },
  dangerousPermissions: { level: "HIGH", color: "yellow", icon: "[HIGH]" },
  resourceExhaustion: { level: "CRITICAL", color: "red", icon: "[CRITICAL]" },
  packageManagers: { level: "MEDIUM", color: "yellow", icon: "[MEDIUM]" },
  networkDangerous: { level: "HIGH", color: "yellow", icon: "[HIGH]" },
  criticalPathWriting: { level: "CRITICAL", color: "red", icon: "[CRITICAL]" },
  gitDangerous: { level: "MEDIUM", color: "yellow", icon: "[MEDIUM]" },
};

export default function (pi: ExtensionAPI) {
  let config: PermissionGateConfig = { ...DEFAULT_CONFIG };

  // Ensure log directory exists and resolve log file path
  async function ensureLogSetup(ctx: ExtensionContext) {
    const expandedLogPath = config.logFilePath.replace("~", process.env.HOME || "/");
    const logDir = dirname(expandedLogPath);
    
    try {
      await mkdir(logDir, { recursive: true });
      config.logFilePath = expandedLogPath;
    } catch (error) {
      console.error("Permission Gate: Could not create log directory:", error);
      config.logBlockedCommands = false;
    }
  }

  // Log blocked command
  async function logBlockedCommand(command: string, reason: string, severity: string) {
    if (!config.logBlockedCommands) return;
    
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] BLOCKED (${severity}): ${reason}\nCommand: ${command}\n\n`;
      await appendFile(config.logFilePath, logEntry);
    } catch (error) {
      console.error("Permission Gate: Could not log blocked command:", error);
    }
  }

  // Check if command matches any dangerous pattern
  function checkDangerousCommand(command: string): { 
    isDangerous: boolean; 
    category?: keyof typeof DANGEROUS_PATTERNS; 
    pattern?: RegExp; 
    severity?: string; 
    reason?: string;
  } {
    if (!config.enabled) {
      return { isDangerous: false };
    }

    // Check whitelist first
    if (config.whitelistPatterns.length > 0) {
      const whitelisted = config.whitelistPatterns.some(pattern => {
        try {
          const regex = new RegExp(pattern, "i");
          return regex.test(command);
        } catch {
          return false;
        }
      });
      
      if (whitelisted) {
        return { isDangerous: false };
      }
    }

    // Check custom patterns
    if (config.customPatterns.length > 0) {
      for (const pattern of config.customPatterns) {
        try {
          const regex = new RegExp(pattern, "i");
          if (regex.test(command)) {
            return { 
              isDangerous: true, 
              category: "custom", 
              pattern: regex, 
              severity: "HIGH",
              reason: `Matched custom dangerous pattern: ${pattern}`
            };
          }
        } catch (error) {
          console.error("Permission Gate: Invalid custom pattern:", pattern, error);
        }
      }
    }

    // Check built-in patterns
    for (const [category, patterns] of Object.entries(DANGEROUS_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(command)) {
          const severityKey = category as keyof typeof SEVERITY_LEVELS;
          return { 
            isDangerous: true, 
            category: severityKey, 
            pattern, 
            severity: SEVERITY_LEVELS[severityKey].level,
            reason: `Matched ${category} pattern: ${pattern.source}`
          };
        }
      }
    }

    return { isDangerous: false };
  }

  // Get severity info for UI
  function getSeverityInfo(category: keyof typeof DANGEROUS_PATTERNS | "custom") {
    if (category === "custom") {
      return { level: "HIGH", color: "yellow", icon: "⚠️" };
    }
    return SEVERITY_LEVELS[category];
  }

  // Main tool call interceptor
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    const checkResult = checkDangerousCommand(command);

    if (!checkResult.isDangerous) {
      return undefined;
    }

    const severityInfo = getSeverityInfo(checkResult.category || "custom");

    if (!ctx.hasUI) {
      // Non-interactive mode - block by default if configured
      if (config.autoBlockInNonInteractive) {
        const reason = `Permission Gate: ${checkResult.reason || "Dangerous command blocked"} (${severityInfo.level})`;
        await logBlockedCommand(command, checkResult.reason || "Non-interactive block", severityInfo.level);
        return { block: true, reason };
      }
      // Otherwise allow (user responsibility)
      return undefined;
    }

    // Interactive mode - show confirmation dialog
    const severityBadge = `[${severityInfo.level}]`;
    const message = `${severityBadge} Dangerous Command Detected\n\n` +
                   `Command: ${command}\n\n` +
                   `Reason: ${checkResult.reason}\n\n` +
                   `Allow this command to execute?`;

    const choice = await ctx.ui.select(message, ["Yes, allow once", "No, block", "Always allow this pattern"]);

    switch (choice) {
      case "Yes, allow once":
        return undefined; // Allow execution

      case "No, block":
        await logBlockedCommand(command, checkResult.reason || "User blocked", severityInfo.level);
        return { block: true, reason: `Permission Gate: Blocked by user (${severityInfo.level})` };

      case "Always allow this pattern":
        // Add to whitelist
        if (checkResult.pattern) {
          config.whitelistPatterns.push(checkResult.pattern.source);
          await ctx.ui.notify(`Added pattern to whitelist: ${checkResult.pattern.source}`, "info");
          return undefined; // Allow execution
        }
        return undefined;

      default:
        await logBlockedCommand(command, checkResult.reason || "User blocked", severityInfo.level);
        return { block: true, reason: `Permission Gate: Blocked by user (${severityInfo.level})` };
    }
  });

  // Register configuration commands
  pi.registerCommand("permission-gate", {
    description: "Manage Permission Gate extension",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Permission Gate: Interactive UI required for configuration", "error");
        return;
      }

      const options = [
        "Show status",
        "View blocked commands log",
        "Add custom dangerous pattern",
        "Add whitelist pattern",
        "Clear whitelist"
      ];

      const choice = await ctx.ui.select("Permission Gate Configuration", options);

      switch (choice) {
        case "Show status":
          const status = `Permission Gate Status:\n` +
                         `Enabled: ${extensionEnabled && config.enabled}\n` +
                         `Logging: ${config.logBlockedCommands}\n` +
                         `Log file: ${config.logFilePath}\n` +
                         `Auto-block (non-interactive): ${config.autoBlockInNonInteractive}\n` +
                         `Custom patterns: ${config.customPatterns.length}\n` +
                         `Whitelist patterns: ${config.whitelistPatterns.length}`;
          ctx.ui.notify(status, "info");
          break;

        case "View blocked commands log":
          try {
            const logContent = await pi.read({ path: config.logFilePath });
            if (logContent) {
              ctx.ui.editor({
                title: "Permission Gate - Blocked Commands Log",
                content: logContent,
                readOnly: true,
                language: "log"
              });
            } else {
              ctx.ui.notify("No blocked commands logged yet", "info");
            }
          } catch (error) {
            ctx.ui.notify(`Could not read log file: ${error.message}`, "error");
          }
          break;

        case "Add custom dangerous pattern":
          const pattern = await ctx.ui.input("Enter regex pattern for dangerous command:", {
            placeholder: "e.g., \\bmy-dangerous-command\\b"
          });
          if (pattern) {
            config.customPatterns.push(pattern);
            ctx.ui.notify(`Added custom pattern: ${pattern}`, "success");
          }
          break;

        case "Add whitelist pattern":
          const whitelistPattern = await ctx.ui.input("Enter regex pattern to whitelist:", {
            placeholder: "e.g., \\bsafe-admin-command\\b"
          });
          if (whitelistPattern) {
            config.whitelistPatterns.push(whitelistPattern);
            ctx.ui.notify(`Added whitelist pattern: ${whitelistPattern}`, "success");
          }
          break;

        case "Clear whitelist":
          config.whitelistPatterns = [];
          ctx.ui.notify("Whitelist cleared", "success");
          break;
      }
    }
  });

  // Initialize on session start
  pi.on("session_start", async (event, ctx) => {
    await ensureLogSetup(ctx);
    
    if (event.reason === "startup") {
      ctx.ui.notify("Permission Gate: Always active - protecting your system", "success");
    }
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async (event, ctx) => {
    // Persist configuration if needed in future versions
  });

  // Register a tool to check command safety (for LLM use)
  pi.registerTool({
    name: "check_command_safety",
    label: "Check Command Safety",
    description: "Check if a bash command is safe to execute according to Permission Gate rules",
    parameters: Type.Object({
      command: Type.String({ description: "The bash command to check" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const checkResult = checkDangerousCommand(params.command);
      
      if (!checkResult.isDangerous) {
        return {
          content: [{ type: "text", text: "Command appears safe according to current Permission Gate rules." }],
          details: { safe: true },
        };
      }

      const severityInfo = getSeverityInfo(checkResult.category || "custom");
      
      return {
        content: [{
          type: "text", 
          text: `⚠️ DANGEROUS COMMAND DETECTED (${severityInfo.level}): ${checkResult.reason}`
        }],
        details: { 
          safe: false, 
          reason: checkResult.reason,
          severity: severityInfo.level,
          category: checkResult.category
        },
      };
    },
  });
}