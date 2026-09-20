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

console.log("Call completion policy tests passed.");
