import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";

const OTHER = "Other (type your own)…";

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  options: Type.Array(Type.String(), {
    minItems: 2,
    maxItems: 4,
    description: "2-4 choices; index 0 = strongest recommendation",
  }),
  allowCustom: Type.Optional(
    Type.Boolean({ description: "Append a free-text option. Defaults to true." })
  ),
});

const askUserTool = defineTool({
  name: "ask_user",
  label: "Ask user",
  description:
    "Present the user with 1-4 clarifying questions, each with 2-3 options. " +
    "The first option is always the strongest recommendation. " +
    "Use this whenever you need clarification rather than asking inline in chat.",
  promptSnippet:
    "ask_user — present 1-4 clarifying questions with 2-3 options each in a bordered selector; prefer this over asking inline.",
  promptGuidelines: [
    "Use `ask_user` whenever you would otherwise ask a multiple-choice clarifying question. " +
      "Put your strongest recommendation as the first option. " +
      "Keep each question focused on one decision.",
  ],
  parameters: Type.Object({
    questions: Type.Array(QuestionSchema, {
      minItems: 1,
      maxItems: 4,
      description: "1-4 questions to ask sequentially",
    }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
    if (!ctx.hasUI) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Interview UI unavailable in this mode; ask the question in plain text instead.",
          },
        ],
        isError: true,
      };
    }

    const answers: Array<{ question: string; answer: string }> = [];

    for (const item of params.questions) {
      const allowCustom = item.allowCustom !== false;

      const displayOptions = item.options.map((opt, i) =>
        i === 0 ? `${opt} (recommended)` : opt
      );
      if (allowCustom) displayOptions.push(OTHER);

      let answer: string | undefined;

      while (answer === undefined) {
        const picked = await ctx.ui.select(item.question, displayOptions);

        if (picked === undefined) {
          return {
            content: [{ type: "text" as const, text: "User cancelled the interview." }],
            isError: true,
          };
        }

        if (picked === OTHER) {
          // Pin the question above the editor while the text input is open.
          ctx.ui.setWidget("interview-question", [`  ${item.question}`], { placement: "aboveEditor" });
          // ESC in the input → loop back to the selector for this question.
          const typed = await ctx.ui.input(item.question, "Type your answer…");
          ctx.ui.setWidget("interview-question", undefined);
          if (typed !== undefined) answer = typed;
        } else {
          // Strip the " (recommended)" suffix we added to the first option.
          answer = picked.replace(/ \(recommended\)$/, "");
        }
      }

      answers.push({ question: item.question, answer });
    }

    const text = answers
      .map(({ question, answer }) => `Q: ${question}\nA: ${answer}`)
      .join("\n\n");
    return {
      content: [{ type: "text" as const, text }],
      isError: false,
    };
  },
});

const INTERVIEW_PROMPT =
  "When you need to ask the user a clarifying question with multiple choices, " +
  "you MUST call the `ask_user` tool instead of writing the question inline in your response. " +
  "Never list options in chat — always use `ask_user`.";

export default function interviewExtension(pi: ExtensionAPI): void {
  pi.registerTool(askUserTool);

  pi.on("before_agent_start", async (event, _ctx) => ({
    systemPrompt: event.systemPrompt + "\n\n" + INTERVIEW_PROMPT,
  }));

  pi.on("message_end", async (event, _ctx) => {
    const msg = event.message as any;
    if (msg.role !== "assistant") return;
    if (!Array.isArray(msg.content)) return;

    // Only act when the model actually called ask_user.
    const hasAskUser = msg.content.some(
      (c: any) => c.type === "tool_use" && c.name === "ask_user"
    );
    if (!hasAskUser) return;

    // Blank any preamble text so only the interactive widget is shown.
    const stripped = msg.content.map((c: any) =>
      c.type === "text" ? { ...c, text: "" } : c
    );
    return { message: { ...msg, content: stripped } };
  });

}
