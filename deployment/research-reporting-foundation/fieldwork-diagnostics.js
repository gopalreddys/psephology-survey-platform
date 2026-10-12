export const FIELDWORK_RULES_VERSION = 'CONTACT_COHORT_V1';
const MINIMUM_CELL = 5;
const PARTITION_STATUSES = new Set(['AVAILABLE', 'WITHHELD', 'NOT_AVAILABLE']);
const TOP_STATUSES = new Set(['AVAILABLE', 'IN_PROGRESS', 'WITHHELD', 'NOT_AVAILABLE']);
const REASONS = new Set(['NOT_AVAILABLE', 'NO_SELECTED_ITERATION', 'SOURCE_SCHEMA_UNAVAILABLE',
  'NOT_LOADED', 'INITIAL_COHORT_UNAVAILABLE', 'SOURCE_INTEGRITY_UNVERIFIED', 'SCOPE_MISMATCH', 'NONE']);
export const FIELDWORK_STAGES = Object.freeze([
  { key: 'SELECTED', title: 'Retained initial-cohort voter records' },
  { key: 'ATTEMPTED', title: 'Records with matched call executions' },
  { key: 'CONNECTED', title: 'Records with a matched connected call' },
  { key: 'STRUCTURED_RECORD', title: 'Records with connected structured data' }
]);
export const FIELDWORK_OUTCOMES = Object.freeze([
  { key: 'STRUCTURED_RECORD', title: 'Connected structured record available' },
  { key: 'PENDING', title: 'Latest execution still open' },
  { key: 'CALLBACK_OR_RESULT_UNAVAILABLE', title: 'Callback or matched result unavailable' },
  { key: 'CONNECTED_NO_RECORD', title: 'Connected, without a structured record' },
  { key: 'BUSY', title: 'Latest matched result: busy' },
  { key: 'NO_ANSWER', title: 'Latest matched result: no answer' },
  { key: 'PROVIDER_FAILED', title: 'Latest matched result: provider failure' },
  { key: 'SUBMISSION_FAILED', title: 'Submission failed without a provider attempt' },
  { key: 'NOT_ATTEMPTED', title: 'No matched execution recorded' },
  { key: 'UNKNOWN', title: 'Observed state cannot be classified' }
]);
const DEMOGRAPHIC_CATEGORIES = Object.freeze({
  gender: ['Female', 'Male', 'Other / self-described', 'Unknown'],
  ageBand: ['18–29', '30–39', '40–49', '50+', 'Unknown']
});
const NOTES = Object.freeze({
  cohort: 'Counts identify retained database voter records, not verified unique people. Retries are not additional participants.',
  frame: 'The initial selected contact cohort is not the full eligible electoral frame; a historical eligible-frame snapshot was not recorded.',
  sampling: 'Probability sampling has not been verified. These diagnostics do not establish electorate representativeness or population bias.',
  availability: 'A connected nonempty structured object means record availability only; it does not prove meaningful answers or a completed questionnaire.',
  outcomes: 'Outcomes use any matched structured record first, otherwise the latest matched execution. They are operational observations, not standardized survey dispositions.',
  rates: 'Structured-record yield is not an AAPOR response rate or interview-completion rate. No weights, confidence intervals or forecasts are produced.',
  demographics: 'Age, gender and Mandal use current voter-master data, not frozen selection-time demographics. Composition differences describe the selected cohort only.',
  live: 'This is a live aggregate read; together with other report reads it is not an immutable or transaction-frozen database snapshot.',
  partial: 'Fieldwork is still open; record availability and observed outcomes can change.',
  withheld: 'Small nonzero cells cause whole-partition suppression, including complementary counts and percentages.',
  mismatch: 'The analysis respondent base and matched initial-cohort structured-record base differ; do not combine their denominators.',
  outside: 'Retained contact records outside the initial cohort were observed. They are excluded from these cohort diagnostics.',
  unavailable: 'An unambiguous retained initial Run and its selected contact cohort are required; absent records are not treated as zero.'
});
const ACTIONS = Object.freeze({
  frame: 'For future fieldwork, freeze and audit the eligible frame and selected cohort before launch.',
  review: 'Review questionnaire-specific answer completeness separately from call success and structured-record availability.',
  mismatch: 'Review unmatched or outside-initial-cohort records before comparing analysis and contact-cohort totals.',
  callback: 'Check callback/result reconciliation before classifying unavailable outcomes as voter nonresponse.',
  unavailable: 'Recover or verify the retained initial cohort; do not reconstruct historical selection from current eligible voters.'
});
const SOURCE_CHOICES = Object.freeze({
  cohort: ['RETAINED_RUN_1_DATABASE_IDS', 'NOT_AVAILABLE'], demographics: ['CURRENT_MASTER_DATA'],
  eligibleFrame: ['NOT_RECORDED'], probabilitySampling: ['NOT_VERIFIED'],
  standardizedResponseRate: ['UNAVAILABLE'], surveyCompletion: ['UNAVAILABLE'],
  analysisBaseAlignment: ['MATCHED', 'MISMATCH', 'NOT_ASSESSED'],
  outsideInitialCohort: ['NONE_OBSERVED', 'OBSERVED', 'NOT_ASSESSED']
});

const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const numericCount = (value) => value !== null && value !== undefined && value !== '' ? count(Number(value)) : null;
const pct = (part, base) => base > 0 ? Math.round((part / base) * 1000) / 10 : null;
const date = (value) => {
  if (!value || !['string', 'object'].includes(typeof value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const hasSmallCell = (values) => values.some((value) => value > 0 && value < MINIMUM_CELL);
const validMandal = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160
  && !/[\u0000-\u001f\u007f@<>]/.test(value) && value.replace(/\D/g, '').length < 8 && !/:\/\//.test(value)
  && !/\b[A-Z]{3}\d{7}\b/i.test(value)
  && !/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(value);
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function safeScope(scope) {
  if (!scope || !uuid(scope.campaignId) || !uuid(scope.iterationId) || !scope.filters
    || typeof scope.filters !== 'object' || Array.isArray(scope.filters)) return null;
  const gender = scope.filters.gender ?? null, ageBand = scope.filters.ageBand ?? null, mandal = scope.filters.mandal ?? null;
  if ((gender !== null && !DEMOGRAPHIC_CATEGORIES.gender.includes(gender))
    || (ageBand !== null && !DEMOGRAPHIC_CATEGORIES.ageBand.includes(ageBand))
    || (mandal !== null && !validMandal(mandal))) return null;
  return { campaignId: scope.campaignId.toLowerCase(), iterationId: scope.iterationId.toLowerCase(),
    filters: { gender, ageBand, mandal } };
}

function sameScope(left, right) {
  return JSON.stringify(safeScope(left)) === JSON.stringify(safeScope(right));
}

function smallStages(values) {
  return hasSmallCell(values) || hasSmallCell(values.flatMap((value, index) =>
    values.slice(index + 1).map((later) => value - later)));
}

function emptyDemographic() {
  return { status: 'NOT_AVAILABLE', selectedBase: null, structuredBase: null, rows: [] };
}

export function unavailableFieldworkDiagnostics(reason = 'NOT_AVAILABLE', scope = null) {
  return {
    schemaVersion: 1, rulesVersion: FIELDWORK_RULES_VERSION, status: 'NOT_AVAILABLE',
    reason: REASONS.has(reason) && reason !== 'NONE' ? reason : 'NOT_AVAILABLE', scope: safeScope(scope), observedAt: null,
    sources: { cohort: 'NOT_AVAILABLE', demographics: 'CURRENT_MASTER_DATA', eligibleFrame: 'NOT_RECORDED',
      probabilitySampling: 'NOT_VERIFIED', standardizedResponseRate: 'UNAVAILABLE', surveyCompletion: 'UNAVAILABLE',
      analysisBaseAlignment: 'NOT_ASSESSED', outsideInitialCohort: 'NOT_ASSESSED' },
    coverage: { status: 'NOT_AVAILABLE', selectedBase: null, stages: FIELDWORK_STAGES.map((item) => ({ ...item,
      participants: null, percentage: null })), yield: null },
    outcomes: { status: 'NOT_AVAILABLE', base: null, rows: FIELDWORK_OUTCOMES.map((item) => ({ ...item,
      participants: null, percentage: null })) },
    demographics: { gender: emptyDemographic(), ageBand: emptyDemographic(), mandal: emptyDemographic() },
    limitations: [NOTES.cohort, NOTES.frame, NOTES.sampling, NOTES.availability, NOTES.rates,
      NOTES.demographics, NOTES.live, NOTES.unavailable],
    nextActions: [ACTIONS.unavailable, ACTIONS.frame, ACTIONS.review]
  };
}

function demographicPartition(raw, kind, selectedBase, structuredBase, globallyWithheld) {
  if (!Array.isArray(raw)) return emptyDemographic();
  const rows = raw.map((row) => ({ category: row?.category, selected: numericCount(row?.selected),
    structured: numericCount(row?.structured) }));
  if (rows.some((row) => row.selected === null || row.structured === null || row.structured > row.selected
    || (kind === 'mandal' ? !validMandal(row.category) : !DEMOGRAPHIC_CATEGORIES[kind].includes(row.category)))
    || new Set(rows.map((row) => row.category)).size !== rows.length
    || rows.reduce((sum, row) => sum + row.selected, 0) !== selectedBase
    || rows.reduce((sum, row) => sum + row.structured, 0) !== structuredBase) return emptyDemographic();
  if (kind !== 'mandal') {
    for (const category of DEMOGRAPHIC_CATEGORIES[kind]) {
      if (!rows.some((row) => row.category === category)) rows.push({ category, selected: 0, structured: 0 });
    }
    rows.sort((left, right) => DEMOGRAPHIC_CATEGORIES[kind].indexOf(left.category) - DEMOGRAPHIC_CATEGORIES[kind].indexOf(right.category));
  } else rows.sort((left, right) => left.category.localeCompare(right.category));
  const withheld = globallyWithheld || hasSmallCell(rows.flatMap((row) => [row.selected, row.structured, row.selected - row.structured]));
  return { status: withheld ? 'WITHHELD' : 'AVAILABLE', selectedBase: withheld ? null : selectedBase,
    structuredBase: withheld ? null : structuredBase,
    rows: withheld ? [] : rows.map((row) => {
      const selectedPct = pct(row.selected, selectedBase), structuredPct = pct(row.structured, structuredBase);
      return { category: row.category, selected: withheld ? null : row.selected, structured: withheld ? null : row.structured,
        selectedPct: withheld ? null : selectedPct, structuredPct: withheld ? null : structuredPct,
        differencePp: withheld || selectedPct === null || structuredPct === null ? null
          : Math.round((structuredPct - selectedPct) * 10) / 10 };
    }) };
}

// Accepts aggregate SQL results only. No respondent-level input is serialized.
export function buildFieldworkDiagnostics({ aggregate, iterationCompleted = false, analysisRespondentBase = null, scope = null } = {}) {
  const selectedScope = safeScope(scope);
  if (!selectedScope) return unavailableFieldworkDiagnostics('SCOPE_MISMATCH');
  if (!aggregate || numericCount(aggregate.initial_run_count) !== 1
    || numericCount(aggregate.initial_contact_count) < 1 || numericCount(aggregate.initial_null_voter_count) !== 0
    || aggregate.scope_available !== true) return unavailableFieldworkDiagnostics('INITIAL_COHORT_UNAVAILABLE', selectedScope);
  if (numericCount(aggregate.source_identity_conflicts) !== 0 || numericCount(aggregate.source_status_conflicts) !== 0) {
    return unavailableFieldworkDiagnostics('SOURCE_INTEGRITY_UNVERIFIED', selectedScope);
  }
  const selectedBase = numericCount(aggregate.selected_base), attemptedBase = numericCount(aggregate.attempted_base),
    connectedBase = numericCount(aggregate.connected_base), structuredBase = numericCount(aggregate.structured_base);
  if ([selectedBase, attemptedBase, connectedBase, structuredBase].includes(null)
    || attemptedBase > selectedBase || connectedBase > attemptedBase || structuredBase > connectedBase
    || !Array.isArray(aggregate.outcomes)) return unavailableFieldworkDiagnostics('NOT_AVAILABLE', selectedScope);
  const counts = new Map();
  for (const row of aggregate.outcomes) {
    if (!FIELDWORK_OUTCOMES.some((item) => item.key === row?.key) || counts.has(row.key)
      || numericCount(row.participants) === null) return unavailableFieldworkDiagnostics('NOT_AVAILABLE', selectedScope);
    counts.set(row.key, numericCount(row.participants));
  }
  if ([...counts.values()].reduce((sum, value) => sum + value, 0) !== selectedBase
    || (counts.get('STRUCTURED_RECORD') || 0) !== structuredBase
    || attemptedBase + (counts.get('NOT_ATTEMPTED') || 0) > selectedBase
    || structuredBase + (counts.get('CONNECTED_NO_RECORD') || 0) > connectedBase
    || FIELDWORK_OUTCOMES.filter((item) => !['NOT_ATTEMPTED', 'UNKNOWN'].includes(item.key))
      .reduce((sum, item) => sum + (counts.get(item.key) || 0), 0) > attemptedBase) {
    return unavailableFieldworkDiagnostics('NOT_AVAILABLE', selectedScope);
  }
  const values = [selectedBase, attemptedBase, connectedBase, structuredBase];
  const withheld = hasSmallCell([...counts.values()]) || smallStages(values);
  const status = withheld ? 'WITHHELD' : iterationCompleted ? 'AVAILABLE' : 'IN_PROGRESS';
  const analysisBase = count(analysisRespondentBase);
  const alignment = analysisBase === null ? 'NOT_ASSESSED' : analysisBase === structuredBase ? 'MATCHED' : 'MISMATCH';
  const outside = numericCount(aggregate.outside_initial_base);
  const outsideStatus = outside === null ? 'NOT_ASSESSED' : outside > 0 ? 'OBSERVED' : 'NONE_OBSERVED';
  const demographics = Object.fromEntries(['gender', 'ageBand', 'mandal'].map((key) => [key,
    demographicPartition(aggregate.demographics?.[key], key, selectedBase, structuredBase, withheld)]));
  return {
    schemaVersion: 1, rulesVersion: FIELDWORK_RULES_VERSION, status, reason: 'NONE', scope: selectedScope, observedAt: date(aggregate.observed_at),
    sources: { cohort: 'RETAINED_RUN_1_DATABASE_IDS', demographics: 'CURRENT_MASTER_DATA', eligibleFrame: 'NOT_RECORDED',
      probabilitySampling: 'NOT_VERIFIED', standardizedResponseRate: 'UNAVAILABLE', surveyCompletion: 'UNAVAILABLE',
      analysisBaseAlignment: alignment, outsideInitialCohort: outsideStatus },
    coverage: { status: withheld ? 'WITHHELD' : 'AVAILABLE', selectedBase: withheld ? null : selectedBase,
      stages: FIELDWORK_STAGES.map((item, index) => ({ ...item, participants: withheld ? null : values[index],
        percentage: withheld ? null : pct(values[index], selectedBase) })),
      yield: withheld || selectedBase === 0 ? null : { numerator: structuredBase, denominator: selectedBase,
        percentage: pct(structuredBase, selectedBase), label: 'Connected structured-record yield (not a survey response rate)' } },
    outcomes: { status: withheld ? 'WITHHELD' : 'AVAILABLE', base: withheld ? null : selectedBase,
      rows: FIELDWORK_OUTCOMES.map((item) => ({ ...item, participants: withheld ? null : counts.get(item.key) || 0,
        percentage: withheld ? null : pct(counts.get(item.key) || 0, selectedBase) })) },
    demographics,
    limitations: [NOTES.cohort, NOTES.frame, NOTES.sampling, NOTES.availability, NOTES.outcomes, NOTES.rates,
      NOTES.demographics, NOTES.live, ...(!iterationCompleted ? [NOTES.partial] : []),
      ...(withheld || Object.values(demographics).some((item) => item.status === 'WITHHELD') ? [NOTES.withheld] : []),
      ...(alignment === 'MISMATCH' ? [NOTES.mismatch] : []), ...(outsideStatus === 'OBSERVED' ? [NOTES.outside] : [])],
    nextActions: [ACTIONS.frame, ACTIONS.review,
      ...(alignment === 'MISMATCH' || outsideStatus === 'OBSERVED' ? [ACTIONS.mismatch] : []),
      ...((counts.get('CALLBACK_OR_RESULT_UNAVAILABLE') || 0) > 0 ? [ACTIONS.callback] : [])]
  };
}

// Used at report/export boundaries. Arbitrary supplied fields, messages,
// actor/voter identifiers and response data cannot enter the versioned payload.
export function sanitizeFieldworkDiagnostics(input, expectedScope = null) {
  const selectedScope = safeScope(expectedScope);
  if (expectedScope !== null && !selectedScope) return unavailableFieldworkDiagnostics('SCOPE_MISMATCH');
  if (!input || input.schemaVersion !== 1 || input.rulesVersion !== FIELDWORK_RULES_VERSION
    || !TOP_STATUSES.has(input.status) || !REASONS.has(input.reason)) return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
  if (!sameScope(input.scope, expectedScope) || (input.status !== 'NOT_AVAILABLE' && !selectedScope)) {
    return unavailableFieldworkDiagnostics('SCOPE_MISMATCH', selectedScope);
  }
  if (input.status === 'NOT_AVAILABLE') return unavailableFieldworkDiagnostics(input.reason, selectedScope);
  if (input.reason !== 'NONE' || Object.entries(SOURCE_CHOICES).some(([key, allowed]) => !allowed.includes(input.sources?.[key]))
    || input.sources.cohort !== 'RETAINED_RUN_1_DATABASE_IDS'
    || !PARTITION_STATUSES.has(input.outcomes?.status) || !PARTITION_STATUSES.has(input.coverage?.status)) {
    return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
  }
  if (input.outcomes.status === 'WITHHELD') {
    const result = unavailableFieldworkDiagnostics('NOT_AVAILABLE', selectedScope);
    result.status = 'WITHHELD'; result.reason = 'NONE'; result.observedAt = date(input.observedAt);
    result.sources = Object.fromEntries(Object.keys(SOURCE_CHOICES).map((key) => [key, input.sources[key]]));
    result.coverage.status = 'WITHHELD'; result.outcomes.status = 'WITHHELD';
    for (const kind of ['gender', 'ageBand', 'mandal']) result.demographics[kind] = {
      status: 'WITHHELD', selectedBase: null, structuredBase: null, rows: [] };
    result.limitations = [NOTES.cohort, NOTES.frame, NOTES.sampling, NOTES.availability, NOTES.outcomes, NOTES.rates,
      NOTES.demographics, NOTES.live, NOTES.withheld,
      ...(input.sources.analysisBaseAlignment === 'MISMATCH' ? [NOTES.mismatch] : []),
      ...(input.sources.outsideInitialCohort === 'OBSERVED' ? [NOTES.outside] : [])];
    result.nextActions = [ACTIONS.frame, ACTIONS.review,
      ...(input.sources.analysisBaseAlignment === 'MISMATCH' || input.sources.outsideInitialCohort === 'OBSERVED' ? [ACTIONS.mismatch] : [])];
    return result;
  }
  if (input.status === 'WITHHELD') return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
  if (input.outcomes.status !== 'AVAILABLE' || input.coverage.status !== 'AVAILABLE'
    || !Array.isArray(input.coverage.stages) || input.coverage.stages.length !== FIELDWORK_STAGES.length
    || !Array.isArray(input.outcomes.rows) || input.outcomes.rows.length !== FIELDWORK_OUTCOMES.length
    || new Set(input.coverage.stages.map((row) => row?.key)).size !== FIELDWORK_STAGES.length
    || new Set(input.outcomes.rows.map((row) => row?.key)).size !== FIELDWORK_OUTCOMES.length) {
    return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
  }
  const stages = FIELDWORK_STAGES.map((stage) => count(input.coverage.stages.find((row) => row?.key === stage.key)?.participants));
  if (stages.some((value) => value === null) || count(input.coverage.selectedBase) !== stages[0]
    || count(input.outcomes.base) !== stages[0]) return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
  const demographics = {};
  for (const kind of ['gender', 'ageBand', 'mandal']) {
    const raw = input.demographics?.[kind];
    if (!PARTITION_STATUSES.has(raw?.status)) return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
    if (raw.status === 'AVAILABLE' && (count(raw.selectedBase) !== stages[0] || count(raw.structuredBase) !== stages[3])) {
      return unavailableFieldworkDiagnostics('NOT_LOADED', selectedScope);
    }
    demographics[kind] = raw.status === 'AVAILABLE' && Array.isArray(raw.rows) ? raw.rows.map((row) => ({
      category: row?.category, selected: count(row?.selected), structured: count(row?.structured) })) : null;
  }
  const result = buildFieldworkDiagnostics({ scope: selectedScope, iterationCompleted: input.status === 'AVAILABLE',
    analysisRespondentBase: null, aggregate: { scope_available: true, initial_run_count: 1, initial_contact_count: 1,
      initial_null_voter_count: 0, source_identity_conflicts: 0, source_status_conflicts: 0,
      selected_base: stages[0], attempted_base: stages[1], connected_base: stages[2], structured_base: stages[3],
      outside_initial_base: input.sources.outsideInitialCohort === 'OBSERVED' ? 1
        : input.sources.outsideInitialCohort === 'NONE_OBSERVED' ? 0 : null,
      observed_at: input.observedAt, outcomes: input.outcomes.rows.map((row) => ({ key: row.key, participants: count(row.participants) })),
      demographics } });
  if (result.status === 'NOT_AVAILABLE') return result;
  result.sources.analysisBaseAlignment = input.sources.analysisBaseAlignment;
  if (input.sources.analysisBaseAlignment === 'MISMATCH') {
    result.limitations.push(NOTES.mismatch);
    if (!result.nextActions.includes(ACTIONS.mismatch)) result.nextActions.push(ACTIONS.mismatch);
  }
  for (const kind of ['gender', 'ageBand', 'mandal']) {
    if (input.demographics[kind].status === 'WITHHELD') result.demographics[kind] = {
      status: 'WITHHELD', selectedBase: null, structuredBase: null, rows: [] };
    if (result.status === 'WITHHELD' && result.demographics[kind].status !== 'NOT_AVAILABLE') result.demographics[kind] = {
      status: 'WITHHELD', selectedBase: null, structuredBase: null, rows: [] };
  }
  if (Object.values(result.demographics).some((item) => item.status === 'WITHHELD') && !result.limitations.includes(NOTES.withheld)) {
    result.limitations.push(NOTES.withheld);
  }
  return result;
}
