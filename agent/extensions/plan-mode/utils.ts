/**
 * Utility functions for Plan Mode extension
 */

import { SAFE_COMMAND_PATTERNS, UNSAFE_SHELL_CHARS, REDIRECT_PATTERN } from './types';

const UNSAFE_PIPE_PATTERNS: RegExp[] = [
  /\|\s*rm\b/,
  /\|\s*xargs.*rm\b/,
  /\|\s*sudo\b/,
  /\|\s*chmod\b/,
  /\|\s*chown\b/,
  /\|\s*mv\b/,
  /\|\s*cp\b/,
  /\|\s*wget\b/,
  /\|\s*curl\b/,
];

export function hasUnsafePipe(command: string): boolean {
  return UNSAFE_PIPE_PATTERNS.some((p) => p.test(command));
}

export function isWhitelisted(command: string): boolean {
  const trimmed = command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
  if (UNSAFE_SHELL_CHARS.test(trimmed)) return false;
  if (REDIRECT_PATTERN.test(trimmed)) return false;
  if (hasUnsafePipe(trimmed)) return false;
  return SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed));
}

export function getBashOverride(entries: any[], command: string): boolean {
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "plan-mode-bash-override") {
      if (entry.data?.command === command) return true;
    }
  }
  return false;
}

export function getAssistantContent(message: any): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }
  return '';
}

export function extractTodoItems(text: string): { step: number; text: string; completed: boolean }[] {
  const items: { step: number; text: string; completed: boolean }[] = [];
  const lines = text.split('\n');
  let inPlanSection = false;

  for (const line of lines) {
    if (line.toLowerCase().includes('plan:')) {
      inPlanSection = true;
      continue;
    }

    if (inPlanSection) {
      const match = line.match(/^(\d+)\..*$/);
      if (match) {
        items.push({
          step: parseInt(match[1]),
          text: line.substring(match[0].length).trim(),
          completed: false,
        });
      }
    }
  }

  return items;
}

export function markCompletedSteps(text: string, items: { step: number; text: string; completed: boolean }[]): number {
  let marked = 0;
  const matches = text.matchAll(/\\[DONE:(\d+)\\]/gi);

  for (const match of matches) {
    const stepNum = parseInt(match[1]);
    const item = items.find((i) => i.step === stepNum);
    if (item && !item.completed) {
      item.completed = true;
      marked++;
    }
  }

  return marked;
}
