import assert from "node:assert/strict";

import {
  hasConciseAcknowledgementPolicy,
  patchConversationFlow
} from "./conversation-flow.patch.js";

const fixture = `
export async function executeSarvamCall({ runContactId, attemptCycleId }) {
  const prepared = await prepareSarvamExecution({
    runContactId,
    attemptCycleId
  });
  return createInstantOutboundCall({
    agentVariables: prepared.inputVariables
  });
}
`;

const first = patchConversationFlow(fixture);
assert.equal(first.changed, true);
assert.equal(hasConciseAcknowledgementPolicy(first.source), true);
assert.match(first.source, /two to five words/);
assert.match(first.source, /Never repeat, paraphrase, summarize/);
assert.match(first.source, /Do not probe a complete answer/);
assert.match(first.source, /agentVariables: prepared\.inputVariables/);

const second = patchConversationFlow(first.source);
assert.equal(second.changed, false);
assert.equal(second.source, first.source);

assert.throws(
  () => patchConversationFlow("const prepared = {};"),
  /Expected exactly one/
);

console.log("Sarvam concise acknowledgement policy tests passed.");
