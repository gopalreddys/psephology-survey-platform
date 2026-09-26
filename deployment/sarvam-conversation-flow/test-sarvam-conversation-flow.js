import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assert.match(first.source, /opening is permanently complete/);
assert.match(first.source, /never restart the opening sequence/);
assert.match(first.source, /Do not probe a complete answer/);
assert.match(first.source, /requiredRuntimeVariables/);
assert.match(first.source, /Sarvam runtime context is incomplete/);
assert.match(first.source, /Mentioning a student wing/);
assert.match(first.source, /Continue in preferred_language/);
assert.match(first.source, /knowledge_context for factual clarification/);
assert.match(first.source, /questionnaire_context/);
assert.match(first.source, /agentVariables: prepared\.inputVariables/);

const second = patchConversationFlow(first.source);
assert.equal(second.changed, false);
assert.equal(second.source, first.source);

const legacy = first.source
  .replaceAll("SARVAM_CONVERSATION_STATE_V3", "SARVAM_CONVERSATION_STATE_V2");
const upgraded = patchConversationFlow(legacy);
assert.equal(upgraded.changed, true);
assert.equal(hasConciseAcknowledgementPolicy(upgraded.source), true);
assert.equal(upgraded.source.includes("SARVAM_CONCISE_ACKNOWLEDGEMENT_V1"), false);
assert.equal(
  upgraded.source.match(/prepared\.inputVariables\s*=\s*\{/g)?.length,
  1
);

assert.throws(
  () => patchConversationFlow("const prepared = {};"),
  /Expected exactly one/
);

const diagnostic = readFileSync(
  new URL("./diagnose-repeated-opening.js", import.meta.url),
  "utf8"
);
assert.match(diagnostic, /providerSubmissionPerformed: false/);
assert.match(diagnostic, /contactsWithDuplicateProviderStarts/);
assert.match(diagnostic, /contactsWithRepeatedOpeningInsideOneInteraction/);
assert.doesNotMatch(diagnostic, /full_name|phone_number/);

console.log("Sarvam one-time opening and conversation-state policy tests passed.");
