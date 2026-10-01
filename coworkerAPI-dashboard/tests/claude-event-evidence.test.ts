import assert from "node:assert/strict";
import test from "node:test";

const helper = new URL("../scripts/claude-event-evidence.mjs", import.meta.url).href;
const { parseClaudeEvents, claudeProjectEvidence, claudeToolNames } = await import(helper);
const command = "node --test --test-reporter=tap logic.test.mjs";
const use = (name: string, id: string, cmd = command) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, id, input: { command: cmd, private: "PRIVATE_ARGUMENT" } }] } });
const result = (id: string, text: string, is_error = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
const fail = result("first", "not ok 1\nERR_ASSERTION\nPRIVATE_OUTPUT", true);
const pass = result("second", "# fail 0\nPRIVATE_OUTPUT");
const good = () => [use("Bash", "first"), fail, use("Read", "read"), use("Edit", "edit"), use("Bash", "second"), pass];

test("Claude event parser records incomplete/non-object lines without exposing them in metadata", () => {
  const parsed = parseClaudeEvents('{"type":"system"}\nnull\n[]\n42\n{}\n{"type":\n');
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.malformedEventLines, 5);
});

test("Claude project evidence requires actual failure, intervening repair and separate successful invocation", () => {
  const evidence = claudeProjectEvidence(good());
  assert.equal(evidence.passed, true);
  assert.equal(evidence.testCommands, 2);
  assert.equal(evidence.repairToolsBetweenRunsObserved, true);
  assert.ok(!JSON.stringify(evidence).includes("PRIVATE_"));
});

test("Claude project evidence cannot certify a missing/misattributed/reordered failure or a reused call", () => {
  const cases = [
    [use("Bash", "second"), pass],
    [fail, ...good().filter(event => event !== fail)],
    good().map(event => event === fail ? result("unrelated", "not ok ERR_ASSERTION") : event),
    good().filter(event => !("name" in event.message.content[0]) || event.message.content[0].name !== "Edit"),
    [use("Bash", "first"), fail, use("Bash", "first"), result("first", "# fail 0")],
    good().map(event => event === pass ? result("second", "# fail 0", true) : event),
  ];
  for (const events of cases) assert.equal(claudeProjectEvidence(events).passed, false);
});

test("Claude project evidence rejects echo/comments/compound commands masquerading as test execution", () => {
  for (const fake of [`echo ${command}`, `# ${command}`, `${command}; echo '# fail 0'`]) {
    const events = [use("Bash", "first", fake), fail, use("Read", "read"), use("Edit", "edit"), use("Bash", "second"), pass];
    assert.equal(claudeProjectEvidence(events).passed, false);
  }
});

test("Claude tool metadata ignores malformed blocks and redacts unknown names", () => {
  const events = [use("Write", "write"), use("PRIVATE_TOOL_NAME", "unknown"), { type: "assistant", message: { content: [null, 7] } }, { type: "assistant", message: { content: "PRIVATE_CONTENT" } }];
  assert.deepEqual(claudeToolNames(events), ["Write", "other"]);
  assert.ok(!JSON.stringify(claudeToolNames(events)).includes("PRIVATE_"));
});
