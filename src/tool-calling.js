/**
 * Prompt-based OpenAI function-calling (tools) emulation for the Notion bridge.
 *
 * Notion AI's transcript endpoint does NOT accept arbitrary OpenAI tool schemas
 * and never emits OpenAI-format `tool_calls`. Harnesses like Kilo Code send a
 * `tools` array and expect structured `tool_calls` back so they can execute
 * file/terminal operations. Without this, the model has no callable tools and
 * just asks the user to paste files manually.
 *
 * This module bridges that gap WITHOUT inventing unverified Notion event types:
 *   • buildToolInstructions(): renders the OpenAI tool schemas into a plain-text
 *     protocol that we inject into the prompt. The model is told to emit a
 *     <tool_call>{json}</tool_call> block when it wants to call a tool.
 *   • formatToolCallsAsText(): renders prior assistant tool_calls back into the
 *     same syntax so multi-turn agentic loops stay consistent.
 *   • parseToolCalls(): scans the model's text output, extracts those blocks,
 *     and converts them into OpenAI `tool_calls` objects.
 *
 * Reliability depends on the model following the format; strong models (Opus,
 * GPT-5.x) follow it well. The parser is defensive: it tolerates code fences,
 * stray prose, and minor JSON drift.
 */

import { randomUUID } from "node:crypto";

export const TOOL_OPEN = "<tool_call>";
export const TOOL_CLOSE = "</tool_call>";

function shortId() {
  return "call_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

/**
 * Build the text protocol describing the available tools. Returns "" when there
 * are no tools, or when tool_choice is "none" (caller should not advertise tools).
 */
export function buildToolInstructions(tools, toolChoice) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  if (toolChoice === "none") return "";

  const lines = [];
  lines.push("TOOL-CALLING PROTOCOL.");
  lines.push(
    "You can call tools. To call one, output a block in EXACTLY this format:"
  );
  lines.push(`${TOOL_OPEN}{"name": "<tool_name>", "arguments": { ... }}${TOOL_CLOSE}`);
  lines.push("");
  lines.push("Rules:");
  lines.push(
    "- `arguments` MUST be one valid JSON object matching the tool's parameter schema. Use {} when the tool takes no arguments."
  );
  lines.push(
    `- To call several tools in one turn, emit multiple ${TOOL_OPEN}...${TOOL_CLOSE} blocks back to back.`
  );
  lines.push(
    `- When you call a tool, output ONLY the ${TOOL_OPEN} block(s): no prose before/after, no markdown code fences.`
  );
  lines.push(
    "- The harness executes the tool and returns the result as a following Tool message. Then continue."
  );
  lines.push(
    "- When the task is fully done and you need no tool, reply with your final answer as plain text (no tool_call block)."
  );
  lines.push("");
  lines.push("Available tools:");
  for (const t of tools) {
    const fn = (t && t.function) || t;
    if (!fn || !fn.name) continue;
    const desc = fn.description ? ` — ${fn.description}` : "";
    let params = "{}";
    try {
      params = JSON.stringify(fn.parameters ?? {});
    } catch {
      params = "{}";
    }
    lines.push(`- ${fn.name}${desc}`);
    lines.push(`  parameters (JSON Schema): ${params}`);
  }

  if (toolChoice === "required" || toolChoice === "any") {
    lines.push("");
    lines.push("You MUST call at least one tool this turn.");
  } else if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.function &&
    toolChoice.function.name
  ) {
    lines.push("");
    lines.push(`You MUST call the tool \`${toolChoice.function.name}\` this turn.`);
  }

  return lines.join("\n");
}

/**
 * Render prior assistant tool_calls (from conversation history) back into the
 * same <tool_call> syntax, so the model sees a consistent loop.
 */
export function formatToolCallsAsText(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return "";
  return toolCalls
    .map((tc) => {
      const name = (tc.function && tc.function.name) || tc.name || "unknown";
      let args = (tc.function && tc.function.arguments) ?? tc.arguments ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          /* leave as raw string */
        }
      }
      return `${TOOL_OPEN}${JSON.stringify({ name, arguments: args })}${TOOL_CLOSE}`;
    })
    .join("\n");
}

function stripFences(s) {
  let out = s.trim();
  // ```json ... ``` or ``` ... ```
  const fence = /^```[a-zA-Z0-9]*\s*([\s\S]*?)\s*```$/;
  const mm = out.match(fence);
  if (mm) out = mm[1].trim();
  return out;
}

function safeParseObject(raw) {
  if (!raw) return null;
  let s = stripFences(raw);
  try {
    return JSON.parse(s);
  } catch {
    /* try to slice the first balanced-looking object */
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = s.slice(first, last + 1);
    try {
      return JSON.parse(sliced);
    } catch {
      return null;
    }
  }
  return null;
}

function toOpenAiToolCall(parsed) {
  if (!parsed) return null;
  const name = parsed.name || parsed.tool || parsed.function || parsed.tool_name;
  if (!name) return null;
  let args = parsed.arguments ?? parsed.args ?? parsed.parameters ?? parsed.input ?? {};
  if (typeof args !== "string") {
    try {
      args = JSON.stringify(args);
    } catch {
      args = "{}";
    }
  }
  return {
    id: shortId(),
    type: "function",
    function: { name: String(name), arguments: args },
  };
}

/**
 * Extract OpenAI-format tool_calls from the model's text output.
 * Returns { toolCalls, cleanedText }. cleanedText is the prose with the
 * tool_call blocks removed (may be empty).
 */
export function parseToolCalls(text) {
  if (!text || typeof text !== "string") {
    return { toolCalls: [], cleanedText: text || "" };
  }

  const calls = [];
  let cleaned = text;
  const re = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) matches.push(m);

  if (matches.length > 0) {
    for (const mm of matches) {
      const parsed = safeParseObject(mm[1]);
      const call = toOpenAiToolCall(parsed);
      if (call) calls.push(call);
      cleaned = cleaned.replace(mm[0], "");
    }
    return { toolCalls: calls, cleanedText: cleaned.trim() };
  }

  // Fallback: a bare/fenced JSON object that looks like a tool call and nothing
  // else of substance. Only trigger when the whole message is basically the
  // object (avoid false positives on normal prose containing braces).
  const trimmed = stripFences(text).trim();
  if (
    trimmed.startsWith("{") &&
    trimmed.endsWith("}") &&
    /"name"\s*:/.test(trimmed) &&
    /"arguments"\s*:|"args"\s*:|"parameters"\s*:/.test(trimmed)
  ) {
    const parsed = safeParseObject(trimmed);
    const call = toOpenAiToolCall(parsed);
    if (call) return { toolCalls: [call], cleanedText: "" };
  }

  return { toolCalls: [], cleanedText: text };
}
