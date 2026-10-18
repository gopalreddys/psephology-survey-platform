import { createHash } from 'node:crypto';

export const RULES_VERSION = 'INTERVIEW_COMPLETENESS_V1';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
export const STATES = Object.freeze(['COMPLETE_RECORDED', 'PARTIAL_RECORDED', 'NO_SUBSTANTIVE_RECORD',
  'TECHNICALLY_UNRESOLVED', 'NOT_CONNECTED', 'IN_PROGRESS', 'NOT_ATTEMPTED']);
export const SUMMARY_REASONS = Object.freeze(['RECORDED_COVERAGE_AVAILABLE', 'SMALL_CELL_PARTITION_WITHHELD',
  'NO_SELECTED_ITERATION', 'RETAINED_BASE_COHORT_UNAVAILABLE', 'AMBIGUOUS_SOURCE_SCOPE', 'SOURCE_SCHEMA_UNAVAILABLE']);
export class InterviewCompletionError extends Error {
  constructor(message, code = 'INVALID_INTERVIEW_COMPLETION_INPUT', statusCode = 400) {
    super(message); this.code = code; this.statusCode = statusCode;
  }
}
export const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const date = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
export function authorize(actor, roles = ['SUPER_ADMIN', 'ADMIN']) {
  if (typeof actor?.id !== 'string' || !UUID.test(actor.id) || !roles.includes(actor?.role_code)) {
    throw new InterviewCompletionError('This role cannot access interview completion', 'INTERVIEW_COMPLETION_FORBIDDEN', 403);
  }
}
export function validId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new InterviewCompletionError('A valid resource ID is required');
  return value.toLowerCase();
}

const keyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const codePattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const emptyCoverage = () => ({ requiredQuestions: null, accountedQuestions: null, substantiveQuestions: null,
  missingQuestions: null, cantSayQuestions: null, refusedQuestions: null });
const emptyCounts = () => ({ selectedBase: null, completeRecorded: null, partialRecorded: null, noSubstantiveRecord: null,
  technicallyUnresolved: null, notConnected: null, inProgress: null, notAttempted: null });
const limitations = Object.freeze([
  'Automated coverage of recorded required outputs only; it does not prove question delivery, informed consent, extraction accuracy, or human quality approval.',
  'Complete recorded interviews are not a representative sample, response rate, statistical validity, political prediction, or sentiment-model certification.',
  'V1 does not infer conditional question paths or replace missing frozen completion declarations with the current questionnaire catalogue.'
]);

function mappedKeys(question) {
  const metadata = object(question.metadata) || {}, declarations = [question.output_variables, question.outputVariables,
    metadata.output_variables, metadata.outputVariables].filter((value) => value !== undefined);
  if (!declarations.length) return [];
  const lists = declarations.map((value) => {
    if (!Array.isArray(value) || value.length > 50) throw new Error('OUTPUT_MAPPING_INVALID');
    const result = value.map((item) => {
      if (typeof item === 'string') return item;
      const entry = object(item);
      if (!entry || Object.keys(entry).some((key) => !['key', 'name', 'type', 'description'].includes(key))
        || (entry.key && entry.name && entry.key !== entry.name)) throw new Error('OUTPUT_MAPPING_INVALID');
      if (entry.type !== undefined && (!['TEXT', 'NUMERIC', 'CATEGORICAL'].includes(entry.type)
        || object(metadata.reporting_contract)?.valueType !== entry.type)) throw new Error('OUTPUT_TYPE_DECLARATION_UNSUPPORTED');
      return entry.key || entry.name;
    });
    if (result.some((key) => typeof key !== 'string' || key.length > 80 || !keyPattern.test(key))
      || new Set(result).size !== result.length) throw new Error('OUTPUT_MAPPING_INVALID');
    return result.sort();
  });
  if (lists.some((list) => JSON.stringify(list) !== JSON.stringify(lists[0]))) throw new Error('OUTPUT_MAPPING_CONFLICT');
  return lists[0];
}

function valueContract(question, keys) {
  const contract = object(object(question.metadata)?.reporting_contract);
  if (!contract) {
    const choiceType = ['SINGLE_CHOICE', 'SINGLE_SELECT', 'SINGLE_SELECT_OPTION'].includes(question.question_type);
    if (!choiceType) {
      if (!['OPEN_TEXT', 'TEXT', 'FREE_TEXT'].includes(question.question_type)) throw new Error('QUESTION_VALUE_SEMANTICS_UNSUPPORTED');
      return null;
    }
    if (keys.length !== 1) throw new Error('MULTI_OUTPUT_CHOICE_CONTRACT_UNRESOLVED');
    if (!Array.isArray(question.options) || question.options.length < 2) throw new Error('VALUE_CONTRACT_INVALID');
    const allowed = question.options.map((option) => typeof option === 'string' ? option : object(option)?.value);
    if (allowed.some((value) => typeof value !== 'string' || !value.trim() || value.length > 120)
      || new Set(allowed).size !== allowed.length) throw new Error('VALUE_CONTRACT_INVALID');
    return { type: 'CATEGORICAL', allowed };
  }
  if (!Array.isArray(contract.outputVariables) || contract.outputVariables.length !== keys.length
    || new Set(contract.outputVariables).size !== contract.outputVariables.length
    || [...contract.outputVariables].sort().some((key, index) => key !== keys[index])
    || !['TEXT', 'NUMERIC', 'CATEGORICAL'].includes(contract.valueType)
    || !Array.isArray(contract.allowedValues)) throw new Error('VALUE_CONTRACT_INVALID');
  if (contract.valueType === 'CATEGORICAL') {
    if (contract.allowedValues.length < 2 || contract.allowedValues.some((value) => typeof value !== 'string' || !value.trim()
      || value.length > 120) || new Set(contract.allowedValues.map((value) => value.trim().toLowerCase())).size !== contract.allowedValues.length) {
      throw new Error('VALUE_CONTRACT_INVALID');
    }
  } else if (contract.allowedValues.length) throw new Error('VALUE_CONTRACT_INVALID');
  return { type: contract.valueType, allowed: contract.allowedValues };
}

export function inspectInstrument(row) {
  const snapshot = object(row.questionnaire_snapshot), questions = snapshot?.questions;
  const identityValid = snapshot && UUID.test(snapshot.id || '') && snapshot.id === row.questionnaire_id
    && typeof snapshot.code === 'string' && codePattern.test(snapshot.code) && Number.isSafeInteger(snapshot.version) && snapshot.version > 0
    && snapshot.snapshot_schema_version === 2 && snapshot.question_provenance === 'FROZEN_AT_SELECTION'
    && Array.isArray(questions) && questions.length > 0 && questions.length <= 500
    && HASH.test(snapshot.content_fingerprint || '') && snapshot.content_fingerprint === fingerprint(questions);
  if (!identityValid) return { hash: null, questions: [], reason: 'VERIFIED_FROZEN_INSTRUMENT_REQUIRED' };
  const mapped = new Set(), codes = new Set(), orders = new Set(), compiled = [];
  try {
    for (const question of questions) {
      if (!object(question) || typeof question.question_code !== 'string' || !codePattern.test(question.question_code) || typeof question.question_text !== 'string'
        || !question.question_text.trim() || question.question_text.length > 10000
        || !Number.isSafeInteger(question.question_order) || question.question_order < 1
        || codes.has(question.question_code.toUpperCase()) || orders.has(question.question_order)) throw new Error('FROZEN_QUESTION_INVALID');
      codes.add(question.question_code.toUpperCase()); orders.add(question.question_order);
      const metadata = object(question.metadata);
      if (!metadata || typeof metadata.required_for_completion !== 'boolean') throw new Error('EXPLICIT_COMPLETION_DECLARATION_REQUIRED');
      // The general UI question-required flag is distinct from this explicit
      // completion declaration; it is never used as a completion substitute.
      if (metadata.required_for_completion && [question, metadata].some((source) => Object.keys(source).some((key) =>
        /^(?:ask(?:_|If)|skip|branch|condition)/i.test(key) && source[key] != null))) {
        throw new Error('CONDITIONAL_COMPLETION_UNSUPPORTED');
      }
      const keys = mappedKeys(question);
      if (metadata.required_for_completion && !keys.length) throw new Error('REQUIRED_OUTPUT_MAPPING_REQUIRED');
      for (const key of keys) { if (mapped.has(key)) throw new Error('OUTPUT_MAPPING_COLLISION'); mapped.add(key); }
      // Optional conditionals do not affect the completion contract. Their
      // values still cannot introduce structured/non-finite required evidence.
      const contract = metadata.required_for_completion ? valueContract(question, keys) : null;
      compiled.push({ code: question.question_code, required: metadata.required_for_completion, order: question.question_order,
        keys, contract });
    }
    if (!compiled.some((question) => question.required)) throw new Error('REQUIRED_UNCONDITIONAL_QUESTION_REQUIRED');
    return { hash: snapshot.content_fingerprint, questions: compiled.sort((a, b) => a.order - b.order), reason: null };
  } catch (error) { return { hash: snapshot.content_fingerprint, questions: [], reason: error.message }; }
}

function transcriptPresent(value) {
  if (!Array.isArray(value) || !value.length) return false;
  return value.some((turn) => {
    if (typeof turn === 'string') return Boolean(turn.trim());
    const item = object(turn); if (!item) return false;
    // Sarvam retains bilingual turn text as en_text/indic_text. A blank or
    // unsupported primary field must not mask a separate supported text field.
    const providerText = [item.en_text, item.indic_text].some((content) => typeof content === 'string' && Boolean(content.trim()));
    const contents = [item.content, item.text, item.message, item.transcript, item.utterance];
    return providerText || contents.some((content) => typeof content === 'string' ? Boolean(content.trim()) : Array.isArray(content)
      && content.some((block) => typeof block === 'string' ? Boolean(block.trim()) : typeof block?.text === 'string' && Boolean(block.text.trim())));
  });
}

const token = (value) => value.trim().replace(/[.!?।]+$/, '').toUpperCase().replace(/[‘’']/g, '').replace(/[\s-]+/g, '_');
const missingTokens = new Set(['NOT_ANSWERED', 'NOT_ASKED', 'NOT_CAPTURED', 'NOT_RECORDED', 'NOT_PROVIDED', 'UNRECORDED', 'NO_RESPONSE', 'NO_ANSWER', 'MISSING', 'UNAVAILABLE', 'N/A', 'NA', 'NULL', 'UNDEFINED']);
// Exact reserved states only. This is not language inference or sentiment NLP.
const cantSayTokens = new Set(['CANT_SAY', 'CANNOT_SAY', 'DONT_KNOW', 'DO_NOT_KNOW', 'NOT_SURE', 'UNSURE', 'UNKNOWN', 'UNCERTAIN', 'NO_IDEA', 'NO_OPINION', 'NOT_ENOUGH_INFORMATION',
  'తెలియదు', 'చెప్పలేను', 'నాకు_తెలియదు', 'తగినంత_సమాచారం_లేదు', 'पता_नहीं', 'मुझे_पता_नहीं', 'कह_नहीं_सकता', 'कह_नहीं_सकते', 'पर्याप्त_जानकारी_नहीं']);
const refusalTokens = new Set(['REFUSED', 'DECLINED', 'DECLINED_TO_ANSWER', 'PREFER_NOT_TO_ANSWER', 'PREFER_NOT_TO_SAY',
  'సమాధానం_ఇవ్వదలచుకోలేదు', 'జవాబు_ఇవ్వదలచుకోలేదు', 'చెప్పడానికి_ఇష్టం_లేదు', 'సమాధానం_ఇవ్వను',
  'जवाब_नहीं_देना_चाहते', 'जवाब_नहीं_देना_चाहता', 'जवाब_नहीं_देना_चाहती', 'उत्तर_नहीं_देना_चाहते']);
function outputState(value, contract) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return 'MISSING';
  if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('OUTPUT_SHAPE_UNSUPPORTED');
  if (typeof value === 'string') {
    const normalized = token(value);
    if (missingTokens.has(normalized)) return 'MISSING';
    if (cantSayTokens.has(normalized)) return 'CANT_SAY';
    if (refusalTokens.has(normalized)) return 'REFUSED';
  }
  if (contract?.type === 'CATEGORICAL' && (typeof value !== 'string' || !contract.allowed.includes(value))) throw new Error('OUTPUT_OUTSIDE_VALUE_CONTRACT');
  if (contract?.type === 'NUMERIC' && typeof value !== 'number') throw new Error('OUTPUT_OUTSIDE_VALUE_CONTRACT');
  if (contract?.type === 'TEXT' && typeof value !== 'string') throw new Error('OUTPUT_OUTSIDE_VALUE_CONTRACT');
  return 'SUBSTANTIVE';
}

function participationState(outputs) {
  const states = [];
  for (const key of ['survey_consent', 'consent', 'consent_status']) {
    if (!Object.hasOwn(outputs, key) || outputs[key] == null || outputs[key] === '') continue;
    const value = outputs[key];
    if (value === true || (typeof value === 'string' && ['YES', 'AGREED', 'CONSENTED', 'GRANTED', 'ACCEPTED'].includes(token(value)))) states.push('ALLOWED');
    else if (value === false || (typeof value === 'string' && ['NO', 'DENIED', 'DECLINED', 'REFUSED', 'NOT_CONSENTED', 'NO_CONSENT', 'NOT_GRANTED', 'DO_NOT_CALL'].includes(token(value)))) states.push('DENIED');
    else throw new Error('CONSENT_STATE_UNRESOLVED');
  }
  for (const key of ['wrong_number', 'wrong_person', 'do_not_call']) {
    if (!Object.hasOwn(outputs, key) || outputs[key] == null || outputs[key] === '') continue;
    if (outputs[key] === true || (typeof outputs[key] === 'string' && token(outputs[key]) === 'YES')) states.push('DENIED');
    else if (outputs[key] !== false && !(typeof outputs[key] === 'string' && token(outputs[key]) === 'NO')) throw new Error('DISPOSITION_STATE_UNRESOLVED');
  }
  for (const key of ['call_disposition', 'respondent_status', 'disposition']) {
    if (!Object.hasOwn(outputs, key) || outputs[key] == null || outputs[key] === '') continue;
    if (typeof outputs[key] !== 'string') throw new Error('DISPOSITION_STATE_UNRESOLVED');
    const state = token(outputs[key]);
    if (['WRONG_NUMBER', 'WRONG_PERSON', 'DO_NOT_CALL', 'DECLINED', 'REFUSED', 'NOT_INTERESTED', 'CONSENT_DENIED', 'NO_CONSENT', 'NOT_CONSENTED'].includes(state)) states.push('DENIED');
    else if (['PARTIAL', 'INCOMPLETE', 'PARTIAL_FEEDBACK_CAPTURED', 'SUBSTANTIAL_FEEDBACK_CAPTURED'].includes(state)) states.push('PARTIAL');
    else if (state === 'NO_MEANINGFUL_FEEDBACK') states.push('NO_FEEDBACK');
    else if (state === 'CALLBACK_REQUESTED') states.push('CALLBACK');
    else if (['COMPLETED', 'SURVEY_COMPLETED'].includes(state)) states.push('COMPLETE_DECLARED');
    else if (!['INTERESTED', 'PARTICIPATED', 'CONSENTED'].includes(state)) throw new Error('DISPOSITION_STATE_UNRESOLVED');
  }
  if (states.includes('ALLOWED') && states.includes('DENIED')) throw new Error('PARTICIPATION_STATE_CONFLICT');
  if (states.includes('DENIED')) return 'DENIED';
  // A provider disposition is not consent or proof of completed coverage.
  // "Substantial" has no frozen completion threshold and remains partial.
  // A callback can follow some feedback, but cannot certify a full interview.
  if ((states.includes('COMPLETE_DECLARED') && ['PARTIAL', 'CALLBACK', 'NO_FEEDBACK'].some((state) => states.includes(state)))
    || (states.includes('NO_FEEDBACK') && states.includes('PARTIAL'))) throw new Error('DISPOSITION_STATE_CONFLICT');
  return states.includes('NO_FEEDBACK') ? 'NO_FEEDBACK' : states.includes('PARTIAL') ? 'PARTIAL'
    : states.includes('CALLBACK') ? 'CALLBACK' : 'NOT_DENIED';
}

export function buildInterviewCompletion(row) {
  const instrument = inspectInstrument(row), observedAt = [row.execution_created_at, row.execution_updated_at, row.call_updated_at, row.callback_received_at]
    .map(date).filter(Boolean).sort().at(-1) || null;
  const result = { schemaVersion: 1, rulesVersion: RULES_VERSION, executionId: row.execution_id || null,
    campaignId: row.campaign_id, iterationId: row.iteration_id, runId: row.run_id || null,
    status: 'TECHNICALLY_UNRESOLVED', reasonCodes: [], source: { frozenInstrumentHash: instrument.hash,
      evidenceFingerprint: null, observedAt, validation: 'AUTOMATED_COVERAGE_ONLY' }, coverage: emptyCoverage(), questions: [], limitations: [...limitations] };
  const finish = (status, ...reasonCodes) => ({ ...result, status, reasonCodes });
  if (row.missing_execution_evidence === true) return finish('TECHNICALLY_UNRESOLVED', 'RETAINED_ATTEMPT_WITHOUT_EXECUTION');
  if (row.execution_chronology_unresolved === true) return finish('TECHNICALLY_UNRESOLVED', 'EXECUTION_CHRONOLOGY_UNRESOLVED');
  if (row.source_conflict === true) return finish('TECHNICALLY_UNRESOLVED', 'EXECUTION_CONTACT_IDENTITY_CONFLICT');
  if (!row.execution_id) return finish('NOT_ATTEMPTED', 'NO_MATCHED_EXECUTION');
  if (Number(row.identity_conflicts) > 0 || Number(row.call_count) > 1) return finish('TECHNICALLY_UNRESOLVED', 'MATCHED_CALL_IDENTITY_REQUIRED');
  if (['READY', 'PENDING', 'QUEUED', 'SUBMITTING', 'SUBMITTED', 'RUNNING', 'IN_PROGRESS'].includes(row.execution_status)) return finish('IN_PROGRESS', 'EXECUTION_ACTIVE');
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.execution_status)) return finish('TECHNICALLY_UNRESOLVED', 'EXECUTION_STATUS_UNRESOLVED');
  if (typeof row.provider_attempt_id !== 'string' || !row.provider_attempt_id.trim() || !row.call_id
    || Number(row.call_count) !== 1 || Number(row.identity_conflicts) !== 0) return finish('TECHNICALLY_UNRESOLVED', 'MATCHED_CALL_IDENTITY_REQUIRED');
  if (!date(row.callback_received_at)) return finish('TECHNICALLY_UNRESOLVED', 'TERMINAL_CALLBACK_REQUIRED');
  const connectivity = typeof row.connectivity_status === 'string' ? token(row.connectivity_status) : '';
  if (['BUSY', 'NO_ANSWER', 'FAILED', 'VOICEMAIL', 'NOT_CONNECTED', 'UNREACHABLE', 'REJECTED', 'CANCELLED'].includes(connectivity)) {
    const recordedOutputs = object(row.response_variables) || {};
    if (transcriptPresent(row.interaction_transcript) || instrument.questions.some((question) => question.keys.some((key) => {
      try { return outputState(recordedOutputs[key], question.contract) !== 'MISSING'; } catch { return true; }
    }))) return finish('TECHNICALLY_UNRESOLVED', 'NON_CONNECTION_EVIDENCE_CONFLICT');
    return finish('NOT_CONNECTED', 'RECORDED_NON_CONNECTION');
  }
  if (connectivity !== 'CONNECTED' || !transcriptPresent(row.interaction_transcript)) return finish('TECHNICALLY_UNRESOLVED', 'CONNECTED_TRANSCRIPT_REQUIRED');
  if (row.execution_status !== 'COMPLETED') return finish('TECHNICALLY_UNRESOLVED', 'CONNECTED_EXECUTION_STATUS_CONFLICT');
  if (instrument.reason) return finish('TECHNICALLY_UNRESOLVED', instrument.reason);
  const outputs = object(row.response_variables);
  if (!outputs) return finish('TECHNICALLY_UNRESOLVED', 'STRUCTURED_OUTPUT_RECORD_REQUIRED');
  const mapped = new Set(instrument.questions.flatMap((question) => question.keys));
  const exactKeys = new Set([...mapped, 'survey_consent', 'consent', 'consent_status', 'wrong_number', 'wrong_person', 'do_not_call',
    'call_disposition', 'respondent_status', 'disposition']);
  if (Object.keys(outputs).some((key) => !exactKeys.has(key) && exactKeys.has(key.trim().toLowerCase()))) return finish('TECHNICALLY_UNRESOLVED', 'OUTPUT_KEY_CASE_CONFLICT');
  try {
    const participation = participationState(outputs);
    if (participation === 'DENIED') return finish('NO_SUBSTANTIVE_RECORD', 'RECORDED_PARTICIPATION_DENIED');
    let anySubstantiveRequiredOutput = false, anySubstantiveMappedOutput = false;
    const questions = instrument.questions.map((question) => {
      if (!question.required) {
        for (const key of question.keys) if (outputState(outputs[key], null) === 'SUBSTANTIVE') anySubstantiveMappedOutput = true;
        return { code: question.code, required: false, status: 'NOT_REQUIRED', mappedOutputs: question.keys.length };
      }
      const states = question.keys.map((key) => outputState(outputs[key], question.contract));
      if (states.includes('SUBSTANTIVE')) anySubstantiveRequiredOutput = anySubstantiveMappedOutput = true;
      if (states.includes('SUBSTANTIVE') && (states.includes('CANT_SAY') || states.includes('REFUSED'))) throw new Error('MIXED_EXPLICIT_OUTPUT_STATE_UNRESOLVED');
      const status = states.includes('MISSING') ? 'MISSING' : states.includes('SUBSTANTIVE') ? 'SUBSTANTIVE'
        : states.includes('REFUSED') ? 'REFUSED' : 'CANT_SAY';
      return { code: question.code, required: true, status, mappedOutputs: question.keys.length };
    });
    const required = questions.filter((question) => question.required), count = (state) => required.filter((question) => question.status === state).length;
    if (participation === 'NO_FEEDBACK' && anySubstantiveMappedOutput) throw new Error('NO_MEANINGFUL_DISPOSITION_CONFLICT');
    if (['PARTIAL', 'CALLBACK'].includes(participation) && anySubstantiveRequiredOutput && count('MISSING') === 0) {
      throw new Error(participation === 'CALLBACK' ? 'CALLBACK_DISPOSITION_CONFLICT' : 'PARTIAL_DISPOSITION_CONFLICT');
    }
    result.questions = questions;
    result.coverage = { requiredQuestions: required.length, accountedQuestions: required.length - count('MISSING'),
      substantiveQuestions: count('SUBSTANTIVE'), missingQuestions: count('MISSING'), cantSayQuestions: count('CANT_SAY'), refusedQuestions: count('REFUSED') };
    result.source.evidenceFingerprint = fingerprint({ rulesVersion: RULES_VERSION, executionId: row.execution_id,
      campaignId: row.campaign_id, iterationId: row.iteration_id, runId: row.run_id, contactId: row.run_contact_id,
      voterId: row.voter_id, providerAttemptId: row.provider_attempt_id, callId: row.call_id, executionStatus: row.execution_status,
      executionCreatedAt: date(row.execution_created_at), connectivityStatus: row.connectivity_status,
      callbackReceivedAt: date(row.callback_received_at), transcript: row.interaction_transcript, outputs: row.response_variables,
      frozenQuestionnaire: row.questionnaire_snapshot });
    if (!anySubstantiveRequiredOutput) return finish('NO_SUBSTANTIVE_RECORD', 'NO_SUBSTANTIVE_REQUIRED_OUTPUT');
    if (result.coverage.missingQuestions) return finish('PARTIAL_RECORDED', 'REQUIRED_OUTPUTS_MISSING');
    return finish('COMPLETE_RECORDED', 'ALL_REQUIRED_OUTPUTS_ACCOUNTED');
  } catch (error) { return finish('TECHNICALLY_UNRESOLVED', error.message); }
}

export function unavailableSummary(campaignId, iterationId, reason = 'RETAINED_BASE_COHORT_UNAVAILABLE', instrumentHash = null) {
  return { schemaVersion: 1, rulesVersion: RULES_VERSION, campaignId, iterationId, status: 'NOT_AVAILABLE', reason, observedAt: null,
    source: { cohort: 'NOT_AVAILABLE', attemptSelection: 'LATEST_MATCHED_EXECUTION_ACROSS_ALL_RUNS',
      validation: 'AUTOMATED_COVERAGE_ONLY', frozenInstrumentHash: instrumentHash }, counts: emptyCounts(), limitations: [...limitations,
      'The retained initial cohort could not be verified; unavailable counts must not be treated as zero.'] };
}
export function buildInterviewSummary(campaignId, iterationId, rows, instrumentRow) {
  const counts = { selectedBase: rows.length, completeRecorded: 0, partialRecorded: 0, noSubstantiveRecord: 0,
    technicallyUnresolved: 0, notConnected: 0, inProgress: 0, notAttempted: 0 };
  const mapping = { COMPLETE_RECORDED: 'completeRecorded', PARTIAL_RECORDED: 'partialRecorded', NO_SUBSTANTIVE_RECORD: 'noSubstantiveRecord',
    TECHNICALLY_UNRESOLVED: 'technicallyUnresolved', NOT_CONNECTED: 'notConnected', IN_PROGRESS: 'inProgress', NOT_ATTEMPTED: 'notAttempted' };
  const details = rows.map((row) => buildInterviewCompletion(row));
  for (const item of details) counts[mapping[item.status]]++;
  const observedAt = details.map((item) => item.source.observedAt).filter(Boolean).sort().at(-1) || null;
  const withheld = Object.entries(counts).some(([key, value]) => key !== 'selectedBase' && value > 0 && value < 5);
  return { schemaVersion: 1, rulesVersion: RULES_VERSION, campaignId, iterationId,
    status: withheld ? 'WITHHELD' : 'AVAILABLE', reason: withheld ? 'SMALL_CELL_PARTITION_WITHHELD' : 'RECORDED_COVERAGE_AVAILABLE', observedAt,
    source: { cohort: 'RETAINED_RUN_1_DATABASE_IDS', attemptSelection: 'LATEST_MATCHED_EXECUTION_ACROSS_ALL_RUNS',
      validation: 'AUTOMATED_COVERAGE_ONLY', frozenInstrumentHash: inspectInstrument(instrumentRow).hash },
    counts: withheld ? emptyCounts() : counts, limitations: [...limitations,
      'The denominator is distinct retained Run 1 database voter IDs, not a verified person count or target electorate.',
      'Only the latest matched execution across all Runs is assessed; separate attempts are never combined into a complete interview.',
      'Calls and contacts outside the retained initial cohort are excluded; this summary covers all Runs, independent of demographic filters.',
      'A non-zero outcome cell smaller than five withholds the entire count partition, including its denominator.'] };
}
