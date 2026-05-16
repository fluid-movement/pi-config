---
description: Best practices and patterns for building pi extensions — layout, lifecycle events, state management, tool interception, UI, and common pitfalls.
---

# Pi Extension Best Practices

Reference document for building pi extensions in this repo. Distilled from the official
`earendil-works/pi` examples and the canonical `docs/extensions.md`.

---

## 1. Quick Reference

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => { /* restore state */ });
  pi.on("before_agent_start", async (event, _ctx) => ({
    systemPrompt: event.systemPrompt + "\n\nExtra instructions.",
  }));
  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName === "bash") return { block: true, reason: "not allowed" };
  });
  pi.registerTool({ name: "my_tool", label: "My Tool", description: "...",
    parameters: Type.Object({ action: StringEnum(["list", "add"] as const) }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      return { content: [{ type: "text", text: "done" }], details: {} };
    },
  });
  pi.registerCommand("cmd", { description: "...", handler: async (args, ctx) => {
    ctx.ui.notify(`hello ${args}`, "info");
  }});
}
```

**Packages:**

| Package | What for |
|---------|----------|
| `@earendil-works/pi-coding-agent` | `ExtensionAPI`, `ExtensionContext`, events, `withFileMutationQueue`, truncation utils |
| `typebox` | `Type.Object` schema for tool parameters |
| `@earendil-works/pi-ai` | `StringEnum` (Google-compatible enum), `TextContent` |
| `@earendil-works/pi-tui` | `Key`, `Text`, TUI components for custom rendering |

---

## 2. Project Layout

| Layout | When to use |
|--------|-------------|
| `extensions/my-ext.ts` (single file) | Simple extensions — no `package.json` or subfolder needed |
| `extensions/my-ext/index.ts` | Multi-module extensions; add helper `.ts` files next to `index.ts` |
| `extensions/my-ext/package.json` + `node_modules/` | Extensions that need npm packages |

For `/reload` to work, the extension must live in an auto-discovered path:
- `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts` — global
- `.pi/extensions/*.ts` or `.pi/extensions/*/index.ts` — project-local

**Single-file extensions** (`*.ts`) are auto-discovered with no configuration — just drop
the file. No `package.json` needed.

**Directory extensions** need a `package.json` so pi finds the entry point:

```json
{ "name": "my-ext", "pi": { "extensions": ["./index.ts"] } }
```

See §12 for type-checking setup (`deno.json`) for both layouts.

---

## 3. Lifecycle Event Map

```
session_start ──────────────────────── restore in-memory state from appendEntry / details
  └── resources_discover               contribute skill/prompt/theme paths

user submits prompt
  ├── input                            intercept/transform raw input before skill expansion
  ├── before_agent_start               inject system prompt or persistent session message
  ├── agent_start
  │   ┌── turn loop ─────────────────┐
  │   │  context                     │  prune / reorder messages before each LLM call
  │   │  tool_execution_start        │
  │   │  tool_call ◄── CAN BLOCK     │  return { block: true, reason } to reject
  │   │  tool_result ◄── CAN MODIFY  │  return partial { content, details, isError }
  │   │  turn_end                    │
  │   └─────────────────────────────-┘
  └── agent_end

/fork or /resume → session_shutdown → session_start (reason: "fork" | "resume")
exit             → session_shutdown
```

Key return shapes:

| Event | Useful return |
|-------|---------------|
| `before_agent_start` | `{ systemPrompt, message: { customType, content, display } }` |
| `tool_call` | `{ block: true, reason: "..." }` |
| `tool_result` | `{ content, details, isError }` (partial patch) |
| `context` | `{ messages: filteredMessages }` |
| `session_before_switch` | `{ cancel: true }` |

---

## 4. State Management

### Tool-attached state (survives `/fork` and `/resume`)

Store state in tool result `details`. Rebuild on `session_start` from `getBranch()`:

```typescript
pi.on("session_start", async (_event, ctx) => {
  items = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "toolResult"
        && entry.message.toolName === "my_tool") {
      items = entry.message.details?.items ?? [];
    }
  }
});

// In execute():
return { content: [...], details: { items: [...items] } };
```

### Non-tool state (`appendEntry`)

Use when there is no custom tool to hang details on (e.g., mode flags, toggle state):

```typescript
pi.appendEntry("my-key", { active: true });

// Restore on session_start:
const last = [...ctx.sessionManager.getEntries()]
  .reverse()
  .find(e => e.type === "custom" && e.customType === "my-key") as any;
if (last?.data?.active) { /* restore */ }
```

`appendEntry` entries do NOT appear in LLM context. They survive `/resume` and `/fork`.

---

## 5. Tool Interception Over Tool Removal

**Prefer `tool_call` interception to `setActiveTools` for safety policies.**

`pi.setActiveTools(["read", "bash"])` removes tools from the prompt, but bash itself is a
backdoor — the agent can still redirect output (`echo foo > file`), run `git commit`, pipe
to destructive commands, etc.

Interception closes the backdoor:

```typescript
pi.on("tool_call", async (event, _ctx) => {
  if (!modeActive) return;
  switch (event.toolName) {
    case "write":
    case "edit":
      return { block: true, reason: "Mode active — mutations not allowed." };
    case "bash":
      return decideBash(event.input.command as string);
  }
});
```

Build explicit allow/block regex sets for bash. Always check block patterns first:

```typescript
const BLOCKED = [/>{1,2}/, /[;`]|\$\(/, /^\s*git\s+(commit|push|pull|merge|reset)\b/];
const ALLOWED = [/^\s*(ls|cat|head|tail|grep|find|git\s+(status|log|diff))\b/];

function decideBash(cmd: string) {
  if (BLOCKED.some(p => p.test(cmd))) return { block: true, reason: "mutates state" };
  if (ALLOWED.some(p => p.test(cmd))) return { block: false };
  return { block: true, reason: "not in allowlist" };
}
```

`setActiveTools` is still useful for *presenting* a reduced tool set to the LLM (fewer
tokens, cleaner prompt) — just don't rely on it alone for safety.

---

## 6. System Prompt Injection

**Per-turn instruction (not stored in session):**

```typescript
pi.on("before_agent_start", async (event, _ctx) => {
  if (!modeActive) return;
  return { systemPrompt: event.systemPrompt + "\n\n" + EXTRA_INSTRUCTIONS };
});
```

**Persistent context (stored in session, sent to LLM every turn):**

```typescript
pi.on("before_agent_start", async (_event, _ctx) => ({
  message: {
    customType: "my-extension",
    content: "Relevant background context...",
    display: true,
  },
}));
```

Messages injected this way appear in the session file. `display: true` shows them in the TUI.
You can return both `systemPrompt` and `message` in the same handler.

---

## 7. Registering Custom Tools

```typescript
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Shown to LLM. Be precise.",
  promptSnippet: "One-line entry in Available tools section",
  promptGuidelines: ["Use my_tool when the user asks for X. Do not use it for Y."],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const), // NOT Type.Union(Type.Literal(...))
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    // Optional: fold legacy schema into current shape before validation.
    // Use when resuming old sessions whose stored args no longer match.
    return args;
  },
  terminate: false, // set true to skip automatic follow-up LLM call after this tool batch
  async execute(_id, params, signal, onUpdate, ctx) {
    const path = resolve(ctx.cwd, params.text ?? "");
    return withFileMutationQueue(path, async () => {
      // ... read-modify-write ...
      return { content: [{ type: "text", text: "done" }], details: {} };
    });
  },
});
```

Key rules:
- **`StringEnum` not `Type.Union(Type.Literal(...))`** — Google's API rejects the latter.
- **`withFileMutationQueue` is mandatory** when the tool writes files. Tool calls run in
  parallel; without the queue two tools can both read the old file and the last write wins.
  Pass the resolved absolute path, not the raw user argument.
- **Throw to signal errors.** Returning a value never sets `isError: true`. Only `throw` does.
- **`promptGuidelines` bullets name the tool explicitly.** They're appended flat with no prefix;
  "Use this tool when..." is ambiguous. Write "Use my_tool when...".

---

## 8. Output Truncation

Built-in limit: **50 KB / 2000 lines**. Always truncate custom tool output:

```typescript
import {
  truncateHead, truncateTail, truncateLine,
  DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize,
} from "@earendil-works/pi-coding-agent";

const t = truncateHead(rawOutput, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
let result = t.content;
if (t.truncated) {
  result += `\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines shown (${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)})]`;
}
return { content: [{ type: "text", text: result }] };
```

- `truncateHead` — keep the beginning (search results, file reads).
- `truncateTail` — keep the end (logs, command output).
- Tell the LLM when output is truncated and where the full version is.

---

## 9. UI Patterns

```typescript
// Always check ctx.hasUI before blocking dialogs (false in -p / JSON mode)
if (ctx.hasUI) {
  const ok = await ctx.ui.confirm("Title", "Body");
  const choice = await ctx.ui.select("Pick:", ["A", "B", "C"]);
  const text = await ctx.ui.input("Label:", "placeholder");
  const body = await ctx.ui.editor("Edit:", "prefill");
}

// Non-blocking (safe without hasUI check)
ctx.ui.notify("message", "info");   // levels: "info" | "warning" | "error"
ctx.ui.setStatus("key", ctx.ui.theme.fg("warning", "ACTIVE")); // footer badge
ctx.ui.setStatus("key", undefined); // clear
ctx.ui.setWidget("key", ["Line 1", "Line 2"]); // widget above editor (default)
ctx.ui.setWidget("key", ["..."], { placement: "belowEditor" });
ctx.ui.setWidget("key", undefined); // clear
```

Theme color palette: `accent` / `success` / `error` / `warning` / `muted` / `dim` /
`borderMuted` / `toolTitle`. Usage: `ctx.ui.theme.fg("accent", text)`.

Timed dialogs: pass `{ timeout: 5000 }` as third arg — auto-dismisses with countdown.
`confirm` returns `false` on timeout; `select` and `input` return `undefined`.

---

## 10. Commands, Shortcuts, Flags

```typescript
// Command: /mycommand [args]
pi.registerCommand("mycommand", {
  description: "Short description shown in /help",
  handler: async (args, ctx) => { /* ExtensionCommandContext — has ctx.waitForIdle() */ },
});

// Keyboard shortcut
import { Key } from "@earendil-works/pi-tui";
pi.registerShortcut("ctrl+alt+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => { toggle(ctx); },
});

// CLI flag: pi --my-flag
pi.registerFlag("my-flag", { description: "...", type: "boolean", default: false });
// Read with: pi.getFlag("my-flag")
```

Use **commands** for user-typed `/foo` interactions.
Use **shortcuts** for keyboard bindings (requires `Key` from `@earendil-works/pi-tui`).
Use **flags** for initial state set at CLI launch.

Command handlers receive `ExtensionCommandContext` (superset of `ExtensionContext`) which
adds `ctx.waitForIdle()`, `ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()`, and
`ctx.reload()`. Do not call these from event handlers — they can deadlock.

---

## 11. Error Handling

- **`tool_call` errors** block with fail-safe (the tool call is blocked, error shown).
- **Tool `execute` errors**: `throw` to mark the result `isError: true`. Returning a value
  never sets the error flag regardless of what properties the object has.
- **Extension top-level errors**: logged but do not crash the agent.
- **Event handler errors**: swallowed per-handler; other handlers still run.

```typescript
async execute(_id, params) {
  if (!isValid(params.input)) throw new Error(`Invalid: ${params.input}`); // correct
  return { content: [...], details: {} };
}
```

---

## 12. Local Type-Checking with Deno

Pi uses [jiti](https://github.com/unjs/jiti) at runtime — no compilation needed. For
editor type-checking, add a `deno.json` with the import map.

**Single-file extension** (`extensions/my-ext.ts`) — place `deno.json` in the
`extensions/` directory itself and check from there:

```bash
# extensions/deno.json
{ "imports": { "@earendil-works/pi-coding-agent": "file:///Users/<you>/..." } }

cd agent/extensions
deno check my-ext.ts
```

**Directory extension** (`extensions/my-ext/index.ts`) — place `deno.json` inside
the extension directory and check from there:

```bash
cd agent/extensions/my-ext
deno check index.ts
```

`deno.json` for both cases:

```json
{
  "imports": {
    "@earendil-works/pi-coding-agent": "file:///Users/<you>/.vite-plus/packages/@earendil-works/pi-coding-agent/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts"
  }
}
```

Run `deno check` (not `deno check --all`) to avoid internal dep conflicts inside pi's
own transitive dependencies (e.g., `MessagePort` mismatch between Deno's web APIs and
`node:worker_threads`). Those errors are not in your code.

**Find the correct `.d.ts` path:**

```bash
find ~/.vite-plus -name "index.d.ts" -path "*/pi-coding-agent/dist/*" 2>/dev/null
```

---

## 13. Common Pitfalls

| Don't | Do instead |
|-------|-----------|
| `import from "@mariozechner/pi-coding-agent"` | Use `@earendil-works/pi-coding-agent` |
| `event.input.command` (untyped) | Cast: `event.input.command as string` or use `isToolCallEventType("bash", event)` for full typed narrowing |
| `Type.Union(Type.Literal("a"), Type.Literal("b"))` for enums | `StringEnum(["a", "b"] as const)` from `@earendil-works/pi-ai` |
| Mutate files in custom tools without queue | Wrap with `withFileMutationQueue(absolutePath, async () => { ... })` |
| Store mode state only in a closure variable | Also persist via `pi.appendEntry(key, data)` so `/fork` and `/resume` restore it |
| `await ctx.ui.confirm(...)` without guard | Check `ctx.hasUI` first |
| Return large tool output without truncation | Use `truncateHead` / `truncateTail` from the package |
| Rely on `setActiveTools` alone to block dangerous operations | Intercept via `tool_call` (bash is a backdoor through `setActiveTools`) |
| Place extension outside auto-discovered paths | Use `~/.pi/agent/extensions/` or `.pi/extensions/` for `/reload` support |
| Parallel tool calls — two custom tools writing the same file | Use `withFileMutationQueue` to serialize per-file writes |

---

## 14. Inter-Extension Communication

Extensions share an event bus via `pi.events`:

```typescript
// Emitter extension
pi.events.emit("myext:status-change", { active: true, from: "plan-mode" });

// Listener extension
pi.events.on("myext:status-change", (data) => {
  const { active } = data as { active: boolean };
  currentCtx?.ui.notify(`Status changed: ${active}`, "info");
});
```

**Always namespace events** with `yourext:event-name` to avoid collisions with other extensions.
The `pi.events` bus is not persisted — listeners fire only for events emitted in the same session.
