import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildResearchReport as rawBuildResearchReport, canonical } from './research-report.js';
import { REPORT_CATALOG } from './report-catalog.js';
import { buildFieldworkDiagnostics, unavailableFieldworkDiagnostics } from './fieldwork-diagnostics.js';
import { summarizeOutput } from '../output-variable-standardization/output-normalization.repository.js';

const uid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const target = { type: 'NONE', id: '', name: '' };
const contract = (reportKey, outputVariables, options = {}) => ({ reportKey, outputVariables,
  valueType: 'CATEGORICAL', allowedValues: ['Positive', 'Negative'], target,
  missingPolicy: 'EXPLICIT_STATES', ...options });
function snapshot(contracts = [contract('party_salience', ['party_salience_unaided'], { allowedValues: ['BRS', 'BJP', 'Congress'] })]) {
  const questions = contracts.map((item, index) => ({ question_code: `Q_${index + 1}`, question_order: index + 1,
    question_text: `Neutral research question ${index + 1}?`, metadata: { output_variables: item.outputVariables, reporting_contract: item } }));
  return { id: uid(10), code: 'QUESTIONNAIRE_1', version: 1, snapshot_schema_version: 2,
    question_provenance: 'FROZEN_AT_SELECTION', questions, content_fingerprint: hash(questions) };
}
const measure = (rows, extra = {}) => ({ answerBase: rows.reduce((sum, row) => sum + row.respondents, 0),
  codedCount: rows.reduce((sum, row) => sum + row.respondents, 0), respondentBase: 10,
  suppressed: false, values: rows, ...extra });
const analysis = (overrides = {}) => ({ campaign: { id: uid(1), code: 'CAMPAIGN_2', name: 'Campaign 2', status: 'ACTIVE', manager_email: 'never-export@example.com' },
  scope: { level: 'ITERATION', iteration: { id: uid(2), number: 1, name: 'Iteration 1', completed: true }, run: null,
    insightScope: { iterationId: uid(2), filters: { gender: null, ageBand: null, mandal: null } } },
  segment: { respondentBase: 10, suppressed: false }, outputMeasures: {
    party_salience_unaided: measure([{ value: 'BRS', respondents: 5 }, { value: 'BJP', respondents: 5 }]),
    incumbent_assessment: measure([{ value: 'Positive', respondents: 5 }, { value: 'Negative', respondents: 5 }]),
    candidate_assessment: measure([{ value: 'Positive', respondents: 5 }, { value: 'Negative', respondents: 5 }]),
    veeresh_criterion_fit: measure([{ value: 'Strong fit', respondents: 5 }, { value: 'Poor fit', respondents: 5 }])
  }, normalizationVersion: 'OUTPUT_TAXONOMY_V2', comparison: { status: 'NOT_COMPARABLE', reasons: ['do-not-export-phone-9999999999'] },
  generatedAt: '2026-10-11T11:00:00Z', transcriptAnalysis: { text: 'Sensitive participant story' },
  respondents: [{ name: 'Participant Name', phone_number: '9999999999', political_rating: 5 }], ...overrides });
const base = { analysis: analysis(), snapshot: snapshot(), questionnaireId: uid(10), generatedAt: '2026-10-11T11:01:00Z', latestEvidenceAt: '2026-10-09T10:00:00Z' };
// Explicit exact-key aggregate fixtures; no test may silently pass native alias
// aggregates into a contract-bound report without a recorded source binding.
function buildResearchReport(input) {
  const exactMeasures = {};
  for (const question of input.snapshot?.questions || []) {
    const definition = question.metadata?.reporting_contract;
    const reportDefinition = REPORT_CATALOG.find((item) => item.id === definition?.reportKey);
    if (!reportDefinition?.measureKeys.length) continue;
    exactMeasures[definition.reportKey] = { source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables: definition.outputVariables,
      measure: input.analysis.outputMeasures?.[reportDefinition.measureKeys.find((key) => input.analysis.outputMeasures?.[key])] };
  }
  return rawBuildResearchReport({ ...input, exactMeasures: input.exactMeasures || exactMeasures });
}
const get = (report, key) => report.reports.find((item) => item.id === key);
let report = buildResearchReport(base);
assert.equal(report.schemaVersion, 2);
assert.equal(report.rulesVersion, 'RESEARCH_REPORT_V2');
assert.equal(report.fieldworkDiagnostics.status, 'NOT_AVAILABLE');
assert.equal(report.fieldworkDiagnostics.coverage.selectedBase, null, 'Absent diagnostics cannot fabricate an observed or eligible frame');
assert.equal(report.checks.find((item) => item.id === 'sampling-frame').status, 'PENDING');
assert.equal(report.checks.find((item) => item.id === 'survey-completion-validation').status, 'PENDING');
assert.equal(report.reports.length, REPORT_CATALOG.length);
assert.equal(get(report, 'party_salience').definitionStatus, 'CONTRACT_RECORDED');
assert.equal(get(report, 'party_salience').captureStatus, 'DESCRIPTIVE_AVAILABLE');
assert.deepEqual(get(report, 'party_salience').distribution, [{ value: 'BRS', respondents: 5, percentage: 50 }, { value: 'BJP', respondents: 5, percentage: 50 }]);
assert.equal(get(report, 'expected_change').definitionStatus, 'UNCONFIGURED');
assert.equal(get(report, 'expected_change').captureStatus, 'NOT_MEASURED');
assert.equal(get(report, 'expected_change').answerBase, null);
assert.equal(report.methodology.humanValidation, 'PENDING');
assert.equal(report.methodology.representativeSampling, 'NOT_VERIFIED');
assert.equal(report.methodology.weighting.status, 'UNAVAILABLE');
assert.equal(report.methodology.standardizedResponseRate, 'UNAVAILABLE');
assert.equal(get(rawBuildResearchReport(base), 'party_salience').captureStatus, 'MAPPING_PENDING', 'Native alias-pool aggregates cannot prove exact source binding');
assert.equal(report.scope.iterationNumber, 1, 'Campaign-local iteration number comes from authorized analysis');
assert.equal(report.sources.latestEvidenceAt, '2026-10-09T10:00:00.000Z', 'Evidence freshness is not report generation time');
assert.equal(buildResearchReport({ ...base, latestEvidenceAt: null }).sources.latestEvidenceAt, null);
assert.equal(report.checksum, hash(Object.fromEntries(Object.entries(report).filter(([key]) => !['checksum', 'reportId'].includes(key)))));
assert.equal(buildResearchReport(base).reportId, report.reportId, 'Same content and generatedAt is deterministic');
assert.notEqual(buildResearchReport({ ...base, generatedAt: '2026-10-11T11:02:00Z' }).reportId, report.reportId);
const diagnosticSourceMissing = buildResearchReport({ ...base,
  fieldworkDiagnostics: unavailableFieldworkDiagnostics('SOURCE_SCHEMA_UNAVAILABLE') });
assert.notEqual(diagnosticSourceMissing.checksum, report.checksum, 'The contact-cohort availability evidence is part of the report checksum');
const pollutedDiagnostics = { ...unavailableFieldworkDiagnostics('NOT_LOADED'),
  voter_id: uid(900), voter_name: 'NEVER_EXPORT_DIAGNOSTIC_NAME', phone_number: '9999999999',
  output_variables: { political_rating: 5 } };
const diagnosticEncoded = JSON.stringify(buildResearchReport({ ...base, fieldworkDiagnostics: pollutedDiagnostics }));
for (const value of ['NEVER_EXPORT_DIAGNOSTIC_NAME', '9999999999', 'political_rating', uid(900)]) {
  assert.ok(!diagnosticEncoded.includes(value), 'Diagnostics are whitelisted, not spread into the artifact');
}
const diagnosticScope = { campaignId: uid(1), iterationId: uid(2), filters: { gender: null, ageBand: null, mandal: null } };
const diagnosticAggregate = { scope_available: true, initial_run_count: 1, initial_contact_count: 10,
  initial_null_voter_count: 0, source_identity_conflicts: 0, source_status_conflicts: 0,
  selected_base: 10, attempted_base: 10, connected_base: 10, structured_base: 10, outside_initial_base: 0,
  observed_at: '2026-10-11T11:00:00Z', outcomes: [{ key: 'STRUCTURED_RECORD', participants: 10 }],
  demographics: { gender: [{ category: 'Female', selected: 10, structured: 10 }],
    ageBand: [{ category: '30–39', selected: 10, structured: 10 }],
    mandal: [{ category: 'Serilingampally', selected: 10, structured: 10 }] } };
const availableDiagnostics = buildFieldworkDiagnostics({ aggregate: diagnosticAggregate, scope: diagnosticScope,
  analysisRespondentBase: 10, iterationCompleted: true });
const reportWithDiagnostics = buildResearchReport({ ...base, fieldworkDiagnostics: availableDiagnostics });
assert.equal(reportWithDiagnostics.fieldworkDiagnostics.status, 'AVAILABLE');
assert.equal(reportWithDiagnostics.fieldworkDiagnostics.coverage.selectedBase, 10);
assert.deepEqual(reportWithDiagnostics.fieldworkDiagnostics.scope, diagnosticScope);
assert.notEqual(reportWithDiagnostics.checksum, report.checksum, 'Observed cohort diagnostics participate in canonical artifact identity');
const wrongCampaignDiagnostics = { ...availableDiagnostics, scope: { ...diagnosticScope, campaignId: uid(99) } };
const wrongIterationDiagnostics = { ...availableDiagnostics, scope: { ...diagnosticScope, iterationId: uid(99) } };
const wrongFilterDiagnostics = { ...availableDiagnostics, scope: { ...diagnosticScope,
  filters: { ...diagnosticScope.filters, gender: 'Male' } } };
for (const fieldworkDiagnostics of [wrongCampaignDiagnostics, wrongIterationDiagnostics, wrongFilterDiagnostics]) {
  const stale = buildResearchReport({ ...base, fieldworkDiagnostics });
  assert.equal(stale.fieldworkDiagnostics.status, 'NOT_AVAILABLE', 'Copied diagnostic evidence cannot certify another authorized cohort');
  assert.deepEqual(stale.fieldworkDiagnostics.scope, diagnosticScope, 'Unavailable scope reflects the authorized report, never copied evidence');
  assert.equal(stale.fieldworkDiagnostics.coverage.selectedBase, null);
}
const twentyRecordAggregate = { ...diagnosticAggregate, initial_contact_count: 20,
  selected_base: 20, attempted_base: 20, connected_base: 20, structured_base: 20,
  outcomes: [{ key: 'STRUCTURED_RECORD', participants: 20 }],
  demographics: { gender: [{ category: 'Female', selected: 20, structured: 20 }],
    ageBand: [{ category: '30–39', selected: 20, structured: 20 }],
    mandal: [{ category: 'Serilingampally', selected: 20, structured: 20 }] } };
const twentyRecordDiagnostics = buildFieldworkDiagnostics({ aggregate: twentyRecordAggregate,
  scope: diagnosticScope, analysisRespondentBase: 20, iterationCompleted: true });
const staleAlignment = buildResearchReport({ ...base,
  analysis: analysis({ segment: { respondentBase: 30, suppressed: false } }),
  fieldworkDiagnostics: twentyRecordDiagnostics });
assert.equal(staleAlignment.fieldworkDiagnostics.coverage.selectedBase, 20);
assert.equal(staleAlignment.fieldworkDiagnostics.sources.analysisBaseAlignment, 'MISMATCH', 'Authorized answer base30 cannot consume stale MATCHED flag for visible cohort20');
assert.equal(staleAlignment.checks.find((check) => check.id === 'fieldwork-analysis-alignment').status, 'REVIEW_REQUIRED');
const encoded = JSON.stringify(report);
for (const secret of ['never-export@example.com', 'Sensitive participant story', 'Participant Name', '9999999999', 'political_rating', 'declared_by_user_id']) assert.ok(!encoded.includes(secret), `${secret} cannot leak through whitelist`);

report = buildResearchReport({ ...base, analysis: analysis({ segment: { respondentBase: null, suppressed: true } }) });
assert.equal(get(report, 'party_salience').captureStatus, 'INSUFFICIENT_BASE');
assert.equal(get(report, 'party_salience').respondentBase, null);
assert.equal(get(report, 'party_salience').answerBase, null);
assert.deepEqual(get(report, 'party_salience').distribution, []);
report = buildResearchReport({ ...base, analysis: analysis({ outputMeasures: { party_salience_unaided: measure([{ value: 'BRS', respondents: 6 }, { value: 'BJP', respondents: 4 }]) } }) });
assert.equal(get(report, 'party_salience').captureStatus, 'SMALL_CELLS_WITHHELD');
assert.deepEqual(get(report, 'party_salience').distribution, []);
assert.deepEqual(report.findings, []);
report = buildResearchReport({ ...base, analysis: analysis({ outputMeasures: { party_salience_unaided: measure([{ value: 'BRS', respondents: 4 }], { codedCount: 4 }) } }) });
assert.equal(get(report, 'party_salience').answerBase, null);
assert.equal(get(report, 'party_salience').codedBase, null);
report = buildResearchReport({ ...base, analysis: analysis({ outputMeasures: { party_salience_unaided: measure([], { codedCount: 0 }) } }) });
assert.equal(get(report, 'party_salience').captureStatus, 'NO_RECORDED_ANSWERS');
assert.equal(get(report, 'party_salience').answerBase, 0);
report = buildResearchReport({ ...base, analysis: analysis({ outputMeasures: { party_salience_unaided: measure([{ value: 'Phone 9999999999', respondents: 10 }]) } }) });
assert.equal(get(report, 'party_salience').captureStatus, 'MAPPING_PENDING');
assert.ok(!JSON.stringify(report).includes('9999999999'));

const legacy = { id: uid(10), code: 'LEGACY_1', version: 1, metadata: { outputVariables: ['party_salience_unaided', 'veeresh_impression'] } };
report = buildResearchReport({ ...base, snapshot: legacy });
assert.equal(get(report, 'party_salience').definitionStatus, 'DEFINITION_ONLY');
assert.equal(get(report, 'party_salience').captureStatus, 'MAPPING_PENDING', 'Legacy metadata cannot certify captured measurement');
assert.deepEqual(get(report, 'party_salience').distribution, []);
assert.equal(get(report, 'candidate_impression').definitionStatus, 'TARGET_REQUIRED');
assert.equal(get(report, 'candidate_impression').captureStatus, 'MAPPING_PENDING');
assert.equal(report.sources.questionnaire.status, 'IDENTITY_ONLY');
const legacyTopLevel = { ...legacy, metadata: {}, questions: [{ question_code: 'Q1', question_order: 1,
  question_text: 'Legacy question', output_variables: ['party_salience_unaided'] }] };
assert.equal(get(buildResearchReport({ ...base, snapshot: legacyTopLevel }), 'party_salience').definitionStatus, 'DEFINITION_ONLY');
assert.deepEqual(get(buildResearchReport({ ...base, snapshot: legacyTopLevel }), 'party_salience').distribution, []);
report = buildResearchReport({ ...base, snapshot: null });
assert.equal(report.sources.questionnaire.status, 'NOT_AVAILABLE');
assert.ok(report.reports.every((item) => item.definitionStatus === 'UNCONFIGURED'));
report = buildResearchReport({ ...base, questionnaireId: uid(99) });
assert.equal(report.sources.questionnaire.status, 'IDENTITY_INCONSISTENT');
assert.equal(get(report, 'party_salience').definitionStatus, 'DEFINITION_ONLY');
const corrupted = snapshot(); corrupted.questions[0].question_text = 'Changed after fingerprint';
assert.equal(buildResearchReport({ ...base, snapshot: corrupted }).sources.questionnaire.status, 'CONTENT_PROVENANCE_INCOMPLETE');
assert.deepEqual(get(buildResearchReport({ ...base, snapshot: corrupted }), 'party_salience').distribution, []);
const unknown = snapshot([contract('party_salience', ['voter_phone'])]);
report = buildResearchReport({ ...base, snapshot: unknown });
assert.equal(get(report, 'party_salience').definitionStatus, 'UNSUPPORTED_MAPPING');
const numeric = snapshot([contract('party_salience', ['party_salience_unaided'], { valueType: 'NUMERIC', allowedValues: [] })]);
assert.equal(get(buildResearchReport({ ...base, snapshot: numeric }), 'party_salience').definitionStatus, 'UNSUPPORTED_MAPPING');
const ambiguous = snapshot([contract('party_salience', ['party_salience_unaided'], { allowedValues: ['A', 'B'] })]);
assert.equal(get(buildResearchReport({ ...base, snapshot: ambiguous }), 'party_salience').definitionStatus, 'UNSUPPORTED_MAPPING');
const restrictive = snapshot([contract('party_salience', ['party_salience_unaided'], { allowedValues: ['BRS', 'BJP'] })]);
report = buildResearchReport({ ...base, snapshot: restrictive, analysis: analysis({ segment: { respondentBase: 30, suppressed: false },
  outputMeasures: { party_salience_unaided: measure([{ value: 'BRS', respondents: 15 }, { value: 'Congress', respondents: 15 }], { respondentBase: 30 }) } }) });
assert.equal(get(report, 'party_salience').captureStatus, 'MAPPING_PENDING', 'A coded domain label outside frozen allowed values cannot be reported');
assert.deepEqual(get(report, 'party_salience').distribution, []);
assert.deepEqual(report.findings, []);
const incompatibleCategories = snapshot([
  contract('party_salience', ['party_salience_unaided'], { allowedValues: ['BRS', 'BJP'] }),
  contract('party_salience', ['party_salience'], { allowedValues: ['BRS', 'Congress'] })
]);
assert.equal(get(buildResearchReport({ ...base, snapshot: incompatibleCategories }), 'party_salience').definitionStatus, 'UNSUPPORTED_MAPPING');
const incompatibleTypes = snapshot([
  contract('party_salience', ['party_salience_unaided'], { allowedValues: ['BRS', 'BJP'] }),
  contract('party_salience', ['party_salience'], { valueType: 'TEXT', allowedValues: [] })
]);
assert.equal(get(buildResearchReport({ ...base, snapshot: incompatibleTypes }), 'party_salience').definitionStatus, 'UNSUPPORTED_MAPPING');
const textContract = snapshot([contract('party_salience', ['party_salience_unaided'], { valueType: 'TEXT', allowedValues: [] })]);
assert.equal(get(buildResearchReport({ ...base, snapshot: textContract }), 'party_salience').captureStatus, 'DESCRIPTIVE_AVAILABLE', 'Text contracts retain audited taxonomy mapping');
const invalid = snapshot(); invalid.questions[0].metadata.reporting_contract.reportKey = 'vote_forecast'; invalid.content_fingerprint = hash(invalid.questions);
assert.ok(buildResearchReport({ ...base, snapshot: invalid }).reports.every((item) => item.definitionStatus !== 'CONTRACT_RECORDED'));
const divergent = snapshot(); divergent.questions[0].metadata.output_variables = ['different_key']; divergent.content_fingerprint = hash(divergent.questions);
assert.equal(get(buildResearchReport({ ...base, snapshot: divergent }), 'party_salience').definitionStatus, 'INVALID_CONTRACT');

const candidate = { type: 'CANDIDATE', id: 'kasani_veeresh', name: 'Kasani Veeresh' };
const candidateContract = contract('candidate_impression', ['veeresh_impression'], { target: candidate });
report = buildResearchReport({ ...base, snapshot: snapshot([candidateContract]) });
assert.equal(get(report, 'candidate_impression').captureStatus, 'DESCRIPTIVE_AVAILABLE');
report = buildResearchReport({ ...base, snapshot: snapshot([{ ...candidateContract, target: { type: 'CANDIDATE', id: 'another_candidate', name: 'Another Candidate' } }]) });
assert.equal(get(report, 'candidate_impression').captureStatus, 'MAPPING_PENDING', 'Legacy Veeresh answers cannot be rebound to another person');
assert.deepEqual(get(report, 'candidate_impression').distribution, []);
const genericTargetContract = { ...candidateContract, outputVariables: ['candidate_impression'], target: { type: 'CANDIDATE', id: 'another_candidate', name: 'Another Candidate' } };
report = buildResearchReport({ ...base, snapshot: snapshot([genericTargetContract]), exactMeasures: {
  candidate_impression: { source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables: ['candidate_impression'],
    measure: measure([], { codedCount: 0 }) }
} });
assert.equal(get(report, 'candidate_impression').captureStatus, 'NO_RECORDED_ANSWERS', 'A generic candidate target never consumes native Veeresh alias-pool answers');
report = buildResearchReport({ ...base, snapshot: snapshot([genericTargetContract]), exactMeasures: {
  candidate_impression: { source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables: ['veeresh_impression'],
    measure: measure([{ value: 'Positive', respondents: 10 }]) }
} });
assert.equal(get(report, 'candidate_impression').captureStatus, 'MAPPING_PENDING', 'Source keys must exactly match the frozen definition');
report = buildResearchReport({ ...base, snapshot: snapshot([candidateContract, { ...candidateContract, target: { type: 'CANDIDATE', id: 'other', name: 'Other Candidate' } }]) });
assert.equal(get(report, 'candidate_impression').definitionStatus, 'CONFLICTING_TARGETS');
report = buildResearchReport({ ...base, snapshot: snapshot([contract('candidate_fit', ['veeresh_criterion_fit'], { target: candidate, allowedValues: ['Strong fit', 'Poor fit'] })]) });
assert.equal(get(report, 'candidate_fit').captureStatus, 'DESCRIPTIVE_AVAILABLE');
assert.equal(get(report, 'candidate_impression').definitionStatus, 'UNCONFIGURED', 'Fit is not impression');
for (const [key, output, type] of [['scheme_experience', 'scheme_experience', 'SCHEME']]) {
  report = buildResearchReport({ ...base, snapshot: snapshot([contract(key, [output], { target: { type, id: 'target_1', name: 'Explicit public target' } })]) });
  assert.equal(get(report, key).captureStatus, 'MAPPING_PENDING');
  assert.deepEqual(get(report, key).distribution, [], 'Do not fabricate charts for unsupported calculations');
}
// Dedicated future questions have independent exact-key distributions. No
// issue-priority, incumbent, candidate or party answer fills these constructs.
const namedLeader = { type: 'LEADER', id: 'public_leader_1', name: 'Named public leader' };
const newConstructs = [
  { id: 'development_priority', key: 'development_priority', values: ['jobs', 'education'], labels: ['Employment and jobs', 'Education and universities'], target },
  { id: 'expected_change', key: 'desired_change', values: ['water', 'skills'], labels: ['Civic services and infrastructure', 'Skills and professional development'], target },
  { id: 'leader_assessment', key: 'leader_assessment', values: ['good', 'bad'], labels: ['Positive', 'Negative'], target: namedLeader }
];
const newContracts = newConstructs.map((item) => contract(item.id, [item.key], { allowedValues: item.labels, target: item.target }));
const newInstrument = snapshot(newContracts);
const newRecords = Array.from({ length: 10 }, (_, index) => ({ response_variables: {
  graduate_issue_priority: 'representation', incumbent_assessment: 'mixed', candidate_impression: 'mixed',
  party_salience_unaided: 'Congress', perceived_issue_leader_aided: 'BRS',
  ...Object.fromEntries(newConstructs.map((item) => [item.key, item.values[index < 5 ? 0 : 1]]))
} }));
const exactFor = (records, definitions = newConstructs) => Object.fromEntries(definitions.map((item) => [item.id, {
  source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables: [item.key], measure: summarizeOutput(records, [item.key])
}]));
report = rawBuildResearchReport({ ...base, snapshot: newInstrument, exactMeasures: exactFor(newRecords) });
for (const item of newConstructs) {
  const result = get(report, item.id);
  assert.equal(result.definitionStatus, 'CONTRACT_RECORDED');
  assert.equal(result.captureStatus, 'DESCRIPTIVE_AVAILABLE');
  assert.equal(result.answerBase, 10);
  assert.equal(result.codedBase, 10);
  assert.deepEqual(new Set(result.distribution.map((row) => row.value)), new Set(item.labels));
  assert.ok(result.distribution.every((row) => row.respondents === 5 && row.percentage === 50));
  assert.deepEqual(result.target, item.id === 'leader_assessment' ? namedLeader : null);
  assert.ok(!result.distribution.some((row) => ['Representation and accessibility', 'Mixed', 'Congress', 'BRS'].includes(row.value)));
}
for (const item of newConstructs) {
  const instrument = snapshot([newContracts.find((entry) => entry.reportKey === item.id)]);
  const unrelated = newRecords.map(() => ({ response_variables: { graduate_issue_priority: 'jobs', incumbent_assessment: 'good',
    candidate_impression: 'good', party_salience_unaided: 'BRS', perceived_issue_leader_aided: 'KCR' } }));
  const missing = rawBuildResearchReport({ ...base, snapshot: instrument, exactMeasures: exactFor(unrelated, [item]) });
  assert.notEqual(get(missing, item.id).captureStatus, 'DESCRIPTIVE_AVAILABLE', `${item.id} cannot borrow a different question's answer`);
  assert.deepEqual(get(missing, item.id).distribution, []);
  const wrongBinding = exactFor(newRecords, [item]);
  wrongBinding[item.id].outputVariables = ['incumbent_assessment'];
  assert.equal(get(rawBuildResearchReport({ ...base, snapshot: instrument, exactMeasures: wrongBinding }), item.id).captureStatus, 'MAPPING_PENDING');
  const sparse = Array.from({ length: 10 }, (_, index) => ({ response_variables: { [item.key]: item.values[index < 9 ? 0 : 1] } }));
  const withheld = get(rawBuildResearchReport({ ...base, snapshot: instrument, exactMeasures: exactFor(sparse, [item]) }), item.id);
  assert.equal(withheld.captureStatus, 'SMALL_CELLS_WITHHELD');
  for (const key of ['answerBase', 'codedBase', 'respondentBase']) assert.equal(withheld[key], null);
  assert.deepEqual(withheld.distribution, []);
  // Missing and uncertainty/refusal are separate from substantive answers;
  // each state has five observations so no suppressed complement is disclosed.
  const states = [...Array(5).fill(item.values[0]), ...Array(5).fill(item.values[1]),
    ...Array(5).fill("can't say"), ...Array(5).fill('refused'), ...Array(5).fill('unrecognized wording'), ...Array(5).fill('no answer')];
  const stateReport = get(rawBuildResearchReport({ ...base, snapshot: instrument,
    analysis: analysis({ segment: { respondentBase: 30, suppressed: false } }),
    exactMeasures: exactFor(states.map((value) => ({ response_variables: { [item.key]: value } })), [item]) }), item.id);
  assert.equal(stateReport.captureStatus, 'DESCRIPTIVE_AVAILABLE');
  assert.equal(stateReport.answerBase, 25);
  assert.equal(stateReport.respondentBase, 30);
  assert.equal(stateReport.codedBase, 10);
  for (const value of ["Can't say", 'Declined to answer', 'Uncoded response']) assert.ok(stateReport.distribution.some((row) => row.value === value && row.respondents === 5));
  assert.ok(!stateReport.distribution.some((row) => row.value === 'no answer'));
}
const leaderContract = newContracts.find((item) => item.reportKey === 'leader_assessment');
for (const invalidTarget of [target, { type: 'CANDIDATE', id: 'candidate_1', name: 'A candidate' }]) {
  const invalidLeader = snapshot([{ ...leaderContract, target: invalidTarget }]);
  const result = get(rawBuildResearchReport({ ...base, snapshot: invalidLeader, exactMeasures: exactFor(newRecords) }), 'leader_assessment');
  assert.equal(result.definitionStatus, 'INVALID_CONTRACT');
  assert.deepEqual(result.distribution, []);
}
const conflictingLeaders = snapshot([leaderContract, { ...leaderContract, outputVariables: ['leader_sentiment'],
  target: { type: 'LEADER', id: 'public_leader_2', name: 'Different public leader' } }]);
assert.equal(get(rawBuildResearchReport({ ...base, snapshot: conflictingLeaders, exactMeasures: exactFor(newRecords) }), 'leader_assessment').definitionStatus, 'CONFLICTING_TARGETS');
const mixedLeaderAliases = snapshot([{ ...leaderContract, outputVariables: ['leader_assessment', 'leader_sentiment'] }]);
const conflictingAliasReport = rawBuildResearchReport({ ...base, snapshot: mixedLeaderAliases, exactMeasures: {
  leader_assessment: { source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables: ['leader_assessment', 'leader_sentiment'],
    measure: summarizeOutput(Array.from({ length: 10 }, () => ({ response_variables: { leader_assessment: 'good', leader_sentiment: 'bad' } })), ['leader_assessment', 'leader_sentiment']) }
} });
assert.equal(get(conflictingAliasReport, 'leader_assessment').captureStatus, 'INSUFFICIENT_BASE');
assert.deepEqual(get(conflictingAliasReport, 'leader_assessment').distribution, []);
const design = { design_declared: true, revision: 3, declared_at: '2026-10-10T10:00:00Z', sampling_method: 'CENSUS',
  weighting_status: 'PLANNED', fieldwork_mode: 'AI_ASSISTED_OUTBOUND_VOICE', cohort_design: 'SAME_PARTICIPANTS', declared_by_user_id: 'secret-actor' };
report = buildResearchReport({ ...base, design });
assert.equal(report.methodology.declarationStatus, 'DECLARED');
assert.equal(report.methodology.weighting.status, 'UNAVAILABLE');
assert.equal(report.methodology.representativeSampling, 'NOT_VERIFIED');
assert.equal(report.methodology.humanValidation, 'PENDING');
assert.ok(!JSON.stringify(report).includes('secret-actor'));
const runAnalysis = analysis(); runAnalysis.scope.level = 'RUN'; runAnalysis.scope.run = { id: uid(3), number: 2, status: 'RUNNING' };
runAnalysis.scope.iteration.completed = false;
report = buildResearchReport({ ...base, analysis: runAnalysis });
assert.equal(report.scope.requestedLevel, 'RUN');
assert.equal(report.scope.insightLevel, 'ITERATION');
assert.equal(report.scope.fieldworkStatus, 'IN_PROGRESS');
assert.match(report.scope.description, /operations only/);

// Repository test imports replace production-only dependencies, not its SQL or
// control flow. No connection to RDS, cloud, Sarvam or real calls is performed.
const repositoryUrl = new URL('./research-report.repository.js', import.meta.url);
let repositorySource = await readFile(repositoryUrl, 'utf8');
repositorySource = repositorySource.replace(/import \{ getDb \} from '[^']+';/, "const getDb = () => { throw new Error('Production DB forbidden in isolated test'); };")
  .replace(/import \{ resolveResearchScope \} from '[^']+';/, "const resolveResearchScope = () => { throw new Error('Tests must inject an authorized scope'); };")
  .replace("'./research-report.js'", JSON.stringify(pathToFileURL(fileURLToPath(new URL('./research-report.js', import.meta.url))).href))
  .replace("'./report-catalog.js'", JSON.stringify(new URL('./report-catalog.js', import.meta.url).href))
  .replace(/import \{ loadFieldworkDiagnostics \} from '[^']+';/, "const loadFieldworkDiagnostics = async () => unavailableFieldworkDiagnostics('NOT_LOADED');")
  .replace("'./fieldwork-diagnostics.js'", JSON.stringify(new URL('./fieldwork-diagnostics.js', import.meta.url).href))
  .replace("'./output-normalization.repository.js'", JSON.stringify(new URL('../output-variable-standardization/output-normalization.repository.js', import.meta.url).href));
const repository = await import(`data:text/javascript;base64,${Buffer.from(repositorySource).toString('base64')}`);
const queries = [];
const db = { query: async (sql, values) => { queries.push({ sql, values }); return { rows: /FROM analytics_research_design_registry_v2/.test(sql) ? [design] : /FROM authorized_rows selected/.test(sql) ? Array.from({ length: 10 }, (_, index) => ({ response_variables: { party_salience_unaided: index < 5 ? 'BRS' : 'BJP', party_salience: 'Congress' } })) : [{ questionnaire_id: uid(10), questionnaire_snapshot: snapshot(), voice_agent_snapshot: { catalog_id: uid(9), app_id: 'APP_ID', app_version: 5, connection_id: 'DO_NOT_EXPORT', outbound_phone_number: '9999999999' }, latest_evidence_at: '2026-10-08T10:00:00Z' }] }; } };
let dbCalls = 0;
let diagnosticCalls = 0;
await assert.rejects(repository.loadResearchReport(uid(1), { role_code: 'CAMPAIGNER' }, {}, { analyze: async () => { throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); }, getDb: async () => { dbCalls++; return db; }, loadFieldworkDiagnostics: async () => { diagnosticCalls++; throw new Error('Must not diagnose before authorization'); } }), (error) => error.statusCode === 403);
assert.equal(dbCalls, 0, 'Campaign authorization must happen before all database metadata access');
assert.equal(diagnosticCalls, 0, 'Authorization must also precede diagnostics');
const selection = { iterationId: uid(2), runId: uid(3), gender: 'Female', ageBand: '30–39', mandal: 'Serilingampally' };
const filtered = analysis(); filtered.scope.insightScope.filters = { gender: 'Female', ageBand: '30–39', mandal: 'Serilingampally' };
report = await repository.loadResearchReport(uid(1), { role_code: 'ADMIN' }, selection, { analyze: async (id, actor, options) => { assert.deepEqual(options, selection); return filtered; }, getDb: async () => { dbCalls++; return db; }, loadFieldworkDiagnostics: async (loadedDb, options) => {
  assert.equal(loadedDb, db);
  assert.deepEqual(options, { campaignId: uid(1), iterationId: uid(2), filters: filtered.scope.insightScope.filters,
    iterationCompleted: true, analysisRespondentBase: 10 });
  diagnosticCalls++;
  return unavailableFieldworkDiagnostics('INITIAL_COHORT_UNAVAILABLE');
} });
assert.equal(dbCalls, 1);
assert.equal(diagnosticCalls, 1);
assert.deepEqual(queries[0].values, [uid(1), uid(2), 'Female', '30–39', 'Serilingampally']);
assert.deepEqual(queries[1].values, [uid(1), uid(2), 'Female', '30–39', 'Serilingampally', ['party_salience_unaided']]);
assert.match(queries[1].sql, /SELECT DISTINCT ON \(call_record.voter_id\)/);
assert.match(queries[1].sql, /lower\(btrim\(output.key, U&'[^']+'\)\) = ANY\(\$6::text\[\]\)/);
assert.deepEqual(get(report, 'party_salience').distribution, [{ value: 'BJP', respondents: 5, percentage: 50 }, { value: 'BRS', respondents: 5, percentage: 50 }], 'Undeclared Congress alias is not included');
assert.match(queries[0].sql, /campaign\.id = \$1::uuid AND iteration\.id = \$2::uuid/);
assert.ok(!queries[0].sql.includes('run.id ='), 'Run selection cannot truncate Iteration insight evidence');
assert.ok(!queries.some((query) => /FROM questionnaires|JOIN questionnaires|interaction_transcript|declared_by_user_id/.test(query.sql)), 'Only frozen instrument and aggregate timestamp/method metadata are loaded');
assert.equal(report.sources.voiceAgent.id, uid(9));
assert.equal(report.sources.voiceAgent.version, 5);
assert.ok(!JSON.stringify(report).includes('DO_NOT_EXPORT'));
assert.ok(!JSON.stringify(report).includes('9999999999'));
assert.deepEqual(report.scope.filters, filtered.scope.insightScope.filters);
let absentDB = 0;
const absentScope = analysis(); absentScope.scope.iteration = null; absentScope.scope.insightScope.iterationId = null;
const absentReport = await repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => absentScope, getDb: async () => { absentDB++; return db; }, loadFieldworkDiagnostics: async () => { throw new Error('No selected Iteration must not load diagnostics'); } });
assert.equal(absentDB, 0, 'No completed Iteration must not load current or other Iteration metadata');
assert.equal(absentReport.fieldworkDiagnostics.status, 'NOT_AVAILABLE');
assert.equal(absentReport.fieldworkDiagnostics.coverage.selectedBase, null);
await assert.rejects(repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => ({ ...absentScope, campaign: { id: uid(99) } }), getDb: async () => { throw new Error('Must not load'); } }), (error) => error.statusCode === 409);
await assert.rejects(repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => ({ ...analysis(), campaign: { id: uid(99) } }), getDb: async () => { throw new Error('Must not load'); } }), (error) => error.statusCode === 409);
const mismatchedIteration = analysis(); mismatchedIteration.scope.iteration.id = uid(99);
await assert.rejects(repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => mismatchedIteration,
  getDb: async () => { throw new Error('Must not load inconsistent Iteration metadata'); },
  loadFieldworkDiagnostics: async () => { throw new Error('Must not diagnose inconsistent Iteration'); } }), (error) => error.statusCode === 409);
const missingInsightScope = analysis(); missingInsightScope.scope.insightScope.iterationId = null;
await assert.rejects(repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => missingInsightScope,
  getDb: async () => { throw new Error('Must not load mismatched null insight scope'); } }), (error) => error.statusCode === 409);
report = await repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => analysis(), getDb: async () => ({ query: async (sql) => { if (/FROM analytics_research_design_registry_v2/.test(sql)) throw Object.assign(new Error('missing old schema'), { code: '42P01' }); return { rows: /FROM authorized_rows selected/.test(sql) ? [] : [{ questionnaire_snapshot: snapshot(), questionnaire_id: uid(10) }] }; } }) });
assert.equal(report.methodology.declarationStatus, 'NOT_DECLARED');
assert.equal(report.sources.latestEvidenceAt, null);
for (const code of ['42P01', '42703']) {
  report = await repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => analysis(), getDb: async () => db,
    loadFieldworkDiagnostics: async () => { throw Object.assign(new Error('Diagnostic schema is absent'), { code }); } });
  assert.equal(report.fieldworkDiagnostics.status, 'NOT_AVAILABLE');
  assert.equal(report.fieldworkDiagnostics.coverage.selectedBase, null);
}
for (const code of ['28P01', '28000', 'ECONNRESET', 'ETIMEDOUT']) {
  await assert.rejects(repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => analysis(), getDb: async () => db,
    loadFieldworkDiagnostics: async () => { throw Object.assign(new Error('Real diagnostic source failure'), { code }); } }),
    (error) => error.code === code, 'RDS, permission and network errors cannot become an unavailable/empty cohort');
}
await assert.rejects(repository.loadResearchReport(uid(1), {}, {}, { analyze: async () => analysis(), getDb: async () => db,
  loadFieldworkDiagnostics: async () => { throw Object.assign(new Error('Diagnostic scope forbidden'), { statusCode: 403 }); } }),
  (error) => error.statusCode === 403);
const routeSource = await readFile(new URL('./research-report.routes.js', import.meta.url), 'utf8');
assert.match(routeSource, /router\.get\('\/analytics\/campaigns\/:campaignId\/research-report', requireAuth,/);
assert.match(routeSource, /requireRole\(\['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER'\]\)/);
assert.ok(!routeSource.includes('router.use'), 'The router must not apply a broad global role guard to unrelated catalogue routes');
assert.match(routeSource, /Cache-Control.*no-store/);
assert.match(routeSource, /gender: enumQuery/);
assert.match(routeSource, /ageBand: enumQuery/);
console.log('Aggregate research report scope, provenance, methodology, checksum, privacy and disclosure tests passed.');
