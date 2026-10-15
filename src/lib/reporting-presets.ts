// Authoring aids only. These presets do not edit question wording, publish an
// agent, infer a respondent's beliefs, or alter an Iteration's frozen content.
export const PRIORITY_REPORTING_CATEGORIES = Object.freeze([
  "Employment and jobs",
  "Education and universities",
  "Skills and professional development",
  "Representation and accessibility",
  "Civic services and infrastructure",
  "None"
]);
export const ASSESSMENT_REPORTING_CATEGORIES = Object.freeze(["Positive", "Neutral", "Negative", "Mixed"]);

export const REPORTING_PRESETS = Object.freeze([
  {
    reportKey: "development_priority", label: "Development priorities", outputVariable: "development_priority",
    allowedValues: PRIORITY_REPORTING_CATEGORIES, targetType: "NONE",
    english: "Which area of development, if any, should receive the highest priority in your area? Please describe your own view; you may also say none or that you are unsure.",
    telugu: "మీ ప్రాంతంలో అభివృద్ధికి సంబంధించి ఏ అంశానికి అత్యధిక ప్రాధాన్యం ఇవ్వాలని మీరు భావిస్తున్నారు? మీ అభిప్రాయం చెప్పండి. ఏదీ లేదని లేదా తెలియదని కూడా చెప్పవచ్చు."
  },
  {
    reportKey: "expected_change", label: "Expected changes", outputVariable: "desired_change",
    allowedValues: PRIORITY_REPORTING_CATEGORIES, targetType: "NONE",
    english: "What one change, if any, would you most like to see in your area? Please describe your own view; you may also say none or that you are unsure.",
    telugu: "మీ ప్రాంతంలో మీరు ఎక్కువగా కోరుకుంటున్న ఒక మార్పు ఏమిటి? మీ అభిప్రాయం చెప్పండి. ఏ మార్పూ అవసరం లేదని లేదా తెలియదని కూడా చెప్పవచ్చు."
  },
  {
    reportKey: "leader_assessment", label: "Named-leader assessment", outputVariable: "leader_assessment",
    allowedValues: ASSESSMENT_REPORTING_CATEGORIES, targetType: "LEADER",
    english: "How would you describe your assessment of [leader name]'s public work: positive, neutral, negative or mixed? Please use your own view. If you do not have enough information or prefer not to answer, please say so.",
    telugu: "[నాయకుడి పేరు] గారి ప్రజా పనితీరుపై మీ అభిప్రాయం ఏమిటి: బాగుంది, తటస్థం, బాగోలేదు లేదా మిశ్రమం? మీ సొంత అభిప్రాయం చెప్పండి. తెలియదని లేదా సమాధానం చెప్పడం ఇష్టం లేదని కూడా చెప్పవచ్చు."
  }
] as const);

type ReviewContract = {
  reportKey: string;
  outputVariables: string[];
  valueType: string;
  allowedValues: string[];
  target: { type: string; id: string; name: string };
  missingPolicy: "EXPLICIT_STATES";
};
type ReviewCoverage = {
  questionnaire: { id: string; code: string; name: string; version: number; status: string };
  locked: boolean;
  usedByIterations: number;
  questions: {
    id: string; questionCode: string | null; order: number; text: string;
    contract: ReviewContract | null; contractValid: boolean; expectedContractFingerprint: string;
  }[];
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right, "en-US"))
    .map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

function copiedContract(contract: ReviewContract) {
  // Deliberately copy only the saved collection contract, never arbitrary
  // coverage metadata, participant information or client draft fields.
  return {
    reportKey: contract.reportKey, outputVariables: [...contract.outputVariables], valueType: contract.valueType,
    allowedValues: [...contract.allowedValues], target: {
      type: contract.target.type, id: contract.target.id, name: contract.target.name
    }, missingPolicy: contract.missingPolicy
  };
}

export async function buildSarvamReviewPack(coverage: ReviewCoverage, generatedAt = new Date().toISOString()) {
  if (!coverage?.questionnaire?.id || !Number.isInteger(coverage.questionnaire.version)
      || coverage.questionnaire.version < 1 || !Array.isArray(coverage.questions)
      || new Set(coverage.questions.map((question) => question.id)).size !== coverage.questions.length
      || coverage.questions.some((question) => !question.id || !Number.isInteger(question.order)
        || question.order < 1 || typeof question.text !== "string"
        || !/^[a-f0-9]{64}$/i.test(question.expectedContractFingerprint)
        || (question.contractValid && !question.contract))
      || !Number.isFinite(new Date(generatedAt).getTime())) {
    throw new Error("Reload valid current reporting definitions before preparing a review pack.");
  }
  const payload = {
    schemaVersion: 1,
    artifactType: "SARVAM_MANUAL_QUESTIONNAIRE_REVIEW",
    provenance: "CURRENT_CATALOGUE_NOT_ITERATION_SNAPSHOT",
    sourceFreshness: "LOADED_COVERAGE_NOT_REVALIDATED_AT_EXPORT",
    generatedAt: new Date(generatedAt).toISOString(),
    questionnaire: {
      id: coverage.questionnaire.id, code: coverage.questionnaire.code, name: coverage.questionnaire.name,
      version: coverage.questionnaire.version, status: coverage.questionnaire.status
    },
    catalogueUse: { locked: coverage.locked, usedByIterations: coverage.usedByIterations },
    questions: coverage.questions.map((question) => ({
      id: question.id, questionCode: question.questionCode, order: question.order,
      questionText: question.text, expectedContractFingerprint: question.expectedContractFingerprint,
      definitionStatus: question.contractValid && question.contract ? "DEFINED_UNVERIFIED" : "NOT_DEFINED_OR_INVALID",
      contract: question.contractValid && question.contract ? copiedContract(question.contract) : null
    })),
    reviewStatus: "MANUAL_REVIEW_REQUIRED_NOT_LAUNCH_APPROVAL",
    requiredBeforeLaunch: [
      "Review the actual question wording and saved output contracts together; suggestions are not substituted into this pack.",
      "Use a new unused questionnaire version for changed requirements; never rewrite an Iteration's frozen instrument.",
      "Manually update and commit the intended Sarvam agent version, then verify its exact deployed app/version and output-variable mapping.",
      "Configure categorical provider outputs to use the contract's canonical allowedValues; do not substitute unreviewed translated output labels or force uncertainty, refusal or multiple answers into a substantive category.",
      "Complete an approved canary test call and review actual question delivery, brief acknowledgements, collected values and target identity before batch launch."
    ],
    missingAnswerHandling: {
      rule: "Keep missing, uncertainty, refusal and uncoded answers distinct from substantive categories.",
      supportedProviderExamples: { missing: ["no answer", "no response"], uncertain: ["can't say"], refusal: ["refused"] },
      caution: "NOT_ANSWERED, CANT_SAY and REFUSED are conceptual states, not supported literal output instructions. Multiple or uncoded answers must not be forced into a substantive category."
    },
    actionsPerformed: { providerUpdate: false, agentCommit: false, canaryCall: false, launch: false },
    limitations: [
      "This is the current saved questionnaire catalogue, not an Iteration snapshot or proof of historical/provider delivery.",
      "The export uses definitions last loaded in this page; concurrent catalogue changes are not rechecked by this local download. Refresh definitions before agent review and compare the recorded fingerprints.",
      "This local artifact contains authored questions and saved contracts only; no participant records, raw answers, transcripts or credentials are included.",
      "A content fingerprint identifies this export; it is not independent verification, a statistical finding or research sign-off."
    ],
    fingerprintAlgorithm: "SHA-256"
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(payload)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const contentFingerprint = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return { ...payload, contentFingerprint };
}
