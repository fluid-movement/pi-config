/**
 * Interview UI Feature - Claude-style clarifying questions
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export async function showInterviewUI(ctx: ExtensionContext, question: string, options: string[]): Promise<string | undefined> {
  // Add custom answer option
  const allOptions = [...options, "Other (provide custom answer)"];

  // Show selection dialog
  const choice = await ctx.ui.select(question, allOptions);

  if (choice === "Other (provide custom answer)") {
    // Get custom answer using input dialog
    return await ctx.ui.input("Your answer:", "");
  }

  return choice;
}

export function detectQuestion(content: string): boolean {
  const questionPatterns = [
    "how would you like to proceed?",
    "what is your preference?",
    "which approach do you prefer?",
    "how should we handle this?",
    "what do you think about",
    "would you like me to"
  ];

  return questionPatterns.some(pattern => 
    content.toLowerCase().includes(pattern)
  );
}

export function extractQuestion(text: string): string {
  const questionMatch = text.match(/^(.*?)\n/);
  return questionMatch ? questionMatch[1].trim() : "How would you like to proceed?";
}
