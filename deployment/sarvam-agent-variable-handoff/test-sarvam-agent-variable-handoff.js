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

  return body;
}
`;

const first = patchAgentVariableHandoff(legacyClient);
assert.equal(first.changed, true);
assert.equal(hasCorrectAgentVariableHandoff(first.source), true);
assert.match(
  first.source,
  /app_config\s*:\s*\{[\s\S]*?agent_variables:\s*agentVariables/
);
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

const preparedVariables = {
  user_name: "Sathish",
  run_contact_id: "0d3f16b8-0cab-4452-b0cc-3171ac21450d"
};
const requestBody = {
  app_config: {
    app_id: "Political-A-b26ad56c-c4ae",
    app_version: 2,
    connection_config: {
      connection_id: "ee3407f4-85-8805a44f-a822",
      agent_phone_number: "+918065356536"
    },
    agent_variables: preparedVariables
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

console.log("Sarvam agent-variable handoff tests passed.");
