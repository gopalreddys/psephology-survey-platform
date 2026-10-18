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
  "partial",
  "partial_feedback_captured",
  "refused",
  "substantial_feedback_captured",
  "unavailable",
  "voicemail",
  "wrong_number",
  "wrong_person"
]);

const EMPTY_EVIDENCE_VALUES = new Set([
  "",
  "n/a",
  "na",
  "none",
  "no_answer",
  "no_response",
  "not_asked",
  "not_captured",
  "not_provided",
  "null",
  "undefined",
  "unclear",
  "uncoded_response",
  "unrecorded"
]);

const NON_SURVEY_VARIABLES = new Set([
  "call_summary",
  "consent",
  "consent_status",
  "survey_consent",
  "disposition",
  "call_disposition",
  "respondent_status",
  "do_not_call",
  "wrong_number",
  "wrong_person",
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

const affirmative = (value) => value === true || ["yes", "true"].includes(normalizedToken(value));
const COMPLETE_DISPOSITIONS = new Set(["completed", "survey_completed"]);
const REFUSAL_DISPOSITIONS = new Set(["declined", "refused", "no_consent", "consent_denied", "not_consented", "not_interested"]);
const DISPOSITION_KEYS = ["disposition", "call_disposition", "respondent_status"];
const CONSENT_KEYS = ["survey_consent", "consent", "consent_status"];
const ALLOWED_CONSENT = new Set(["yes", "true", "agreed", "consented", "granted", "accepted"]);

// An explicit opt-out overrides provider status and stray/conflicting answers.
// This is permission to suppress future submissions, never political inference.
export function requestsDoNotCall(finalVariables = {}) {
  return affirmative(finalVariables.do_not_call) || normalizedToken(finalVariables.do_not_call) === "do_not_call" ||
    [...DISPOSITION_KEYS, ...CONSENT_KEYS].some((key) =>
      normalizedToken(finalVariables[key]) === "do_not_call");
}

function refusedParticipation(finalVariables) {
  return CONSENT_KEYS.some((key) =>
    finalVariables[key] === false || ["no", "false", "denied", "declined", "refused", "no_consent", "consent_denied", "not_consented", "not_granted"]
      .includes(normalizedToken(finalVariables[key]))) ||
    DISPOSITION_KEYS.some((key) => REFUSAL_DISPOSITIONS.has(normalizedToken(finalVariables[key])));
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
  const doNotCall = requestsDoNotCall(finalVariables);
  const refused = refusedParticipation(finalVariables);
  const wrongNumber = affirmative(finalVariables.wrong_number) || DISPOSITION_KEYS.some((key) => normalizedToken(finalVariables[key]) === "wrong_number");
  const wrongPerson = affirmative(finalVariables.wrong_person) || DISPOSITION_KEYS.some((key) => normalizedToken(finalVariables[key]) === "wrong_person");
  const unresolvedConsent = CONSENT_KEYS.some((key) => finalVariables[key] !== undefined && finalVariables[key] !== null &&
    finalVariables[key] !== "" && !ALLOWED_CONSENT.has(normalizedToken(finalVariables[key])));
  const unresolvedSafetyFlag = ["do_not_call", "wrong_number", "wrong_person"].some((key) =>
    finalVariables[key] !== undefined && finalVariables[key] !== null && finalVariables[key] !== "" &&
    finalVariables[key] !== false && !["no", "false"].includes(normalizedToken(finalVariables[key])) && !affirmative(finalVariables[key]));
  const conflictingDisposition = ["call_disposition", "respondent_status"].some((key) =>
    normalizedToken(finalVariables[key]) && !COMPLETE_DISPOSITIONS.has(normalizedToken(finalVariables[key])));
  const disqualified = doNotCall || refused || wrongNumber || wrongPerson || unresolvedConsent || unresolvedSafetyFlag || conflictingDisposition ||
    NON_MEANINGFUL_DISPOSITIONS.has(disposition);
  const successful =
    providerConnected &&
    !disqualified &&
    COMPLETE_DISPOSITIONS.has(disposition) &&
    meaningfulResponseKeys.length > 0;

  const finalStatus = doNotCall ? "DO_NOT_CALL" : refused ? "REFUSED_TERMINAL"
    : wrongNumber ? "INVALID_NUMBER" : successful ? "SUCCESS_COMPLETE" : "PENDING";
  const terminalWithoutSuccess = ["DO_NOT_CALL", "REFUSED_TERMINAL", "INVALID_NUMBER"].includes(finalStatus);

  let completionReason = connectivity || "failed";
  if (providerConnected && !successful) {
    completionReason = disposition || "connected_without_meaningful_responses";
  }
  if (doNotCall) completionReason = "do_not_call";
  else if (refused) completionReason = "participation_declined";
  else if (wrongNumber) completionReason = "wrong_number";
  else if (wrongPerson) completionReason = "wrong_person";
  else if (unresolvedConsent || unresolvedSafetyFlag || conflictingDisposition) completionReason = "participation_state_unresolved";
  else if (providerConnected && !successful && !COMPLETE_DISPOSITIONS.has(disposition) && !NON_MEANINGFUL_DISPOSITIONS.has(disposition)) {
    completionReason = "completion_disposition_required";
  }

  return {
    providerConnected,
    successful,
    retryEligible: !successful && !terminalWithoutSuccess,
    executionStatus: providerConnected ? "COMPLETED" : "FAILED",
    contactAttemptStatus: successful ? "COMPLETED" : "FAILED",
    finalStatus,
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
