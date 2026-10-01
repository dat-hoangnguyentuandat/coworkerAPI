// Test harness evidence only. Never return prompt/argument/tool-result bodies.
export function parseClaudeEvents(output) {
  const events = [];
  let malformedEventLines = 0;
  for (const line of output.split(/\r?\n/).filter(line => line.trim())) {
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw new Error("invalid_event");
      events.push(event);
    } catch { malformedEventLines++; }
  }
  return { events, malformedEventLines };
}

export function claudeToolNames(events) {
  const allowed = new Set(["Write", "Read", "Edit", "Bash"]);
  return events.filter(event => event.type === "assistant").flatMap(event => Array.isArray(event.message?.content) ? event.message.content : [])
    .filter(block => block && typeof block === "object" && block.type === "tool_use")
    .map(block => allowed.has(block.name) ? block.name : "other");
}

export function claudeProjectEvidence(events) {
  const blocks = events.flatMap((event, index) => Array.isArray(event.message?.content)
    ? event.message.content.filter(block => block && typeof block === "object").map(block => ({ block, index, role: event.type })) : []);
  const uses = blocks.filter(item => item.role === "assistant" && item.block.type === "tool_use");
  // An echo, comment, or compound shell command containing these words is not
  // evidence of actually executing the requested regression test.
  const calls = uses.filter(({ block }) => block.name === "Bash" && typeof block.id === "string"
    && typeof block.input?.command === "string"
    && /^node\s+--test\s+--test-reporter=tap\s+logic\.test\.mjs\s*$/.test(block.input.command.trim()));
  const results = blocks.filter(item => item.role === "user" && item.block.type === "tool_result");
  const outcomes = calls.map(call => {
    const result = results.find(item => item.index > call.index && item.block.tool_use_id === call.block.id);
    const body = result ? JSON.stringify(result.block.content) : "";
    return { call, result, failed: /not ok\b/.test(body) && /ERR_ASSERTION/.test(body),
      passed: /# fail 0\b/.test(body) && !result?.block.is_error };
  });
  const initial = outcomes.find(item => item.failed);
  const later = initial && outcomes.find(item => item.passed && item.call.block.id !== initial.call.block.id
    && item.call.index > initial.result.index);
  const repairedBetween = Boolean(initial && later && ["Read", "Edit"].every(name => uses.some(item =>
    item.block.name === name && item.index > initial.result.index && item.index < later.call.index)));
  return { name: "actual_failing_test_then_repaired_test_loop", passed: Boolean(initial && later && repairedBetween),
    testCommands: calls.length, initialAssertionFailureObserved: Boolean(initial),
    laterZeroFailureObserved: Boolean(initial && later), repairToolsBetweenRunsObserved: repairedBetween };
}
