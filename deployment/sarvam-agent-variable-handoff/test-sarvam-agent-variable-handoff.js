import assert from "node:assert/strict";

import {
  hasCorrectAgentVariableHandoff,
  patchAgentVariableHandoff
} from "./sarvam-agent-variable-handoff.patch.js";

const legacyClient = `
export async function createInstantOutboundCall({
  appId,
  appVersion,
  connectionId,
  agentPhoneNumber,
  userPhoneNumber,
  agentVariables = {}
}) {
  const body = {
    app_config: {
      app_id: appId,
      app_version: Number(appVersion),
      connection_config: {
        connection_id: connectionId,
        agent_phone_number:
          agentPhoneNumber
      }
    },
    user_config: {
      user_phone_number:
        userPhoneNumber,
      agent_variables:
        agentVariables
    }
  };

  const response = { ok: false, status: 422 };
  const responseBody = {
    detail: [{ loc: ["body", "app_config"], msg: "invalid" }]
  };
  if (!response.ok) {
    const error = new Error(
      \`Sarvam Instant Outbound returned \${response.status}\`
    );
    error.body = responseBody;
    throw error;
  }

  return body;
}
`;

const first = patchAgentVariableHandoff(legacyClient);
assert.equal(first.changed, true);
assert.equal(hasCorrectAgentVariableHandoff(first.source), true);
assert.match(first.source, /agent_variables:\s*normalizedAgentVariables/);
assert.match(first.source, /registeredInputVariables\.has\(key\)/);
assert.match(first.source, /value !== null\s*&&\s*value !== undefined/);
assert.match(first.source, /const providerDetail =/);
assert.doesNotMatch(
  first.source.match(/user_config\s*:\s*\{[\s\S]*?\n\s*\}/m)[0],
  /agent_variables/
);

const second = patchAgentVariableHandoff(first.source);
assert.equal(second.changed, false);
assert.equal(second.source, first.source);

const unsafeClient = `${legacyClient}\n${legacyClient.replace(
  "createInstantOutboundCall",
  "createSecondInstantOutboundCall"
)}`;
assert.throws(
  () => patchAgentVariableHandoff(unsafeClient),
  /Expected exactly one/
);

const upgradedV1Client = first.source
  .replaceAll("SARVAM_AGENT_VARIABLE_HANDOFF_V3", "SARVAM_AGENT_VARIABLE_HANDOFF_V1")
  .replace(
    /const normalizedAgentVariables =[\s\S]*?\n\s*const body =/m,
    "const body ="
  )
  .replace("agent_variables: normalizedAgentVariables", "agent_variables: agentVariables")
  .replace(
    /const providerDetail =[\s\S]*?\n\s*const error =\s*new Error\([\s\S]*?\n\s*\);/m,
    "const error = new Error(\n          `Sarvam Instant Outbound returned ${response.status}`\n        );"
  );
const upgraded = patchAgentVariableHandoff(upgradedV1Client);
assert.equal(upgraded.changed, true);
assert.equal(hasCorrectAgentVariableHandoff(upgraded.source), true);

const upgradedV2Client = first.source
  .replaceAll("SARVAM_AGENT_VARIABLE_HANDOFF_V3", "SARVAM_AGENT_VARIABLE_HANDOFF_V2")
  .replace(
    /\s*const registeredInputVariables = new Set\([\s\S]*?\);\n\n/m,
    "\n"
  )
  .replace(
    /\.filter\(\(\[key, value\]\) =>[\s\S]*?value !== undefined\n\s*\)/m,
    ".filter(([, value]) => value !== null && value !== undefined)"
  );
const upgradedFromV2 = patchAgentVariableHandoff(upgradedV2Client);
assert.equal(upgradedFromV2.changed, true);
assert.equal(hasCorrectAgentVariableHandoff(upgradedFromV2.source), true);

const preparedVariables = {
  user_name: "Sathish",
  run_contact_id: "0d3f16b8-0cab-4452-b0cc-3171ac21450d",
  questionnaire_context: "Ask the configured neutral research questions.",
  agent_code: "INTERNAL_ONLY",
  iteration_id: "internal-iteration-id",
  voice_code: null
};
const registeredInputVariables = new Set([
  "agent_style_context",
  "knowledge_context",
  "preferred_language",
  "probe_context",
  "questionnaire_context",
  "research_context",
  "run_contact_id",
  "run_id",
  "user_name",
  "voter_id"
]);
assert.equal(registeredInputVariables.size, 10);
const normalizedPreparedVariables = Object.fromEntries(
  Object.entries(preparedVariables)
    .filter(([key, value]) =>
      registeredInputVariables.has(key) &&
      value !== null &&
      value !== undefined
    )
    .map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    ])
);
const requestBody = {
  app_config: {
    app_id: "Political-A-b26ad56c-c4ae",
    app_version: 2,
    connection_config: {
      connection_id: "ee3407f4-85-8805a44f-a822",
      agent_phone_number: "+918065356536"
    },
    agent_variables: normalizedPreparedVariables
  },
  user_config: {
    user_phone_number: "+919999999999"
  }
};

assert.equal(requestBody.app_config.agent_variables.user_name, "Sathish");
assert.equal(
  requestBody.app_config.agent_variables.run_contact_id,
  "0d3f16b8-0cab-4452-b0cc-3171ac21450d"
);
assert.equal("agent_variables" in requestBody.user_config, false);
assert.equal("agent_code" in requestBody.app_config.agent_variables, false);
assert.equal("iteration_id" in requestBody.app_config.agent_variables, false);
assert.equal(
  requestBody.app_config.agent_variables.questionnaire_context,
  "Ask the configured neutral research questions."
);

console.log("Sarvam agent-variable handoff tests passed.");
