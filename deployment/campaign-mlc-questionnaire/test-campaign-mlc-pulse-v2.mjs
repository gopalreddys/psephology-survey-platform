import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateReportingContract } from "../research-reporting-foundation/reporting-contract.validation.js";
import { REPORT_CATALOG } from "../research-reporting-foundation/report-catalog.js";
import { normalizeOutputValue } from "../output-variable-standardization/output-normalization.repository.js";
import { resolveFrozenReportDefinitions } from "../research-reporting-foundation/research-report.js";
import { buildQuestionnaireContentSnapshot } from "../research-methodology/questionnaire-snapshot.repository.js";
import { inspectInstrument, buildInterviewCompletion } from "../interview-completion/interview-completion.js";

const specification = JSON.parse(await readFile(new URL("./campaign-mlc-pulse-v2.json", import.meta.url), "utf8"));
const handoff = await readFile(new URL("./sarvam-campaign-mlc-pulse-v2.md", import.meta.url), "utf8");
assert.ok(handoff.includes("https://docs.sarvam.ai/voice-agents/build/variables-personalization"));
assert.match(handoff, /Data Type = Enum/);
assert.match(handoff, /default\/fallback to `no answer`/);
assert.match(handoff, /plus all four special members/);
assert.doesNotMatch(handoff, /All ten outputs are strings/);
assert.equal(specification.questionnaireCode, "MLC_CAMPAIGN_PULSE_V2");
assert.equal(specification.questionnaireName, "Graduate MLC Campaign Thought Pulse — Reporting V2");
assert.equal(specification.versionNumber, 2);
assert.equal(specification.configurationStatus, "DRAFT_NOT_LAUNCH_APPROVED");
assert.match(specification.reviewStatus, /INDEPENDENT_MULTILINGUAL/);
assert.equal(specification.sourceBoundary, "NEW_UNUSED_INSTRUMENT_ONLY_NO_HISTORICAL_REWRITE");
assert.equal(specification.questions.length, 10);
assert.equal(new Set(specification.questions.map((question) => question.questionCode)).size, 10);
assert.equal(new Set(specification.questions.flatMap((question) => question.outputVariables)).size, 10);
assert.ok(!Object.hasOwn(specification, "platformQuestionnaireId"));
for (const field of ["appId", "committedVersion", "outboundConnectionId"]) assert.equal(specification.sarvamBinding[field], null);
for (const field of ["questionnaireSaved", "providerUpdate", "agentCommit", "canaryCall", "launch"]) assert.equal(specification.reviewBoundary[field], false);
assert.equal(specification.reviewBoundary.independentMultilingualWordingReviewRequired, true);
assert.equal(specification.reviewBoundary.realCallDeliveryAndExtractionReviewRequired, true);

const expected = [
  ["issue_priority", "graduate_issue_priority"],
  ["development_priority", "development_priority"],
  ["expected_change", "desired_change"],
  ["party_salience", "party_salience_unaided"],
  ["issue_leadership", "perceived_issue_leader_aided"],
  ["incumbent_assessment", "incumbent_assessment"],
  [null, "candidate_awareness"],
  ["candidate_impression", "candidate_impression"],
  ["candidate_fit", "candidate_criterion_fit"],
  ["leader_assessment", "leader_assessment"]
];
let canonicalProbes = 0;
let specialStateProbes = 0;
let enumFields = 0;
for (const [index, question] of specification.questions.entries()) {
  assert.equal(question.questionOrder, index + 1);
  assert.ok(!Object.hasOwn(question, "id"), "Question IDs are assigned only when actually saved");
  assert.match(question.questionCode, /^Q_V2_[A-Z_]+$/);
  assert.ok(question.questionText.length > 30);
  assert.match(question.questionTextTelugu, /[\u0C00-\u0C7F]/);
  assert.equal(question.required, index < 6, "Only unconditional core Q1–Q6 are required");
  assert.equal(question.requiredForCompletion, index < 6);
  assert.deepEqual(question.outputVariables, [expected[index][1]]);
  assert.doesNotMatch(question.questionText, /vote\s+for|cast\s+your\s+vote|support\s+(Kasani|Veeresh|BRS)|motivat|persuad/i);
  if (question.questionType === "SINGLE_CHOICE") {
    assert.ok(question.options.length >= 4);
    assert.equal(new Set(question.options.map((option) => option.value)).size, question.options.length);
    assert.ok(question.options.every((option) => option.value && option.label && /[\u0C00-\u0C7F]/.test(option.labelTelugu)));
    assert.ok(question.options.some((option) => option.value === "can't say"));
    assert.ok(question.options.some((option) => option.value === "refused"));
  } else {
    assert.equal(question.questionType, "OPEN_TEXT");
    assert.deepEqual(question.options, []);
  }
  const contract = question.reportingContract;
  if (expected[index][0] === null) {
    assert.ok(!Object.hasOwn(question, "reportingContract"));
    assert.equal(question.reportingStatus, "CONTEXT_ONLY_NO_NATIVE_REPORT_CONTRACT");
  } else {
    assert.deepEqual(validateReportingContract(contract), contract);
    assert.equal(contract.reportKey, expected[index][0]);
    assert.deepEqual(contract.outputVariables, question.outputVariables);
    assert.equal(contract.valueType, "CATEGORICAL");
    assert.equal(contract.missingPolicy, "EXPLICIT_STATES");
    const report = REPORT_CATALOG.find((item) => item.id === contract.reportKey);
    assert.ok(report && report.measureKeys.length, "Only an implemented report construct is configured");
    for (const key of contract.outputVariables) assert.ok(report.outputKeys.includes(key));
    for (const value of contract.allowedValues) {
      const normalized = normalizeOutputValue(question.outputVariables[0], value);
      assert.equal(normalized.status, "CODED", `${question.questionCode}: ${value}`);
      assert.equal(normalized.label, value);
      canonicalProbes += 1;
    }
    if (question.questionType === "SINGLE_CHOICE") {
      assert.deepEqual(new Set(question.options.filter((option) => !["can't say", "refused"].includes(option.value)).map((option) => option.value)), new Set(contract.allowedValues));
    }
  }
  for (const [value, status] of [["no answer", "MISSING"], ["can't say", "CANT_SAY"], ["refused", "REFUSED"], ["uncoded response", "UNCODED"]]) {
    assert.equal(normalizeOutputValue(question.outputVariables[0], value).status, status);
    specialStateProbes += 1;
  }
  const substantiveMembers = contract ? contract.allowedValues
    : question.options.filter((option) => !["can't say", "refused"].includes(option.value)).map((option) => option.value);
  const enumMembers = [...substantiveMembers, "no answer", "can't say", "refused", "uncoded response"];
  assert.equal(new Set(enumMembers).size, enumMembers.length);
  assert.ok(enumMembers.every((value) => typeof value === "string" && value.trim() === value));
  for (const member of ["no answer", "can't say", "refused", "uncoded response"]) {
    assert.ok(handoff.includes(`\`${member}\``));
    assert.ok(!substantiveMembers.includes(member), "Provider fallback states are not substantive contract categories");
  }
  enumFields += 1;
}
const contracts = specification.questions.filter((question) => question.reportingContract);
assert.equal(contracts.length, 9);
assert.equal(specification.reportingContractCount, contracts.length);
assert.equal(new Set(contracts.map((question) => question.reportingContract.reportKey)).size, 9);
assert.ok(!contracts.some((question) => question.reportingContract.reportKey === "scheme_experience"));
assert.deepEqual(specification.contextOnlyQuestionCodes, [specification.questions[6].questionCode]);
assert.ok(specification.questions[3].questionOrder < specification.questions[4].questionOrder);
assert.doesNotMatch(specification.questions[3].questionText, /\bBRS\b|\bBJP\b|Congress|Communist|Veeresh/i);
const aidedOptions = new Set(specification.questions[4].options.map((option) => option.value));
for (const value of ["BJP", "BRS", "Congress", "Communist / Left", "Independent / graduate group", "None"]) assert.ok(aidedOptions.has(value));
assert.deepEqual(specification.questions[5].reportingContract.target, { type: "LEADER", id: "surabhi-vani-devi", name: "Surabhi Vani Devi" });
assert.doesNotMatch(specification.questions[5].questionText, /\bBRS\b|\bBJP\b|Congress|Communist/i);
for (const question of specification.questions.slice(7)) {
  assert.match(question.askIf, /Q_V2_CANDIDATE_AWARENESS=Previously aware/);
  assert.match(question.askIf, /record no answer/);
  assert.equal(question.reportingContract.target.id, "kasani-veeresh");
  assert.equal(question.reportingContract.target.name, "Kasani Veeresh");
}
assert.equal(specification.questions[7].reportingContract.target.type, "CANDIDATE");
assert.equal(specification.questions[8].reportingContract.target.type, "CANDIDATE");
assert.equal(specification.questions[9].reportingContract.target.type, "LEADER");
for (const value of ["Previously aware", "Not previously aware"]) {
  assert.equal(normalizeOutputValue("candidate_awareness", value).status, "CODED");
  assert.equal(normalizeOutputValue("candidate_awareness", value).label, value);
  canonicalProbes += 1;
}
assert.deepEqual(specification.missingAnswerPolicy.conceptualStatesNotProviderLiterals, ["NOT_ANSWERED", "CANT_SAY", "REFUSED"]);
// Synthetic in-memory snapshot only: exercise the production frozen-instrument
// gate without saving an instrument, assigning an Iteration or touching a DB.
const frozenQuestions = specification.questions.map((question) => ({
  question_order: question.questionOrder, question_code: question.questionCode,
  question_text: question.questionText, question_type: question.questionType,
  options: question.options, required: question.required,
  metadata: { output_variables: question.outputVariables, required_for_completion: question.requiredForCompletion,
    ...(question.askIf ? { askIf: question.askIf } : {}),
    ...(question.reportingContract ? { reporting_contract: question.reportingContract } : {}) }
}));
const snapshot = buildQuestionnaireContentSnapshot({ id: "00000000-0000-4000-8000-000000000001",
  questionnaire_code: specification.questionnaireCode, questionnaire_name: specification.questionnaireName,
  version_number: specification.versionNumber, status: "DRAFT" }, frozenQuestions);
const resolved = resolveFrozenReportDefinitions(snapshot, snapshot.id);
assert.equal(resolved.instrument.frozen, true);
for (const question of contracts) {
  const definition = resolved.definitions.get(question.reportingContract.reportKey);
  assert.equal(definition.status, "CONTRACT_RECORDED");
  assert.deepEqual(definition.keys, question.outputVariables);
}
assert.equal(resolved.definitions.get("scheme_experience").status, "UNCONFIGURED");
const instrument = inspectInstrument({ questionnaire_id: snapshot.id, questionnaire_snapshot: snapshot });
assert.equal(instrument.reason, null);
assert.equal(instrument.questions.filter((question) => question.required).length, 6);
assert.equal(instrument.questions.filter((question) => !question.required).length, 4);
const evidence = {
  questionnaire_id: snapshot.id, questionnaire_snapshot: snapshot, execution_id: "synthetic-execution",
  execution_status: "COMPLETED", provider_attempt_id: "synthetic-provider-attempt", call_id: "synthetic-call",
  call_count: 1, identity_conflicts: 0, callback_received_at: "2026-10-15T00:00:00.000Z",
  connectivity_status: "CONNECTED", interaction_transcript: [{ text: "Synthetic completion-contract test only." }],
  response_variables: Object.fromEntries(specification.questions.slice(0, 6).map((question) =>
    [question.outputVariables[0], question.reportingContract.allowedValues[0]]))
};
let completion = buildInterviewCompletion(evidence);
assert.equal(completion.status, "COMPLETE_RECORDED");
assert.equal(completion.coverage.requiredQuestions, 6);
assert.equal(completion.coverage.accountedQuestions, 6);
for (const [value, field] of [["can't say", "cantSayQuestions"], ["refused", "refusedQuestions"]]) {
  completion = buildInterviewCompletion({ ...evidence, response_variables: {
    ...evidence.response_variables, incumbent_assessment: value } });
  assert.equal(completion.status, "COMPLETE_RECORDED", "An actual uncertainty or refusal is accounted for, never forced substantive");
  assert.equal(completion.coverage[field], 1);
}
completion = buildInterviewCompletion({ ...evidence, response_variables: {
  ...evidence.response_variables, incumbent_assessment: "no answer" } });
assert.equal(completion.status, "PARTIAL_RECORDED");
assert.equal(completion.coverage.missingQuestions, 1);
completion = buildInterviewCompletion({ ...evidence, response_variables: {
  ...evidence.response_variables, incumbent_assessment: "uncoded response" } });
assert.equal(completion.status, "TECHNICALLY_UNRESOLVED");
assert.ok(completion.reasonCodes.includes("OUTPUT_OUTSIDE_VALUE_CONTRACT"), "Uncoded answers are not invented substantive completion evidence");
completion = buildInterviewCompletion({ ...evidence, response_variables: Object.fromEntries(
  specification.questions.slice(0, 6).map((question) => [question.outputVariables[0], "can't say"])) });
assert.equal(completion.status, "NO_SUBSTANTIVE_RECORD");
console.log(JSON.stringify({ test: "Campaign MLC V2 neutral instrument and Sarvam output contracts", questions: 10,
  reportContracts: 9, contextOnlyQuestions: 1, canonicalProbes, specialStateProbes, frozenDefinitionProbes: 9,
  requiredCoreQuestions: 6, completionProbes: 6, enumFields, passed: true,
  questionnaireSaved: false, providerUpdate: false, callsPerformed: false }));
