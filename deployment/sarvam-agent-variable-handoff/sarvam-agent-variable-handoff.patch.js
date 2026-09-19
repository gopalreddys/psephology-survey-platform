const MARKER = "SARVAM_AGENT_VARIABLE_HANDOFF_V1";

const BODY_PATTERN = /const body\s*=\s*\{[\s\S]*?app_id\s*:\s*appId[\s\S]*?user_phone_number\s*:\s*\n?\s*userPhoneNumber[\s\S]*?\n\s*\};/m;

const CORRECT_BODY = `/* ${MARKER}: instant-outbound variables belong to app_config. */
  const body = {
    app_config: {
      app_id: appId,
      app_version: Number(appVersion),
      connection_config: {
        connection_id: connectionId,
        agent_phone_number: agentPhoneNumber
      },
      agent_variables: agentVariables
    },
    user_config: {
      user_phone_number: userPhoneNumber
    }
  };`;

function appConfigContainsVariables(source) {
  return /app_config\s*:\s*\{[\s\S]*?agent_variables\s*:\s*agentVariables[\s\S]*?\n\s*\},\s*\n\s*user_config\s*:/m.test(source);
}

function userConfigContainsVariables(source) {
  const match = source.match(
    /user_config\s*:\s*\{([\s\S]*?)\n\s*\}/m
  );

  return Boolean(match && /agent_variables\s*:/.test(match[1]));
}

export function hasCorrectAgentVariableHandoff(source) {
  return appConfigContainsVariables(source) &&
    !userConfigContainsVariables(source);
}

export function patchAgentVariableHandoff(source) {
  if (source.includes(MARKER)) {
    if (!hasCorrectAgentVariableHandoff(source)) {
      throw new Error(
        "Sarvam variable-handoff marker exists, but the request structure is invalid"
      );
    }

    return { source, changed: false };
  }

  const matches = source.match(new RegExp(BODY_PATTERN.source, "gm")) || [];

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Sarvam instant-outbound request body; found ${matches.length}`
    );
  }

  const patched = source.replace(BODY_PATTERN, CORRECT_BODY);

  if (!hasCorrectAgentVariableHandoff(patched)) {
    throw new Error("Unable to verify corrected Sarvam agent-variable handoff");
  }

  return { source: patched, changed: true };
}

export { MARKER };
