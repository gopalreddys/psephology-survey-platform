const NON_MEANINGFUL_DISPOSITIONS = new Set([
  "abandoned",
  "busy",
  "callback_requested",
  "call_dropped",
  "declined",
  "do_not_call",
  "failed",
  "incomplete",
  "no_answer",
  "no_consent",
  "no_meaningful_feedback",
  "no_response",
  "not_completed",
  "refused",
  "unavailable",
  "voicemail",
  "wrong_number"
]);

const EMPTY_EVIDENCE_VALUES = new Set([
  "",
  "n/a",
  "na",
  "none",
  "not_asked",
  "not_captured",
  "not_provided",
  "null",
  "undefined",
  "unclear",
  "unrecorded"
]);

const NON_SURVEY_VARIABLES = new Set([
  "call_summary",
  "consent",
  "consent_status",
  "disposition",
  "geography_type",
  "location_detail",
  "mandal_captured",
  "mla_constituency_captured",
  "sentiment_tone",
  "voter_engagement_level"
]);

function normalizedToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseContext(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function questionnaireOutputKeys(finalVariables) {
  const context = parseContext(finalVariables?.questionnaire_context);
  const roots = [context, context?.questionnaire, context?.instrument]
    .filter(Boolean);
  const questions = roots
    .flatMap((root) =>
      root.questions || root.question_items || root.items || []
    )
    .filter((question) => question && typeof question === "object");
  const keys = new Set();

  for (const question of questions) {
    const outputs =
      question?.output_variables ||
      question?.outputVariables ||
      question?.response_variables ||
      question?.responseVariables ||
      question?.output_keys ||
      question?.outputKeys ||
      question?.outputs ||
      question?.variables ||
      [];

    for (const output of Array.isArray(outputs) ? outputs : [outputs]) {
      const key = String(output || "").trim();
      if (key) keys.add(key);
    }
  }

  return keys;
}

export function hasMeaningfulEvidenceValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulEvidenceValue);
  if (typeof value === "object") {
    return Object.values(value).some(hasMeaningfulEvidenceValue);
  }

  return !EMPTY_EVIDENCE_VALUES.has(normalizedToken(value));
}

export function meaningfulSurveyResponseKeys(
  finalVariables = {},
  technicalVariables = DEFAULT_TECHNICAL_VARIABLES
) {
  const configuredKeys = questionnaireOutputKeys(finalVariables);
  const candidateKeys = configuredKeys.size
    ? [...configuredKeys]
    : Object.keys(finalVariables).filter((key) =>
        !technicalVariables.has(key) &&
        !NON_SURVEY_VARIABLES.has(key)
      );

  return candidateKeys.filter((key) =>
    Object.hasOwn(finalVariables, key) &&
    hasMeaningfulEvidenceValue(finalVariables[key])
  );
}

export function classifyCallCompletion({
  providerStatus,
  finalVariables = {},
  technicalVariables = DEFAULT_TECHNICAL_VARIABLES
}) {
  const connectivity = normalizedToken(providerStatus);
  const disposition = normalizedToken(finalVariables.disposition);
  const meaningfulResponseKeys = meaningfulSurveyResponseKeys(
    finalVariables,
    technicalVariables
  );
  const providerConnected = connectivity === "connected";
  const disqualified = NON_MEANINGFUL_DISPOSITIONS.has(disposition);
  const successful =
    providerConnected &&
    !disqualified &&
    meaningfulResponseKeys.length > 0;

  let completionReason = connectivity || "failed";
  if (providerConnected && !successful) {
    completionReason = disposition || "connected_without_meaningful_responses";
  }

  return {
    providerConnected,
    successful,
    retryEligible: !successful,
    executionStatus: providerConnected ? "COMPLETED" : "FAILED",
    contactAttemptStatus: successful ? "COMPLETED" : "FAILED",
    finalStatus: successful ? "SUCCESS_COMPLETE" : "PENDING",
    normalizedStatus: providerConnected
      ? successful
        ? "COMPLETED"
        : "CONNECTED_INCOMPLETE"
      : connectivity.toUpperCase(),
    completionReason,
    disposition: disposition || null,
    meaningfulResponseKeys
  };
}
export const DEFAULT_TECHNICAL_VARIABLES = new Set([
  "agent_code",
  "agent_style_context",
  "analytics_excluded",
  "attempt_cycle_id",
  "demo_call_id",
  "iteration_id",
  "iteration_number",
  "knowledge_context",
  "knowledge_packs",
  "max_probes",
  "preferred_language",
  "probe_context",
  "probe_set",
  "questionnaire_code",
  "questionnaire_context",
  "research_context",
  "run_contact_id",
  "run_id",
  "source",
  "study_id",
  "user_name",
  "voice_code",
  "voter_id",
  "voter_profession",
  "voter_qualification"
]);
