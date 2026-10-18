import { createHash } from 'node:crypto';
import { REPORT_CATALOG, RESEARCH_REPORT_RULES_VERSION, MINIMUM_RESEARCH_REPORT_BASE } from './report-catalog.js';
import { validateReportingContract } from './reporting-contract.validation.js';
import { sanitizeFieldworkDiagnostics, unavailableFieldworkDiagnostics } from './fieldwork-diagnostics.js';

const ALLOWED_LABELS = {
  party: ['BRS', 'BJP', 'Congress', 'Communist / Left', 'Independent / graduate group', 'None', 'Multiple parties mentioned'],
  leadership: ['BRS', 'BJP', 'Congress', 'Communist / Left', 'Independent / graduate group', 'K. Chandrashekar Rao', 'K. T. Rama Rao', 'Revanth Reddy', 'Other', 'None', 'Multiple leaders mentioned'],
  assessment: ['Positive', 'Neutral', 'Negative', 'Mixed'],
  suitability: ['Strong fit', 'Some fit', 'Poor fit', 'Mixed'],
  issue: ['Employment and jobs', 'Education and universities', 'Skills and professional development', 'Representation and accessibility', 'Civic services and infrastructure', 'Multiple issues mentioned', 'None']
};
const EXPLICIT_STATES = ["Can't say", 'Declined to answer', 'Uncoded response'];
const ENUMS = {
  sampling: ['CENSUS', 'SIMPLE_RANDOM', 'STRATIFIED_RANDOM', 'CLUSTER', 'SYSTEMATIC', 'QUOTA', 'PURPOSIVE', 'CONVENIENCE', 'DIRECTIONAL_NON_PROBABILITY'],
  cohort: ['SAME_PARTICIPANTS', 'INDEPENDENT_SAMPLES', 'PARTIAL_OVERLAP'],
  mode: ['AI_ASSISTED_OUTBOUND_VOICE', 'HUMAN_ASSISTED_PHONE', 'MIXED_MODE'],
  weighting: ['NOT_REQUIRED', 'PLANNED', 'NOT_CONFIGURED'],
  status: ['PLANNED', 'DRAFT', 'READY', 'ACTIVE', 'RUNNING', 'PAUSED', 'COMPLETED', 'LOCKED', 'FAILED', 'CANCELLED', 'ARCHIVED'],
  comparison: ['BASELINE', 'COMPARABLE', 'NOT_COMPARABLE']
};
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, maximum = 160) => typeof value === 'string' ? value.trim()
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
  .replace(/\+?\d[\d\s-]{7,}\d/g, '[number redacted]').slice(0, maximum) : null;
const count = (value) => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
  && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const enumValue = (value, permitted) => permitted.includes(value) ? value : null;
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value) ? value : null;
const date = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function outputKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === 'string' ? item : object(item).key || object(item).name)
    .filter((item) => typeof item === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(item)))];
}

export function evaluateFrozenInstrument(snapshot) {
  const instrument = object(snapshot);
  const questions = Array.isArray(instrument.questions) ? instrument.questions : [];
  const hasQuestions = questions.length > 0 && questions.every((question) =>
    text(question?.question_code) && text(question?.question_text, 10000));
  const questionStructureRecorded = hasQuestions && questions.every((question) => count(question.question_order) > 0)
    && new Set(questions.map((question) => question.question_code.trim().toUpperCase())).size === questions.length
    && new Set(questions.map((question) => count(question.question_order))).size === questions.length;
  const fingerprint = typeof instrument.content_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(instrument.content_fingerprint)
    ? instrument.content_fingerprint : null;
  const identityRecorded = Boolean(identifier(instrument.id) && identifier(instrument.code)
    && count(instrument.version) > 0);
  const frozen = identityRecorded && Number(instrument.snapshot_schema_version) === 2
    && instrument.question_provenance === 'FROZEN_AT_SELECTION' && questionStructureRecorded && fingerprint === hash(questions);
  const legacyKeys = new Set([
    ...outputKeys(instrument.output_variables), ...outputKeys(instrument.outputVariables),
    ...outputKeys(object(instrument.metadata).output_variables), ...outputKeys(object(instrument.metadata).outputVariables),
    ...questions.flatMap((question) => [...outputKeys(question.output_variables), ...outputKeys(question.outputVariables),
      ...outputKeys(object(question.metadata).output_variables), ...outputKeys(object(question.metadata).outputVariables)])
  ]);
  const definitions = new Map();
  const invalidReportKeys = new Set();
  for (const question of questions) {
    const contractInput = object(question.metadata).reporting_contract;
    if (!contractInput) continue;
    try {
      const result = validateReportingContract(contractInput);
      const contract = result.contract || result;
      const metadataOutputs = outputKeys(object(question.metadata).output_variables);
      if (JSON.stringify([...metadataOutputs].sort()) !== JSON.stringify([...contract.outputVariables].sort())) {
        invalidReportKeys.add(contract.reportKey);
        continue;
      }
      const list = definitions.get(contract.reportKey) || [];
      list.push({ ...contract, questionCode: identifier(question.question_code) });
      definitions.set(contract.reportKey, list);
    } catch {
      // Arbitrary invalid metadata and question text never enter the report.
      if (REPORT_CATALOG.some((report) => report.id === contractInput.reportKey)) invalidReportKeys.add(contractInput.reportKey);
    }
  }
  return { frozen, identityRecorded, fingerprint, questions, legacyKeys, definitions, invalidReportKeys,
    source: { id: identifier(instrument.id), code: identifier(instrument.code), version: identifier(String(instrument.version ?? '')),
      contentFingerprint: fingerprint, frozenQuestionCount: hasQuestions ? questions.length : null,
      definitionSource: frozen ? 'FROZEN_AT_SELECTION' : 'RECORDED_SNAPSHOT_ONLY',
      status: frozen ? 'FROZEN_CONTENT_RECORDED' : hasQuestions ? 'CONTENT_PROVENANCE_INCOMPLETE' : identityRecorded ? 'IDENTITY_ONLY' : 'NOT_AVAILABLE' } };
}

function definitionFor(report, instrument) {
  const definitions = instrument.definitions.get(report.id) || [];
  const legacy = report.outputKeys.filter((key) => instrument.legacyKeys.has(key));
  if (instrument.invalidReportKeys.has(report.id)) return { status: 'INVALID_CONTRACT', keys: [], target: null, questionCodes: [] };
  if (definitions.length) {
    const targets = new Set(definitions.map((item) => JSON.stringify(item.target)));
    if (targets.size > 1) return { status: 'CONFLICTING_TARGETS', keys: [], target: null, questionCodes: [] };
    const valueContracts = new Set(definitions.map((item) => JSON.stringify({
      valueType: item.valueType, allowedValues: [...item.allowedValues].sort()
    })));
    if (valueContracts.size > 1) return { status: 'UNSUPPORTED_MAPPING', keys: [], target: null, questionCodes: [] };
    const keys = [...new Set(definitions.flatMap((item) => item.outputVariables))];
    if (keys.some((key) => !report.outputKeys.includes(key))) return { status: 'UNSUPPORTED_MAPPING', keys, target: null, questionCodes: [] };
    if (definitions.some((item) => item.valueType === 'NUMERIC' || (item.valueType === 'CATEGORICAL'
      && item.allowedValues.some((value) => !ALLOWED_LABELS[report.domain].includes(value))))) {
      return { status: 'UNSUPPORTED_MAPPING', keys, target: null, questionCodes: [] };
    }
    const target = definitions[0].target.type === 'NONE' ? null : {
      type: definitions[0].target.type, id: identifier(definitions[0].target.id), name: text(definitions[0].target.name)
    };
    if (report.targetType && target?.type !== report.targetType) return { status: 'TARGET_REQUIRED', keys, target: null, questionCodes: [] };
    return { status: instrument.frozen ? 'CONTRACT_RECORDED' : 'DEFINITION_ONLY', keys, target,
      valueType: definitions[0].valueType, allowedValues: definitions[0].allowedValues,
      questionCodes: definitions.map((item) => item.questionCode).filter(Boolean) };
  }
  if (legacy.length) return { status: report.targetType ? 'TARGET_REQUIRED' : 'DEFINITION_ONLY', keys: legacy, target: null, questionCodes: [] };
  return { status: 'UNCONFIGURED', keys: [], target: null, questionCodes: [] };
}

export function resolveFrozenReportDefinitions(snapshot, questionnaireId) {
  const instrument = evaluateFrozenInstrument(snapshot);
  if (snapshot && (!questionnaireId || snapshot.id !== questionnaireId)) {
    instrument.frozen = false;
    instrument.source.status = 'IDENTITY_INCONSISTENT';
    instrument.source.definitionSource = 'RECORDED_SNAPSHOT_ONLY';
  }
  return { instrument, definitions: new Map(REPORT_CATALOG.map((report) => [report.id, definitionFor(report, instrument)])) };
}

function safeMeasure(report, definition, exactMeasures) {
  // Historical candidate-specific aliases cannot be rebound to another person.
  // Generic candidate keys may be measured against their explicitly frozen
  // target, using exact-key aggregation rather than the legacy alias pool.
  const knownCandidate = definition.target?.type === 'CANDIDATE'
    && /^kasani[ _-]veeresh$/i.test(definition.target.name || '')
    && /^(kasani[_.:-]veeresh|veeresh)$/i.test(definition.target.id || '');
  if (report.targetType === 'CANDIDATE' && definition.keys.some((key) => key.startsWith('veeresh_')) && !knownCandidate) return { status: 'MAPPING_PENDING' };
  if (!report.measureKeys.length) return { status: 'MAPPING_PENDING' };
  const exact = object(object(exactMeasures)[report.id]);
  if (exact.source !== 'FROZEN_CONTRACT_EXACT_KEYS' || JSON.stringify([...outputKeys(exact.outputVariables)].sort()) !== JSON.stringify([...definition.keys].sort())) return { status: 'MAPPING_PENDING' };
  return exact.measure ? { status: 'AVAILABLE', measure: object(exact.measure) } : { status: 'MAPPING_PENDING' };
}

function capturedReport(report, definition, analysis, exactMeasures) {
  const base = count(analysis.segment?.respondentBase);
  const initial = { id: report.id, title: report.title, definitionStatus: definition.status,
    captureStatus: 'NOT_MEASURED', target: definition.target, outputVariables: definition.keys,
    questionCodes: definition.questionCodes, respondentBase: base, answerBase: null, codedBase: null,
    suppressed: true, distribution: [], caution: report.caution, message: '' };
  if (definition.status === 'UNCONFIGURED') return { ...initial, message: 'No report definition was recorded in this Iteration’s frozen instrument.' };
  if (definition.status !== 'CONTRACT_RECORDED') return { ...initial, captureStatus: 'MAPPING_PENDING', message: 'A consistent frozen instrument and explicit report contract are required. Legacy, invalid or conflicting definitions do not certify captured measurement.' };
  const selected = safeMeasure(report, definition, exactMeasures);
  if (selected.status === 'MAPPING_PENDING') return { ...initial, captureStatus: 'MAPPING_PENDING', message: 'Definition recorded; an audited aggregate calculation for this output and target is not implemented yet.' };
  if (analysis.segment?.suppressed || base === null || base < MINIMUM_RESEARCH_REPORT_BASE) return { ...initial, respondentBase: null, captureStatus: 'INSUFFICIENT_BASE', message: 'The selected cohort is below the disclosure minimum; counts and findings are withheld.' };
  const measure = selected.measure;
  if (measure.suppressed) return { ...initial, respondentBase: null, answerBase: null, codedBase: null,
    captureStatus: 'SMALL_CELLS_WITHHELD', message: 'The complete construct partition and linked denominators are withheld under the shared disclosure policy.' };
  const answerBase = count(measure.answerBase);
  const codedBase = count(measure.codedCount);
  if (answerBase === null || answerBase > base || codedBase === null || codedBase > answerBase || count(measure.respondentBase) !== base) return { ...initial, captureStatus: 'MAPPING_PENDING', message: 'Aggregate denominators are unavailable or inconsistent; refresh the report and review the reporting calculation.' };
  if (answerBase === 0) return { ...initial, answerBase: 0, codedBase: 0, captureStatus: 'NO_RECORDED_ANSWERS', message: 'The output was defined, but no non-missing answer was recorded for this reporting cohort.' };
  if (measure.suppressed || answerBase < MINIMUM_RESEARCH_REPORT_BASE || codedBase < MINIMUM_RESEARCH_REPORT_BASE) return { ...initial, answerBase: answerBase >= MINIMUM_RESEARCH_REPORT_BASE ? answerBase : null,
    codedBase: codedBase >= MINIMUM_RESEARCH_REPORT_BASE ? codedBase : null, captureStatus: 'INSUFFICIENT_BASE', message: 'Too few answered or coded observations support this construct; findings are withheld.' };
  const rows = Array.isArray(measure.values) ? measure.values : [];
  const allowed = [...ALLOWED_LABELS[report.domain], ...EXPLICIT_STATES];
  if (definition.valueType === 'CATEGORICAL' && rows.some((row) =>
    !EXPLICIT_STATES.includes(row.value) && !String(row.value).startsWith('Multiple ')
    && !definition.allowedValues.includes(row.value))) return { ...initial, answerBase, codedBase,
    captureStatus: 'MAPPING_PENDING', message: 'A recorded substantive category is outside the frozen contract’s allowed values; review the collection and reporting mapping.' };
  if (!rows.length || rows.some((row) => !allowed.includes(row.value) || count(row.respondents) === null || count(row.respondents) > answerBase)
    || new Set(rows.map((row) => row.value)).size !== rows.length
    || rows.reduce((total, row) => total + count(row.respondents), 0) !== answerBase
    || rows.filter((row) => !EXPLICIT_STATES.includes(row.value) && !row.value.startsWith('Multiple ')).reduce((total, row) => total + count(row.respondents), 0) !== codedBase) return { ...initial, answerBase, codedBase, captureStatus: 'MAPPING_PENDING', message: 'Recorded category labels or denominator totals do not match the audited reporting taxonomy.' };
  // Suppress the complete distribution if even one reported category is small.
  // This also avoids reconstructing withheld cells from totals or complements.
  if (rows.some((row) => count(row.respondents) < MINIMUM_RESEARCH_REPORT_BASE)) return { ...initial, respondentBase: null, answerBase: null, codedBase: null, captureStatus: 'SMALL_CELLS_WITHHELD', message: 'One or more category cells are below the disclosure minimum; the complete distribution and linked totals are withheld.' };
  return { ...initial, answerBase, codedBase, captureStatus: 'DESCRIPTIVE_AVAILABLE', suppressed: false,
    distribution: rows.map((row) => ({ value: row.value, respondents: count(row.respondents), percentage: Number((100 * count(row.respondents) / answerBase).toFixed(1)) })),
    message: 'Unweighted descriptive distribution of recorded answers. Human-review sign-off remains pending.' };
}

export function buildResearchReport({ analysis, snapshot = null, questionnaireId = null, agentSnapshot = null, exactMeasures = null, design = null, fieldworkDiagnostics = null, latestEvidenceAt = null, generatedAt = new Date().toISOString() }) {
  if (!analysis?.campaign?.id) throw new Error('An authorized Campaign analysis is required');
  const { instrument, definitions } = resolveFrozenReportDefinitions(snapshot, questionnaireId);
  const selectedIteration = analysis.scope?.iteration || null;
  const declarations = object(design);
  const run = analysis.scope?.run;
  const segmentFilters = object(analysis.scope?.insightScope?.filters);
  const filters = { gender: enumValue(segmentFilters.gender, ['Female', 'Male', 'Other / self-described', 'Unknown']),
    ageBand: enumValue(segmentFilters.ageBand, ['18–29', '30–39', '40–49', '50+']), mandal: text(segmentFilters.mandal) };
  const diagnosticScope = selectedIteration ? { campaignId: identifier(analysis.campaign.id),
    iterationId: identifier(selectedIteration.id), filters } : null;
  const declarationRecorded = declarations.design_declared === true && count(declarations.revision) > 0;
  const reports = REPORT_CATALOG.map((report) => capturedReport(report, definitions.get(report.id), analysis, exactMeasures));
  const contractCount = reports.filter((report) => report.definitionStatus === 'CONTRACT_RECORDED').length;
  const availableCount = reports.filter((report) => report.captureStatus === 'DESCRIPTIVE_AVAILABLE').length;
  const fieldworkComplete = selectedIteration?.completed === true;
  const diagnostics = selectedIteration
    ? sanitizeFieldworkDiagnostics(fieldworkDiagnostics || unavailableFieldworkDiagnostics('NOT_LOADED', diagnosticScope), diagnosticScope)
    : unavailableFieldworkDiagnostics('NO_SELECTED_ITERATION');
  // Reconcile visible diagnostic evidence against this authorized analysis,
  // rather than trusting a MATCHED flag copied from an earlier artifact. With
  // disclosure-withheld counts, retain an explicit mismatch but never certify
  // equality or manufacture a zero respondent base.
  const structuredCohortBase = count(diagnostics.coverage.stages.find((stage) => stage.key === 'STRUCTURED_RECORD')?.participants);
  const authorizedAnswerBase = count(analysis.segment?.respondentBase);
  if (diagnostics.coverage.status === 'AVAILABLE' && structuredCohortBase !== null && authorizedAnswerBase !== null) {
    diagnostics.sources.analysisBaseAlignment = structuredCohortBase === authorizedAnswerBase ? 'MATCHED' : 'MISMATCH';
  } else if (diagnostics.sources.analysisBaseAlignment !== 'MISMATCH') {
    diagnostics.sources.analysisBaseAlignment = 'NOT_ASSESSED';
  }
  const diagnosticBaseMismatch = diagnostics.sources.analysisBaseAlignment === 'MISMATCH';
  const outsideInitialCohort = diagnostics.sources.outsideInitialCohort === 'OBSERVED';
  const agent = object(agentSnapshot);
  const checks = [
    { id: 'insight-scope', status: selectedIteration ? 'RECORDED' : 'NOT_AVAILABLE', message: selectedIteration ? 'Research evidence uses the entire selected Iteration across Runs, with the selected cohort filters.' : 'No completed Iteration is selected. Select an Iteration to inspect its evidence.' },
    { id: 'frozen-instrument', status: instrument.source.status, message: instrument.frozen ? 'Frozen questionnaire content and fingerprint are consistent; this does not prove provider delivery.' : 'Full frozen questionnaire content is unavailable or its provenance is incomplete. No current catalogue is substituted.' },
    { id: 'report-definitions', status: contractCount ? 'PARTIAL_OR_RECORDED' : 'NOT_AVAILABLE', message: `${contractCount}/${reports.length} report contracts recorded in a consistent frozen instrument. This is definition coverage, not measured-answer coverage.` },
    { id: 'captured-answers', status: availableCount ? 'DESCRIPTIVE_AVAILABLE' : 'NOT_AVAILABLE', message: `${availableCount}/${reports.length} reports have disclosure-safe recorded distributions. Unconfigured, unsupported and insufficient reports remain separate.` },
    { id: 'methodology-declaration', status: declarationRecorded ? 'DECLARED' : 'NOT_DECLARED', message: declarationRecorded ? 'An audited methods declaration exists; declared sampling does not establish electorate representativeness.' : 'Declare actual population, frame, selection, cohort, fieldwork and weighting methods before making comparisons.' },
    { id: 'human-validation', status: 'PENDING', message: 'Independent multilingual real-call, question-delivery and extraction review has not received sign-off.' },
    { id: 'fieldwork', status: selectedIteration ? fieldworkComplete ? 'CLOSED' : 'IN_PROGRESS' : 'NOT_AVAILABLE', message: selectedIteration ? fieldworkComplete ? 'Selected Iteration operational fieldwork is closed; closure does not validate completed interviews or unanswered outputs.' : 'Selected Iteration fieldwork remains open; the report is a partial snapshot.' : 'No selected Iteration fieldwork is available.' },
    { id: 'fieldwork-cohort-coverage', status: diagnostics.coverage.status, message: diagnostics.coverage.status === 'AVAILABLE' ? 'Observed contact-cohort diagnostics use distinct retained Run 1 voter records, not call-attempt totals or verified unique people. Answer insights remain Iteration-wide across all Runs.' : 'Contact-cohort coverage is unavailable or disclosure-withheld; no completed-interview or electorate coverage claim is made.' },
    { id: 'fieldwork-analysis-alignment', status: diagnosticBaseMismatch || outsideInitialCohort ? 'REVIEW_REQUIRED' : diagnostics.sources.analysisBaseAlignment, message: diagnosticBaseMismatch || outsideInitialCohort ? 'Iteration-wide answer evidence and the initial contact cohort do not reconcile. Review source identity, cohort additions and evidence refresh before interpreting cohort yield.' : 'The initial contact cohort is distinct from the Iteration-wide answer base. Source alignment is a diagnostic check, not completed-interview validation.' },
    { id: 'sampling-frame', status: 'PENDING', message: 'Recorded contacts are not a verified electorate frame. Actual sampling execution, contact-time eligibility and population coverage remain unverified.' },
    { id: 'survey-completion-validation', status: 'PENDING', message: 'Provider connectivity and recorded output variables do not independently validate a completed survey. Standardized response rates remain unavailable.' }
  ];
  const report = {
    schemaVersion: 2, rulesVersion: RESEARCH_REPORT_RULES_VERSION, generatedAt: date(generatedAt),
    campaign: { id: identifier(analysis.campaign.id), code: identifier(analysis.campaign.code || analysis.campaign.campaign_code),
      name: text(analysis.campaign.name || analysis.campaign.campaign_name), status: enumValue(analysis.campaign.status, ENUMS.status) },
    scope: { requestedLevel: enumValue(analysis.scope?.level, ['RUN', 'ITERATION', 'CAMPAIGN']), insightLevel: 'ITERATION',
      iterationId: identifier(selectedIteration?.id), iterationNumber: count(selectedIteration?.number), iterationName: text(selectedIteration?.name),
      run: run ? { id: identifier(run.id), number: count(run.number), status: enumValue(run.status, ENUMS.status) } : null,
      filters,
      fieldworkStatus: selectedIteration ? fieldworkComplete ? 'CLOSED' : 'IN_PROGRESS' : 'NOT_AVAILABLE',
      description: run ? 'Run selection changes operations only; these findings remain Iteration-wide.' : 'Latest connected nonempty structured response per respondent in the selected Iteration; selected cohort filters apply.' },
    sources: { analysisGeneratedAt: date(analysis.generatedAt), latestEvidenceAt: date(latestEvidenceAt), questionnaire: instrument.source,
      voiceAgent: Object.keys(agent).length ? { id: identifier(agent.catalog_id || agent.id), code: identifier(agent.agent_code), appId: identifier(agent.app_id), version: count(agent.app_version), basis: 'ITERATION_ASSIGNMENT_SNAPSHOT' } : null,
      normalizationVersion: identifier(analysis.normalizationVersion),
      demographicProvenance: 'CURRENT_MASTER_DATA',
      normalizationRuleHash: typeof analysis.sentimentValidation?.ruleHash === 'string' && /^[a-f0-9]{64}$/.test(analysis.sentimentValidation.ruleHash) ? analysis.sentimentValidation.ruleHash : null,
      frozenInstrumentHash: instrument.frozen ? instrument.fingerprint : null },
    methodology: { declarationStatus: declarationRecorded ? 'DECLARED' : 'NOT_DECLARED', revision: declarationRecorded ? count(declarations.revision) : null,
      declaredAt: declarationRecorded ? date(declarations.declared_at) : null,
      fieldworkMode: enumValue(declarations.fieldwork_mode, ENUMS.mode), samplingMethod: enumValue(declarations.sampling_method, ENUMS.sampling), cohortDesign: enumValue(declarations.cohort_design, ENUMS.cohort),
      weighting: { status: 'UNAVAILABLE', declaredStatus: enumValue(declarations.weighting_status, ENUMS.weighting), message: 'This report uses unweighted observed answers. A declaration is not a weighting execution pipeline.' },
      representativeSampling: 'NOT_VERIFIED', standardizedResponseRate: 'UNAVAILABLE', humanValidation: 'PENDING',
      comparison: { status: enumValue(analysis.comparison?.status || declarations.comparison_status, ENUMS.comparison) || 'NOT_COMPARABLE',
        reasons: ['Cross-iteration movement uses the existing consecutive-wave gate. This pack does not calculate movement or establish statistical confidence.'] } },
    fieldworkDiagnostics: diagnostics,
    checks, reports,
    findings: reports.filter((item) => !item.suppressed).map((item) => ({ reportKey: item.id, type: 'DESCRIPTIVE_DISTRIBUTION', title: item.title, answerBase: item.answerBase, caution: item.caution })),
    limitations: [
      'Aggregate-only report; no respondent names, contact details, transcript excerpts or individual political scores are included.',
      'Definition coverage, recorded-answer availability and methodological validity are separate checks.',
      'Attempting every available contact is a contact-frame census, not proof of electorate coverage or representative completed responses.',
      'Connection rates are operational metrics, not standardized survey response rates.',
      'Contact-cohort diagnostics use distinct retained Run 1 voter records, not verified unique people; research answer aggregates remain Iteration-wide across all Runs.',
      'Demographic diagnostics use the current voter master, not frozen demographics or eligibility at the time of contact.',
      ...(diagnosticBaseMismatch || outsideInitialCohort ? ['The initial contact cohort and Iteration-wide answer evidence do not fully reconcile; cohort-yield interpretation requires source review.'] : []),
      'No statistical weighting, design effects, confidence intervals, constituency vote-share estimates or election forecasts are produced.',
      'Party attention, aided issue leadership, candidate impression, suitability and named-leader assessment remain distinct constructs.',
      'Human review and actual provider question-delivery verification remain pending; a frozen contract is not agent-delivery certification.',
      'The agent source is the Iteration assignment snapshot, not proof that every historical call used that version.',
      'Historical instruments and methods are never fabricated from the current questionnaire catalogue.',
      'Reports are assembled from live sequential reads, not an immutable or transactionally frozen database snapshot. The checksum identifies this generated artifact, not independent research certification.'
    ],
    nextActions: [
      ...(!instrument.frozen ? ['Preserve and verify frozen content for future Iterations; do not backfill unsupported historical identity.'] : []),
      ...(!declarationRecorded ? ['Declare the actual methods in the existing audited Research methodology registry.'] : []),
      ...(reports.some((item) => item.definitionStatus !== 'CONTRACT_RECORDED') ? ['Review report definitions on the questionnaire before selecting it for a future Iteration.'] : []),
      ...(reports.some((item) => item.captureStatus === 'MAPPING_PENDING') ? ['Implement and independently test unsupported output/target aggregate mappings before presenting findings.'] : []),
      ...(availableCount < reports.length ? ['Review missing answers, skip logic, actual agent question delivery and small reporting bases.'] : []),
      ...(diagnosticBaseMismatch || outsideInitialCohort ? ['Reconcile Run 1 cohort membership with all-Run structured answer evidence and refresh the report before interpreting contact-cohort yield.'] : []),
      'Complete independent multilingual real-call and extraction review before research sign-off.',
      'Establish electorate coverage, nonresponse diagnostics and an audited weighting design before electoral inference.'
    ]
  };
  report.checksum = hash(report);
  report.reportId = `research-report-${report.checksum.slice(0, 24)}`;
  return report;
}
