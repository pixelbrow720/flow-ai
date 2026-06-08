import {
  buildToolInstructions,
  formatToolCallsAsText,
  parseToolCalls,
} from "./src/tool-calling.js";

let pass = 0,
  fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log("  PASS " + name);
  } else {
    fail++;
    console.log("  FAIL " + name);
  }
}

// 1) buildToolInstructions renders schema + protocol
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from disk",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: { name: "list_files", description: "List dir", parameters: {} },
  },
];
const instr = buildToolInstructions(tools, "auto");
console.log("--- buildToolInstructions ---");
ok("mentions read_file", instr.includes("read_file"));
ok("mentions list_files", instr.includes("list_files"));
ok("includes protocol tag", instr.includes("<tool_call>"));
ok("includes schema json", instr.includes('"path"'));
ok("none => empty", buildToolInstructions(tools, "none") === "");
ok("no tools => empty", buildToolInstructions([], "auto") === "");
ok(
  "required => MUST call",
  buildToolInstructions(tools, "required").includes("MUST call at least one")
);
ok(
  "forced fn => MUST call name",
  buildToolInstructions(tools, { type: "function", function: { name: "read_file" } }).includes(
    "`read_file`"
  )
);

// 2) parseToolCalls — clean single block
console.log("--- parseToolCalls: single ---");
const r1 = parseToolCalls(
  '<tool_call>{"name": "read_file", "arguments": {"path": "package.json"}}</tool_call>'
);
ok("one call", r1.toolCalls.length === 1);
ok("name ok", r1.toolCalls[0].function.name === "read_file");
ok("args is string", typeof r1.toolCalls[0].function.arguments === "string");
ok(
  "args parse back",
  JSON.parse(r1.toolCalls[0].function.arguments).path === "package.json"
);
ok("id present", /^call_/.test(r1.toolCalls[0].id));
ok("cleaned empty", r1.cleanedText === "");

// 3) multiple blocks + surrounding prose
console.log("--- parseToolCalls: multiple + prose ---");
const r2 = parseToolCalls(
  'Let me do that.\n<tool_call>{"name":"read_file","arguments":{"path":"a.js"}}</tool_call>\n<tool_call>{"name":"read_file","arguments":{"path":"b.js"}}</tool_call>'
);
ok("two calls", r2.toolCalls.length === 2);
ok("cleaned keeps prose", r2.cleanedText.includes("Let me do that."));

// 4) code-fence wrapped json inside block
console.log("--- parseToolCalls: fenced ---");
const r3 = parseToolCalls(
  '<tool_call>\n```json\n{"name":"list_files","arguments":{}}\n```\n</tool_call>'
);
ok("fenced parses", r3.toolCalls.length === 1 && r3.toolCalls[0].function.name === "list_files");

// 5) bare json fallback (no tags)
console.log("--- parseToolCalls: bare fallback ---");
const r4 = parseToolCalls('{"name": "read_file", "arguments": {"path": "x"}}');
ok("bare json => call", r4.toolCalls.length === 1);

// 6) plain prose => NO tool calls (no false positive)
console.log("--- parseToolCalls: plain prose ---");
const r5 = parseToolCalls(
  "Here is the explanation of your package.json: it defines name and scripts."
);
ok("prose => 0 calls", r5.toolCalls.length === 0);
ok("prose => text preserved", r5.cleanedText.includes("explanation"));

// 7) round-trip: format history then re-parse
console.log("--- formatToolCallsAsText round-trip ---");
const hist = [
  { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"p.json"}' } },
];
const asText = formatToolCallsAsText(hist);
const r6 = parseToolCalls(asText);
ok("roundtrip name", r6.toolCalls[0].function.name === "read_file");
ok("roundtrip arg", JSON.parse(r6.toolCalls[0].function.arguments).path === "p.json");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
