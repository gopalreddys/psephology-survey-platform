import { createHash } from 'node:crypto';
import { buildResearchReport, canonical } from './research-report.js';
import { REPORT_CATALOG } from './report-catalog.js';
import { buildFieldworkDiagnostics, unavailableFieldworkDiagnostics } from './fieldwork-diagnostics.js';

export const syntheticId = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const labels = {
  party: ['BRS', 'BJP'], leadership: ['BRS', 'Congress'], assessment: ['Positive', 'Negative'],
  suitability: ['Strong fit', 'Poor fit'], issue: ['Employment and jobs', 'Education and universities']
};
export function syntheticContractCoverage() {
  const questions = REPORT_CATALOG.map((report, index) => ({
    id: syntheticId(index + 20), questionCode: `Q_REPORT_${index + 1}`, order: index + 1,
    text: `Synthetic question ${index + 1}: Which public-service concern or assessment would you like to share? This is layout test content, not a live survey question.`,
    contract: {
      reportKey: report.id, outputVariables: [report.outputKeys[0]], valueType: 'CATEGORICAL', allowedValues: labels[report.domain],
      target: report.targetType ? {
        type: report.targetType, id: report.targetType === 'CANDIDATE' ? 'kasani_veeresh' : `synthetic_${report.targetType.toLowerCase()}`,
        name: report.targetType === 'CANDIDATE' ? 'Kasani Veeresh' : 'Synthetic named target for a long assessment label and reporting coverage layout check'
      } : { type: 'NONE', id: '', name: '' }, missingPolicy: 'EXPLICIT_STATES'
    }, contractValid: true, contractError: null, expectedContractFingerprint: 'a'.repeat(64)
  }));
  return {
    questionnaire: { id: syntheticId(10), code: 'SYNTHETIC_LAYOUT_V1', name: 'Synthetic reporting instrument', version: 1, status: 'DRAFT' },
    locked: false, lockReason: null, usedByIterations: 0, metadataWritable: true, questions
  };
}
export function syntheticFieldworkDiagnostics({ campaignId = syntheticId(1), iterationId = syntheticId(2), filters = {}, mode = 'available', iterationCompleted = true } = {}) {
  const scope = { campaignId, iterationId, filters: { gender: null, ageBand: null, mandal: null, ...filters } };
  if (mode === 'unavailable') return unavailableFieldworkDiagnostics('SOURCE_SCHEMA_UNAVAILABLE', scope);
  const partition = (kind, categories) => scope.filters[kind] ? [{ category: scope.filters[kind], selected: 60, structured: 30 }]
    : categories.map((category) => ({ category, selected: 60 / categories.length, structured: 30 / categories.length }));
  const demographics = {
    gender: partition('gender', ['Female', 'Male']), ageBand: partition('ageBand', ['18–29', '30–39', '50+']),
    mandal: partition('mandal', ['Synthetic North Mandal', 'Synthetic South Mandal'])
  };
  if (mode === 'demographic-withheld') demographics.mandal = [
    { category: 'Hidden tiny synthetic geography', selected: 1, structured: 1 },
    { category: 'Synthetic larger geography', selected: 59, structured: 29 }
  ];
  if (mode === 'complement-withheld') demographics.gender = [
    { category: 'Female', selected: 18, structured: 15 }, { category: 'Male', selected: 42, structured: 15 }
  ];
  const aggregate = {
    scope_available: true, observed_at: '2026-10-10T10:00:00.000Z', initial_run_count: 1, initial_contact_count: 60,
    initial_null_voter_count: 0, source_identity_conflicts: 0, source_status_conflicts: 0,
    selected_base: 60, attempted_base: 50, connected_base: 40, structured_base: 30, outside_initial_base: 0,
    outcomes: [{ key: 'STRUCTURED_RECORD', participants: 30 }, { key: 'BUSY', participants: mode === 'withheld' ? 9 : 10 },
      { key: 'NO_ANSWER', participants: 10 }, { key: 'NOT_ATTEMPTED', participants: 10 },
      ...(mode === 'withheld' ? [{ key: 'PENDING', participants: 1 }] : [])], demographics
  };
  if (mode === 'zero') Object.assign(aggregate, { selected_base: 0, attempted_base: 0, connected_base: 0, structured_base: 0,
    outcomes: [], demographics: { gender: [], ageBand: [], mandal: [] } });
  return buildFieldworkDiagnostics({ aggregate, scope, iterationCompleted, analysisRespondentBase: mode === 'zero' ? 0 : 30 });
}
export function syntheticResearchReport({ campaignId = syntheticId(1), iterationId = syntheticId(2), filters = {}, generatedAt = '2026-10-11T11:01:00.000Z', noSnapshot = false, diagnosticMode = 'available', iterationCompleted = true } = {}) {
  const coverage = syntheticContractCoverage();
  const questions = coverage.questions.map((question) => ({ question_code: question.questionCode, question_order: question.order,
    question_text: question.text, metadata: { output_variables: question.contract.outputVariables, reporting_contract: question.contract } }));
  const snapshot = {
    id: syntheticId(10), code: 'SYNTHETIC_LAYOUT_V1', version: 1, snapshot_schema_version: 2,
    question_provenance: 'FROZEN_AT_SELECTION', questions,
    content_fingerprint: createHash('sha256').update(JSON.stringify(canonical(questions))).digest('hex')
  };
  const outputMeasures = Object.fromEntries(REPORT_CATALOG.filter((report) => report.measureKeys.length).flatMap((report) => report.measureKeys.map((key) => [key, {
    answerBase: 30, codedCount: 30, respondentBase: 30, suppressed: false,
    values: labels[report.domain].map((value) => ({ value, respondents: 15 }))
  }])));
  const exactMeasures = Object.fromEntries(REPORT_CATALOG.filter((report) => report.measureKeys.length).map((report) => {
    const contract = coverage.questions.find((question) => question.contract.reportKey === report.id).contract;
    return [report.id, {
      source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables: [...contract.outputVariables],
      measure: {
        answerBase: 30, codedCount: 30, respondentBase: 30, suppressed: false,
        values: labels[report.domain].map((value) => ({ value, respondents: 15 }))
      }
    }];
  }));
  const analysis = {
    campaign: { id: campaignId, code: 'SYNTHETIC_C01', name: 'Synthetic research reporting preview', status: 'ACTIVE' },
    scope: { level: 'ITERATION', iteration: { id: iterationId, number: 1, name: 'Synthetic Iteration 1', completed: iterationCompleted }, run: null,
      insightScope: { iterationId, filters: { gender: null, ageBand: null, mandal: null, ...filters } } },
    segment: { respondentBase: diagnosticMode === 'zero' ? 0 : 30, suppressed: diagnosticMode === 'zero' }, outputMeasures, normalizationVersion: 'OUTPUT_TAXONOMY_V2',
    comparison: { status: 'NOT_COMPARABLE' }, generatedAt: '2026-10-11T11:00:00.000Z'
  };
  return buildResearchReport({ analysis, snapshot: noSnapshot ? null : snapshot, questionnaireId: syntheticId(10), exactMeasures,
    generatedAt, latestEvidenceAt: '2026-10-10T10:00:00.000Z',
    fieldworkDiagnostics: syntheticFieldworkDiagnostics({ campaignId, iterationId, filters, mode: diagnosticMode, iterationCompleted }),
    agentSnapshot: { catalog_id: syntheticId(11), agent_code: 'SYNTHETIC_AGENT', app_id: 'SyntheticAgent', app_version: 2 },
    design: { design_declared: true, revision: 1, declared_at: '2026-10-10T10:00:00.000Z', fieldwork_mode: 'AI_ASSISTED_OUTBOUND_VOICE',
      sampling_method: 'CENSUS', cohort_design: 'SAME_PARTICIPANTS', weighting_status: 'NOT_CONFIGURED' }
  });
}
