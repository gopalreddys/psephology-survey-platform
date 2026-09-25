function policyError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function assertIterationAgentVersionChange({ campaign, iteration, currentSnapshot,
  targetAgent, activeExecutions = 0 }) {
  if (!campaign || !iteration || !currentSnapshot || !targetAgent) {
    throw policyError("Iteration voice-agent configuration is incomplete", 409);
  }
  if (["COMPLETED", "ARCHIVED"].includes(String(campaign.status || "").toUpperCase())) {
    throw policyError("A completed or archived campaign cannot change its Iteration agent", 409);
  }
  if (["COMPLETED", "LOCKED", "ARCHIVED", "CANCELLED"].includes(
    String(iteration.status || "").toUpperCase()
  )) {
    throw policyError("A completed or locked Iteration cannot change its voice agent", 409);
  }
  if (Number(activeExecutions) > 0) {
    throw policyError("Wait for active calls to finish before changing the agent version", 409);
  }
  if (String(targetAgent.app_id || "") !== String(currentSnapshot.app_id || "")) {
    throw policyError("Only a newer committed version of the same Sarvam Agent App can be selected", 409);
  }
  const currentVersion = Number(currentSnapshot.app_version);
  const nextVersion = Number(targetAgent.app_version);
  if (!Number.isInteger(nextVersion) || nextVersion <= currentVersion) {
    throw policyError(`Select a committed agent version newer than v${currentVersion}`, 409);
  }
  const immutableFields = ["connection_id", "outbound_phone_number", "usage_category"];
  for (const field of immutableFields) {
    if (String(targetAgent[field] || "") !== String(currentSnapshot[field] || "")) {
      throw policyError("Agent version changes must retain the outbound connection, phone number and category", 409);
    }
  }
  return { currentVersion, nextVersion };
}
