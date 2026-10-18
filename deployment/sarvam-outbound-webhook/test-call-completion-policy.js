import assert from "node:assert/strict";

import {
  classifyCallCompletion,
  hasMeaningfulEvidenceValue,
  meaningfulSurveyResponseKeys
} from "./call-completion-policy.js";

const technicalVariables = new Set([
  "questionnaire_context",
  "run_id",
  "user_name",
  "voter_id"
]);
const questionnaireContext = JSON.stringify({
  questions: [
    {
      required_for_completion: true,
      output_variables: ["graduate_issue_priority"]
    },
    {
      required_for_completion: true,
      output_variables: ["mlc_role_awareness"]
    }
  ]
});

assert.equal(hasMeaningfulEvidenceValue("not_captured"), false);
assert.equal(hasMeaningfulEvidenceValue("unclear"), false);
assert.equal(hasMeaningfulEvidenceValue("Not enough information"), true);
assert.equal(hasMeaningfulEvidenceValue(false), true);

const noFeedback = classifyCallCompletion({
  providerStatus: "connected",
  technicalVariables,
  finalVariables: {
    questionnaire_context: questionnaireContext,
    disposition: "no_meaningful_feedback",
    call_summary: "The call ended after the greeting.",
    graduate_issue_priority: "not_captured",
    mlc_role_awareness: "unclear",
    user_name: "Ayyappa"
  }
});
assert.deepEqual(noFeedback, {
  providerConnected: true,
  successful: false,
  retryEligible: true,
  executionStatus: "COMPLETED",
  contactAttemptStatus: "FAILED",
  finalStatus: "PENDING",
  normalizedStatus: "CONNECTED_INCOMPLETE",
  completionReason: "no_meaningful_feedback",
  disposition: "no_meaningful_feedback",
  meaningfulResponseKeys: []
});

const meaningful = classifyCallCompletion({
  providerStatus: "connected",
  technicalVariables,
  finalVariables: {
    questionnaire_context: questionnaireContext,
    disposition: "completed",
    graduate_issue_priority: "Employment opportunities",
    mlc_role_awareness: "Somewhat familiar"
  }
});
assert.equal(meaningful.successful, true);
assert.equal(meaningful.finalStatus, "SUCCESS_COMPLETE");
assert.equal(meaningful.retryEligible, false);
assert.deepEqual(
  meaningful.meaningfulResponseKeys,
  ["graduate_issue_priority", "mlc_role_awareness"]
);

const validUnknown = meaningfulSurveyResponseKeys(
  {
    questionnaire_context: questionnaireContext,
    graduate_issue_priority: "Not enough information",
    mlc_role_awareness: "not_captured"
  },
  technicalVariables
);
assert.deepEqual(validUnknown, ["graduate_issue_priority"]);

assert.deepEqual(
  meaningfulSurveyResponseKeys({
    questionnaire_context: {
      questionnaire: {
        questions: [{ output_keys: ["top_concern_category"] }]
      }
    },
    top_concern_category: "employment"
  }),
  ["top_concern_category"]
);

const providerFailure = classifyCallCompletion({
  providerStatus: "busy",
  technicalVariables,
  finalVariables: {}
});
assert.equal(providerFailure.executionStatus, "FAILED");
assert.equal(providerFailure.normalizedStatus, "BUSY");
assert.equal(providerFailure.retryEligible, true);

const fallback = classifyCallCompletion({
  providerStatus: "connected",
  technicalVariables,
  finalVariables: {
    disposition: "completed",
    call_summary: "Summary only",
    sentiment_tone: "positive",
    top_concern_category: "employment"
  }
});
assert.equal(fallback.successful, true);
assert.deepEqual(fallback.meaningfulResponseKeys, ["top_concern_category"]);

const withOutput = (extra = {}) => classifyCallCompletion({ providerStatus: "connected",
  finalVariables: { disposition: "survey_completed", graduate_issue_priority: "Jobs", ...extra } });
for (const key of ["disposition", "call_disposition", "respondent_status", "consent", "consent_status", "survey_consent"]) {
  const stopped = withOutput({ [key]: "DO_NOT_CALL" });
  assert.equal(stopped.successful, false, key);
  assert.equal(stopped.retryEligible, false, key);
  assert.equal(stopped.finalStatus, "DO_NOT_CALL", key);
  assert.equal(stopped.contactAttemptStatus, "FAILED");
  assert.equal(stopped.completionReason, "do_not_call");
}
for (const key of ["disposition", "call_disposition", "respondent_status"]) {
  assert.equal(withOutput({ [key]: "wrong_person" }).successful, false);
  const wrong = withOutput({ [key]: "wrong_number" });
  assert.equal(wrong.finalStatus, "INVALID_NUMBER");
  assert.equal(wrong.retryEligible, false);
  assert.equal(wrong.completionReason, "wrong_number");
}
for (const disposition of ["partial_feedback_captured", "substantial_feedback_captured", "partial", "incomplete", "unrecognized", ""]) {
  const partial = withOutput({ disposition });
  assert.equal(partial.successful, false, disposition);
  assert.equal(partial.retryEligible, true, disposition);
}
for (const extra of [{ do_not_call: true }, { do_not_call: "yes" }, { consent: false }, { consent_status: "denied" },
  { wrong_person: true }, { wrong_number: true }, { consent_status: "possibly" }, { consent_status: "NOT_INTERESTED" },
  { do_not_call: "maybe" }, { wrong_person: {} }, { do_not_call: "DO_NOT_CALL" }]) {
  assert.equal(withOutput(extra).successful, false, JSON.stringify(extra));
}
for (const disposition of ["declined", "refused", "no_consent"]) {
  const refusal = withOutput({ disposition });
  assert.equal(refusal.finalStatus, "REFUSED_TERMINAL");
  assert.equal(refusal.retryEligible, false);
}
for (const missing of ["no answer", "uncoded response", "not captured", "", null]) {
  assert.equal(classifyCallCompletion({ providerStatus: "connected", finalVariables: {
    disposition: "survey_completed", inactive_legacy_field: missing
  } }).successful, false);
}
assert.deepEqual(meaningfulSurveyResponseKeys({ disposition: "survey_completed", survey_consent: true, wrong_person: false,
  do_not_call: false, call_disposition: "completed", respondent_status: "completed" }), []);
assert.equal(withOutput({ consent_status: "agreed" }).successful, true);
assert.equal(withOutput({ do_not_call: false }).successful, true);

console.log("Call completion policy tests passed.");
