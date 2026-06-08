# Tool-calling (OpenAI function-calling) support

The bridge now translates OpenAI function-calling so harnesses like **Kilo Code**
can actually read/write files and run terminal commands through Notion AI.

## How it works

Notion AI's transcript endpoint does not accept OpenAI tool schemas and never
emits OpenAI `tool_calls`. We emulate the protocol in prompt space:

1. **Inbound** — when the request has a `tools` array, `buildToolInstructions()`
   renders each tool (name, description, JSON-Schema params) into a text
   protocol injected into the prompt. The model is told to emit:

   ```
   <tool_call>{"name": "read_file", "arguments": {"path": "package.json"}}</tool_call>
   ```

2. **Outbound** — `parseToolCalls()` scans the model output, extracts those
   blocks, and converts them into OpenAI `tool_calls` objects. The response uses
   `finish_reason: "tool_calls"` so the harness executes them and loops back.

3. **History** — prior assistant `tool_calls` + `tool` result messages are
   re-serialized into the same syntax so multi-turn agentic loops stay coherent.

### Streaming note
When `tools` are present, streaming buffers the full response first (partial
JSON mid-stream is unparseable), then emits `tool_calls` deltas. Plain chat
(no tools) still streams token-by-token as before.

## Config toggle

In `config.json` you can disable the feature:

```json
{ "server": { "toolCalling": false } }
```

(Defaults to enabled. Honored via `config.toolCalling !== false`.) It also
auto-disables for a single request when `tool_choice: "none"`.

## Reliability

This is prompt-based emulation — it depends on the model following the format.
Strong models (Opus 4.x, GPT-5.x) follow it reliably. The parser is defensive:
it tolerates code fences, stray prose around the block, and minor JSON drift,
and will NOT false-positive on ordinary prose that happens to contain braces.

## Kilo Code setup

- Point Kilo at the bridge as an OpenAI-compatible provider (base URL + key).
- Keep native/function-calling tool use ON in Kilo — the bridge now speaks it.
- Recommended: raise Max Output Tokens; allow terminal + file write in Kilo.
