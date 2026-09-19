const MARKER = "SARVAM_AGENT_VARIABLE_HANDOFF_V3";
const LEGACY_MARKERS = [
  "SARVAM_AGENT_VARIABLE_HANDOFF_V1",
  "SARVAM_AGENT_VARIABLE_HANDOFF_V2"
];

const REGISTERED_INPUT_VARIABLES = [
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
];

const BODY_PATTERN = /const body\s*=\s*\{[\s\S]*?app_id\s*:\s*appId[\s\S]*?user_phone_number\s*:\s*\n?\s*userPhoneNumber[\s\S]*?\n\s*\};/m;

const CORRECT_BODY = `/* ${MARKER}: submit only variables registered on the committed Sarvam agent. */
  const registeredInputVariables = new Set(${JSON.stringify(
    REGISTERED_INPUT_VARIABLES,
    null,
    4
  )});

  const normalizedAgentVariables = Object.fromEntries(
    Object.entries(agentVariables || {})
      .filter(([key, value]) =>
        registeredInputVariables.has(key) &&
        value !== null &&
        value !== undefined
      )
      .map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : JSON.stringify(value)
      ])
  );

  const body = {
    app_config: {
      app_id: appId,
      app_version: Number(appVersion),
      connection_config: {
        connection_id: connectionId,
        agent_phone_number: agentPhoneNumber
      },
      agent_variables: normalizedAgentVariables
    },
    user_config: {
      user_phone_number: userPhoneNumber
    }
  };`;

const ERROR_PATTERN = /const error\s*=\s*new Error\(\s*`Sarvam Instant Outbound returned \$\{response\.status\}`\s*\);/m;

const CORRECT_ERROR = `const providerDetail =
        Array.isArray(responseBody?.detail)
          ? responseBody.detail
              .map((item) => {
                const location = Array.isArray(item?.loc)
                  ? item.loc.join(".")
                  : "";
                const message =
                  typeof item?.msg === "string"
                    ? item.msg
                    : "";

                return [location, message]
                  .filter(Boolean)
                  .join(": ");
              })
              .filter(Boolean)
              .join("; ")
              .slice(0, 600)
          : "";

      const error =
        new Error(
          "Sarvam Instant Outbound returned " +
          response.status +
          (providerDetail ? ": " + providerDetail : "")
        );`;

function appConfigContainsVariables(source) {
  return /app_config\s*:\s*\{[\s\S]*?agent_variables\s*:\s*normalizedAgentVariables[\s\S]*?\n\s*\},\s*\n\s*user_config\s*:/m.test(source);
}

function userConfigContainsVariables(source) {
  const match = source.match(
    /user_config\s*:\s*\{([\s\S]*?)\n\s*\}/m
  );

  return Boolean(match && /agent_variables\s*:/.test(match[1]));
}

export function hasCorrectAgentVariableHandoff(source) {
  return appConfigContainsVariables(source) &&
    !userConfigContainsVariables(source) &&
    source.includes("registeredInputVariables.has(key)") &&
    REGISTERED_INPUT_VARIABLES.every((name) => source.includes(`\"${name}\"`)) &&
    /value !== null\s*&&\s*value !== undefined/.test(source) &&
    source.includes("const providerDetail =") &&
    source.includes("responseBody?.detail");
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

  const sourceWithoutLegacyMarker = LEGACY_MARKERS.reduce(
    (current, marker) => current.replace(
      new RegExp(`\\s*/\\* ${marker}:[^*]*\\*/\\n`, "g"),
      "\n"
    ),
    source
  );
  const matches = sourceWithoutLegacyMarker.match(
    new RegExp(BODY_PATTERN.source, "gm")
  ) || [];

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Sarvam instant-outbound request body; found ${matches.length}`
    );
  }

  const bodyPatched = sourceWithoutLegacyMarker.replace(
    BODY_PATTERN,
    CORRECT_BODY
  );
  const alreadyHasSafeProviderDetail =
    bodyPatched.includes("const providerDetail =") &&
    bodyPatched.includes("responseBody?.detail");
  let patched = bodyPatched;

  if (!alreadyHasSafeProviderDetail) {
    const errorMatches = bodyPatched.match(
      new RegExp(ERROR_PATTERN.source, "gm")
    ) || [];

    if (errorMatches.length !== 1) {
      throw new Error(
        `Expected exactly one Sarvam instant-outbound error block; found ${errorMatches.length}`
      );
    }

    patched = bodyPatched.replace(ERROR_PATTERN, CORRECT_ERROR);
  }

  if (!hasCorrectAgentVariableHandoff(patched)) {
    throw new Error("Unable to verify corrected Sarvam agent-variable handoff");
  }

  return { source: patched, changed: true };
}

export { MARKER };
