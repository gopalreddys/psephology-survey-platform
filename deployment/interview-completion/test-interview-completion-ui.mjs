import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildInterviewCompletion, buildInterviewSummary, fingerprint as backendFingerprint, unavailableSummary } from './interview-completion.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sources = Object.fromEntries(await Promise.all(['InterviewCompletionSummary', 'InterviewCompletionDetail'].map(async (name) => [name, compile(await readFile(new URL(`../../src/components/${name}.tsx`, import.meta.url), 'utf8'))])));
const library = { exports: {}, require, Error };
runInNewContext(compile(await readFile(new URL('../../src/lib/interview-completion.ts', import.meta.url), 'utf8')), library);
const { parseInterviewCompletionDetail, parseInterviewCompletionSummary } = library.exports;
const id = (number) => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fingerprint = 'a'.repeat(64);
const expected = { executionId: id(1), campaignId: id(2), iterationId: id(3), runId: id(4) };
const nullCoverage = { requiredQuestions: null, accountedQuestions: null, substantiveQuestions: null, missingQuestions: null, cantSayQuestions: null, refusedQuestions: null };
const nullCounts = { selectedBase: null, completeRecorded: null, partialRecorded: null, noSubstantiveRecord: null, technicallyUnresolved: null, notConnected: null, inProgress: null, notAttempted: null };
function detail(extra = {}) { return {
  schemaVersion: 1, rulesVersion: 'INTERVIEW_COMPLETENESS_V1', ...expected, status: 'COMPLETE_RECORDED', reasonCodes: ['ALL_REQUIRED_OUTPUTS_ACCOUNTED'],
  source: { frozenInstrumentHash: fingerprint, evidenceFingerprint: 'b'.repeat(64), observedAt: '2026-10-12T05:00:00.000Z', validation: 'AUTOMATED_COVERAGE_ONLY' },
  coverage: { requiredQuestions: 3, accountedQuestions: 3, substantiveQuestions: 1, missingQuestions: 0, cantSayQuestions: 1, refusedQuestions: 1 },
  questions: [{ code: 'Q_ISSUE', required: true, status: 'SUBSTANTIVE', mappedOutputs: 2 }, { code: 'Q_AWARENESS', required: true, status: 'CANT_SAY', mappedOutputs: 1 }, { code: 'Q_ASSESSMENT', required: true, status: 'REFUSED', mappedOutputs: 1 }, { code: 'Q_OPTIONAL', required: false, status: 'NOT_REQUIRED', mappedOutputs: 0 }],
  limitations: ['Automated coverage is not independently validated interview completion.'], ...extra
}; }
function summary(extra = {}) { return {
  schemaVersion: 1, rulesVersion: 'INTERVIEW_COMPLETENESS_V1', campaignId: id(2), iterationId: id(3), status: 'AVAILABLE', reason: 'RECORDED_COVERAGE_AVAILABLE', observedAt: '2026-10-12T05:00:00.000Z',
  source: { cohort: 'RETAINED_RUN_1_DATABASE_IDS', attemptSelection: 'LATEST_MATCHED_EXECUTION_ACROSS_ALL_RUNS', validation: 'AUTOMATED_COVERAGE_ONLY', frozenInstrumentHash: fingerprint },
  counts: { selectedBase: 40, completeRecorded: 10, partialRecorded: 5, noSubstantiveRecord: 5, technicallyUnresolved: 5, notConnected: 5, inProgress: 5, notAttempted: 5 },
  limitations: ['Distinct database voter records are not verified unique people.'], ...extra
}; }
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
function harness(name, apiFetch, initialProps = expected, initialRole = 'ADMIN') {
  const hooks = [], effects = [];
  let cursor = 0, props = initialProps, role = initialRole, userId = id(99);
  const same = (left, right) => left && right && left.length === right.length && left.every((item, index) => item === right[index]);
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, (next) => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(callback, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) { const previous = hooks[index]; hooks[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = callback(); }); } }
  };
  const context = { exports: {}, Error, window: { setTimeout, clearTimeout }, require: (key) => key === 'react' ? react : key === '@/lib/api' ? { apiFetch }
    : key === '@/hooks/useCurrentUser' ? { useCurrentUser: () => ({ user: role ? { id: userId, role: { code: role } } : null }) }
      : key === '@/lib/interview-completion' ? library.exports : key.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : require(key) };
  runInNewContext(sources[name], context);
  const Component = context.exports.default;
  const render = () => { cursor = 0; return Component(props); };
  const find = (test) => flatten(render()).find(test);
  return { render, find, body: () => text(render()), html: () => renderToStaticMarkup(render()), button: (label) => find((node) => node.type === 'button' && text(node).includes(label)),
    open() { const target = { open: true }; find((node) => node.type === 'details').props.onToggle({ target, currentTarget: target }); render(); },
    close() { const target = { open: false }; find((node) => node.type === 'details').props.onToggle({ target, currentTarget: target }); render(); },
    changeProps(value) { props = { ...props, ...value }; render(); }, changeRole(value, actorId = userId) { role = value; userId = actorId; render(); },
    async flush() { render(); while (effects.length) effects.shift()(); await tick(); await tick(); }, unmount() { hooks.forEach((hook) => hook.cleanup?.()); } };
}

assert.equal(parseInterviewCompletionDetail(detail(), expected).status, 'COMPLETE_RECORDED');
assert.equal(parseInterviewCompletionSummary(summary(), id(2), id(3)).counts.selectedBase, 40);
const partial = detail({ status: 'PARTIAL_RECORDED', reasonCodes: ['REQUIRED_OUTPUTS_MISSING'], coverage: { requiredQuestions: 3, accountedQuestions: 2, substantiveQuestions: 1, missingQuestions: 1, cantSayQuestions: 1, refusedQuestions: 0 }, questions: detail().questions.map((item) => item.code === 'Q_ASSESSMENT' ? { ...item, status: 'MISSING' } : item) });
assert.equal(parseInterviewCompletionDetail(partial, expected).status, 'PARTIAL_RECORDED');
const partialMultikey = detail({ status: 'PARTIAL_RECORDED', reasonCodes: ['REQUIRED_OUTPUTS_MISSING'], coverage: { requiredQuestions: 3, accountedQuestions: 0, substantiveQuestions: 0, missingQuestions: 3, cantSayQuestions: 0, refusedQuestions: 0 }, questions: detail().questions.map((item) => item.required ? { ...item, status: 'MISSING' } : item) });
assert.equal(parseInterviewCompletionDetail(partialMultikey, expected).status, 'PARTIAL_RECORDED', 'partly answered multikey questions can be partial with zero fully accounted questions');
for (const [status, reason] of [['TECHNICALLY_UNRESOLVED', 'VERIFIED_FROZEN_INSTRUMENT_REQUIRED'], ['NO_SUBSTANTIVE_RECORD', 'RECORDED_PARTICIPATION_DENIED'], ['NOT_CONNECTED', 'RECORDED_NON_CONNECTION'], ['IN_PROGRESS', 'EXECUTION_ACTIVE'], ['NOT_ATTEMPTED', 'NO_MATCHED_EXECUTION']]) assert.equal(parseInterviewCompletionDetail(detail({ status, reasonCodes: [reason], coverage: nullCoverage, questions: [], source: { ...detail().source, frozenInstrumentHash: null, evidenceFingerprint: null } }), expected).status, status);
for (const invalid of [
  { ...detail(), extra: 'raw answer' }, detail({ executionId: id(88) }), detail({ campaignId: id(88) }), detail({ iterationId: id(88) }), detail({ runId: id(88) }),
  detail({ rulesVersion: 'UNKNOWN' }), detail({ status: 'COMPLETED' }), detail({ coverage: nullCoverage, questions: [] }),
  detail({ source: { ...detail().source, frozenInstrumentHash: null } }), detail({ source: { ...detail().source, evidenceFingerprint: null } }),
  detail({ source: { ...detail().source, observedAt: null } }),
  detail({ source: { ...detail().source, rawPayload: {} } }), detail({ source: { ...detail().source, observedAt: 'not-date' } }),
  detail({ coverage: { ...detail().coverage, missingQuestions: 1 } }), detail({ coverage: { ...detail().coverage, cantSayQuestions: null } }),
  detail({ questions: [...detail().questions, detail().questions[0]] }), detail({ questions: detail().questions.map((item, index) => index ? item : { ...item, rawValue: 'private' }) }),
  detail({ questions: detail().questions.map((item, index) => index ? item : { ...item, mappedOutputs: -1 }) }),
  detail({ questions: detail().questions.map((item, index) => index ? item : { ...item, status: 'NOT_REQUIRED' }) }),
  detail({ questions: [...detail().questions, { ...detail().questions[0], code: 'q_issue' }] }),
  detail({ reasonCodes: ['raw private answer'] }), detail({ reasonCodes: ['DUPLICATE', 'DUPLICATE'] }),
  detail({ reasonCodes: [] }), detail({ reasonCodes: ['EXECUTION_ACTIVE'] }),
  detail({ questions: detail().questions.map((item, index) => index ? item : { ...item, code: '<script>synthetic</script>' }) }),
  ...['NO_SUBSTANTIVE_RECORD', 'TECHNICALLY_UNRESOLVED', 'NOT_CONNECTED', 'IN_PROGRESS', 'NOT_ATTEMPTED'].map((status) => detail({ status })),
  detail({ coverage: { ...detail().coverage, substantiveQuestions: 0 } })
]) assert.throws(() => parseInterviewCompletionDetail(invalid, expected));
const withheld = summary({ status: 'WITHHELD', reason: 'SMALL_CELL_PARTITION_WITHHELD', counts: nullCounts });
const unavailable = summary({ status: 'NOT_AVAILABLE', reason: 'RETAINED_BASE_COHORT_UNAVAILABLE', counts: nullCounts, source: { ...summary().source, cohort: 'NOT_AVAILABLE', frozenInstrumentHash: null } });
assert.equal(parseInterviewCompletionSummary(withheld, id(2), id(3)).counts.selectedBase, null);
assert.equal(parseInterviewCompletionSummary(unavailable, id(2), id(3)).counts.selectedBase, null);
const zero = summary({ counts: Object.fromEntries(Object.keys(nullCounts).map((key) => [key, 0])) });
assert.equal(parseInterviewCompletionSummary(zero, id(2), id(3)).counts.selectedBase, 0);
for (const invalid of [
  { ...summary(), privateDetails: [] }, summary({ campaignId: id(80) }), summary({ iterationId: id(81) }), summary({ reason: 'UNKNOWN_REASON' }),
  summary({ counts: { ...summary().counts, selectedBase: 41 } }), summary({ counts: { ...summary().counts, selectedBase: 36, partialRecorded: 1 } }),
  summary({ counts: { ...summary().counts, selectedBase: -1 } }), summary({ counts: { ...summary().counts, technicallyUnresolved: null } }),
  summary({ source: { ...summary().source, demographicScope: 'ALL' } }), summary({ source: { ...summary().source, cohort: 'NOT_AVAILABLE' } }),
  { ...withheld, counts: { ...nullCounts, selectedBase: 40 } }, { ...unavailable, counts: zero.counts },
  { ...withheld, reason: 'RECORDED_COVERAGE_AVAILABLE' }, { ...unavailable, source: summary().source }, summary({ source: { ...summary().source, frozenInstrumentHash: null } })
]) assert.throws(() => parseInterviewCompletionSummary(invalid, id(2), id(3)));

// Decode actual backend DTOs as well as deliberately malformed UI fixtures.
const frozenQuestions = [
  { question_code: 'Q_ISSUE', question_text: 'What issue matters?', question_order: 1, question_type: 'OPEN_TEXT', metadata: { required_for_completion: true, output_variables: ['issue_priority'] } },
  { question_code: 'Q_AWARENESS', question_text: 'What do you know?', question_order: 2, question_type: 'OPEN_TEXT', metadata: { required_for_completion: true, output_variables: ['awareness'] } },
  { question_code: 'Q_ASSESSMENT', question_text: 'How do you assess it?', question_order: 3, question_type: 'OPEN_TEXT', metadata: { required_for_completion: true, output_variables: ['assessment'] } },
  { question_code: 'Q_OPTIONAL', question_text: 'Any other thought?', question_order: 4, question_type: 'OPEN_TEXT', metadata: { required_for_completion: false } }
];
const frozen = { id: id(15), code: 'SYNTHETIC_UI_TEST', version: 1, snapshot_schema_version: 2, question_provenance: 'FROZEN_AT_SELECTION', questions: frozenQuestions, content_fingerprint: backendFingerprint(frozenQuestions) };
const sourceRow = { execution_id: id(1), campaign_id: id(2), iteration_id: id(3), run_id: id(4), run_contact_id: id(5), voter_id: id(6), provider_attempt_id: 'synthetic-provider-attempt', call_id: id(7), execution_status: 'COMPLETED', callback_received_at: '2026-10-12T05:00:00Z', execution_updated_at: '2026-10-12T05:00:01Z', call_updated_at: '2026-10-12T05:00:02Z', call_count: 1, identity_conflicts: 0, connectivity_status: 'CONNECTED', interaction_transcript: [{ speaker: 'respondent', text: 'Synthetic test evidence.' }], questionnaire_id: id(15), questionnaire_snapshot: frozen, response_variables: { issue_priority: 'Jobs', awareness: 'CANT_SAY', assessment: 'REFUSED' } };
const backendRows = [sourceRow,
  { ...sourceRow, response_variables: { issue_priority: 'Jobs' } },
  { ...sourceRow, response_variables: { awareness: 'CANT_SAY', assessment: 'REFUSED' } },
  { ...sourceRow, response_variables: { issue_priority: ['invalid nested response'] } },
  { ...sourceRow, response_variables: { consent: false } },
  { ...sourceRow, questionnaire_snapshot: { ...frozen, snapshot_schema_version: 1 } },
  { ...sourceRow, execution_status: 'SUBMITTED' },
  { ...sourceRow, connectivity_status: 'NO_ANSWER' }
];
const multiQuestions = frozenQuestions.map((question, index) => index ? question : { ...question, metadata: { ...question.metadata, output_variables: ['issue_priority', 'issue_reason'] } });
const multiSnapshot = { ...frozen, questions: multiQuestions, content_fingerprint: backendFingerprint(multiQuestions) };
const actualPartialMultikey = buildInterviewCompletion({ ...sourceRow, questionnaire_snapshot: multiSnapshot, response_variables: { issue_priority: 'Jobs' } });
assert.equal(actualPartialMultikey.status, 'PARTIAL_RECORDED');
assert.equal(actualPartialMultikey.coverage.accountedQuestions, 0);
assert.equal(parseInterviewCompletionDetail(actualPartialMultikey, expected).coverage.substantiveQuestions, 0);
for (const row of backendRows) {
  const dto = buildInterviewCompletion(row);
  assert.equal(parseInterviewCompletionDetail(dto, expected).status, dto.status, 'UI and backend classification contracts agree');
}
for (const rows of [[], [sourceRow], [...Array.from({ length: 5 }, () => sourceRow), ...Array.from({ length: 5 }, () => backendRows[1])]]) {
  const dto = buildInterviewSummary(id(2), id(3), rows, sourceRow);
  assert.equal(parseInterviewCompletionSummary(dto, id(2), id(3)).status, dto.status);
}
for (const reason of ['NO_SELECTED_ITERATION', 'RETAINED_BASE_COHORT_UNAVAILABLE', 'AMBIGUOUS_SOURCE_SCOPE', 'SOURCE_SCHEMA_UNAVAILABLE']) assert.equal(parseInterviewCompletionSummary(unavailableSummary(id(2), id(3), reason), id(2), id(3)).status, 'NOT_AVAILABLE');

for (const role of ['CAMPAIGN_MANAGER', 'CAMPAIGNER', null]) {
  let requests = 0;
  const app = harness('InterviewCompletionDetail', async () => { requests++; return detail(); }, undefined, role);
  assert.equal(app.render(), null); await app.flush(); assert.equal(requests, 0); app.unmount();
}
for (const role of ['CAMPAIGNER', null]) {
  let requests = 0;
  const app = harness('InterviewCompletionSummary', async () => { requests++; return summary(); }, { campaignId: id(2), iterationId: id(3), refreshKey: 'report' }, role);
  assert.equal(app.render(), null); await app.flush(); assert.equal(requests, 0); app.unmount();
}
const calls = [];
const app = harness('InterviewCompletionDetail', async (url, options) => { calls.push({ url, options }); return detail(); });
app.render(); await app.flush(); assert.equal(calls.length, 0, 'private check is collapsed and unloaded by default');
app.open(); assert.ok(app.body().includes('Checking this exact')); await app.flush();
assert.equal(calls.length, 1); assert.equal(calls[0].url, `/api/interview-completion/executions/${id(1)}`); assert.equal(calls[0].options, undefined, 'read-only GET');
assert.ok(app.body().includes('Complete recorded coverage')); assert.ok(app.body().includes('3 of 3 required questions')); assert.ok(app.body().includes('1 can’t say')); assert.ok(app.body().includes('1 refused'));
assert.ok(app.body().includes('not a human-validated completed interview')); assert.ok(app.body().includes('Do not pressure participants'));
assert.equal(app.find((node) => node.props?.['aria-label'] === 'Recorded coverage by frozen question').props.tabIndex, 0);
assert.ok(!app.body().includes('Raw answer')); assert.ok(!app.body().includes('Voter name'));
app.button('Refresh call coverage').props.onClick(); assert.ok(!app.body().includes('3 of 3 required questions')); await app.flush(); assert.equal(calls.length, 2);
app.changeRole('SUPER_ADMIN'); assert.ok(!app.body().includes('3 of 3 required questions')); await app.flush(); assert.equal(calls.length, 3, 'exact allowed role change invalidates');
app.changeRole('SUPER_ADMIN', id(98)); assert.ok(!app.body().includes('3 of 3 required questions')); await app.flush(); assert.equal(calls.length, 4, 'actor change invalidates');
app.changeProps({ runId: id(88) }); assert.ok(!app.body().includes('3 of 3 required questions')); await app.flush(); assert.ok(app.body().includes('No completion is assumed')); assert.ok(!app.body().includes('Complete recorded coverage'));
app.changeRole('CAMPAIGN_MANAGER'); assert.equal(app.render(), null); await app.flush();
const old = deferred(), recent = deferred();
const switching = harness('InterviewCompletionDetail', (url) => url.endsWith(id(1)) ? old.promise : recent.promise);
switching.render(); switching.open(); await switching.flush(); switching.changeProps({ executionId: id(8) }); await switching.flush();
recent.resolve(detail({ executionId: id(8), limitations: ['new source only'] })); await tick();
assert.ok(switching.body().includes('new source only')); old.resolve(detail()); await tick(); assert.ok(switching.body().includes('new source only'));
const privacy = harness('InterviewCompletionDetail', async () => detail({ limitations: ['<script>synthetic</script>'] }));
privacy.render(); privacy.open(); await privacy.flush(); assert.ok(privacy.html().includes('&lt;script&gt;synthetic&lt;/script&gt;')); assert.ok(!privacy.html().includes('<script>'));
const noRecord = harness('InterviewCompletionDetail', async () => detail({ status: 'NO_SUBSTANTIVE_RECORD', reasonCodes: ['RECORDED_PARTICIPATION_DENIED'], coverage: nullCoverage, questions: [] }));
noRecord.render(); noRecord.open(); await noRecord.flush(); assert.ok(noRecord.body().includes('No substantive record')); assert.ok(!noRecord.body().includes('No interview')); assert.ok(!noRecord.body().includes('Retry refusal'));
const bad = harness('InterviewCompletionDetail', async () => ({ ...detail(), rawOutputs: { private: 'never shown' } }));
bad.render(); bad.open(); await bad.flush(); assert.ok(bad.body().includes('No completion is assumed')); assert.ok(!bad.body().includes('never shown'));
const privateReopen = harness('InterviewCompletionDetail', async () => detail());
privateReopen.render(); privateReopen.open(); await privateReopen.flush(); assert.ok(privateReopen.body().includes('3 of 3 required questions'));
privateReopen.close(); await privateReopen.flush(); privateReopen.open(); assert.ok(!privateReopen.body().includes('3 of 3 required questions')); assert.ok(privateReopen.body().includes('Checking this exact')); await privateReopen.flush(); assert.ok(privateReopen.body().includes('3 of 3 required questions'));
privateReopen.find((node) => node.type === 'details').props.onToggle({ target: { open: true }, currentTarget: { open: true } }); assert.ok(privateReopen.body().includes('3 of 3 required questions'), 'nested disclosure events never clear the outer result');
const closingOld = deferred(), reopeningNew = deferred();
let reopenPrivateRequests = 0;
const privateToggleRace = harness('InterviewCompletionDetail', () => ++reopenPrivateRequests === 1 ? closingOld.promise : reopeningNew.promise);
privateToggleRace.render(); privateToggleRace.open(); await privateToggleRace.flush();
privateToggleRace.close(); privateToggleRace.open();
closingOld.resolve(detail({ limitations: ['Old authorization result must remain hidden.'] })); await tick();
assert.ok(privateToggleRace.body().includes('Checking this exact'));
assert.ok(!privateToggleRace.body().includes('Old authorization result'), 'toggle invalidates an in-flight result before passive-effect cleanup');
await privateToggleRace.flush(); reopeningNew.resolve(detail({ limitations: ['Fresh reopening authorization.'] })); await tick();
assert.ok(privateToggleRace.body().includes('Fresh reopening authorization')); assert.ok(!privateToggleRace.body().includes('Old authorization result'));
const summaryRequests = [];
let aggregateDto = summary();
const aggregate = harness('InterviewCompletionSummary', async (url, options) => { summaryRequests.push({ url, options }); return aggregateDto; }, { campaignId: id(2), iterationId: id(3), refreshKey: 'report' }, 'CAMPAIGN_MANAGER');
aggregate.render(); await aggregate.flush(); assert.equal(summaryRequests.length, 0); aggregate.open(); await aggregate.flush();
assert.equal(summaryRequests[0].url, `/api/interview-completion/campaigns/${id(2)}?iterationId=${id(3)}`); assert.equal(summaryRequests[0].options, undefined);
assert.ok(aggregate.body().includes('Gender, age, Mandal and Run filters do not narrow')); assert.ok(aggregate.body().includes('40 database voter records')); assert.ok(!aggregate.body().includes('%'));
assert.equal(aggregate.find((node) => node.props?.['aria-label'] === 'Iteration-wide recorded interview coverage').props.tabIndex, 0);
aggregateDto = withheld; aggregate.button('Refresh recorded coverage').props.onClick(); await aggregate.flush(); assert.ok(aggregate.body().includes('Counts withheld')); assert.ok(!aggregate.body().includes('40 database voter records'));
aggregateDto = unavailable; aggregate.button('Refresh recorded coverage').props.onClick(); await aggregate.flush(); assert.ok(aggregate.body().includes('No counts or completion rate are assumed'));
aggregateDto = zero; aggregate.button('Refresh recorded coverage').props.onClick(); await aggregate.flush(); assert.ok(aggregate.body().includes('0 database voter records')); assert.ok(!aggregate.body().includes('unavailable'));
aggregateDto = summary(); aggregate.changeProps({ refreshKey: 'new-report' }); assert.ok(!aggregate.body().includes('0 database voter records')); await aggregate.flush(); assert.ok(aggregate.body().includes('40 database voter records'));
aggregate.changeRole('ADMIN'); assert.ok(!aggregate.body().includes('40 database voter records')); await aggregate.flush();
aggregate.changeRole('ADMIN', id(97)); assert.ok(!aggregate.body().includes('40 database voter records')); await aggregate.flush();
aggregate.changeProps({ iterationId: id(8) }); await aggregate.flush(); assert.ok(aggregate.body().includes('This is not zero records')); assert.ok(!aggregate.body().includes('40 database voter records'));
aggregate.changeProps({ iterationId: id(3) }); await aggregate.flush(); assert.ok(aggregate.body().includes('40 database voter records'));
aggregate.close(); await aggregate.flush(); assert.ok(!aggregate.body().includes('40 database voter records'));
const beforeReopen = summaryRequests.length; aggregate.open(); assert.ok(!aggregate.body().includes('40 database voter records')); assert.ok(aggregate.body().includes('Checking Iteration-wide')); await aggregate.flush(); assert.equal(summaryRequests.length, beforeReopen + 1, 'reopening rereads current authorization and evidence');
const aggregateOld = deferred(), aggregateNew = deferred();
let aggregateToggleRequests = 0;
const summaryToggleRace = harness('InterviewCompletionSummary', () => ++aggregateToggleRequests === 1 ? aggregateOld.promise : aggregateNew.promise, { campaignId: id(2), iterationId: id(3), refreshKey: 'race' }, 'CAMPAIGN_MANAGER');
summaryToggleRace.render(); summaryToggleRace.open(); await summaryToggleRace.flush();
summaryToggleRace.close(); summaryToggleRace.open();
aggregateOld.resolve(summary()); await tick(); assert.ok(summaryToggleRace.body().includes('Checking Iteration-wide')); assert.ok(!summaryToggleRace.body().includes('40 database voter records'), 'closed/reopened summary cannot resurrect a result before passive effects run');
await summaryToggleRace.flush(); aggregateNew.resolve(summary({ counts: { ...summary().counts, selectedBase: 50, completeRecorded: 20 } })); await tick();
assert.ok(summaryToggleRace.body().includes('50 database voter records')); assert.ok(!summaryToggleRace.body().includes('40 database voter records'));

const callsSource = await readFile(new URL('../../src/app/calls/page.tsx', import.meta.url), 'utf8');
assert.match(callsSource, /user\?\.role\.code === "ADMIN" \|\| user\?\.role\.code === "SUPER_ADMIN"\) && <InterviewCompletionDetail/);
const panelSource = await readFile(new URL('../../src/components/ResearchReportingPanel.tsx', import.meta.url), 'utf8');
assert.match(panelSource, /current\.scope\.iterationId && <InterviewCompletionSummary/);
assert.ok(panelSource.includes('Formal response rate / validated completions'), 'existing unknown research-completion claim stays separate');
for (const name of ['InterviewCompletionSummary', 'InterviewCompletionDetail']) { const raw = await readFile(new URL(`../../src/components/${name}.tsx`, import.meta.url), 'utf8'); assert.ok(!/method:\s*["'](?:POST|PATCH|DELETE)/.test(raw)); }
for (const widget of [app, switching, privacy, noRecord, bad, privateReopen, privateToggleRace, aggregate, summaryToggleRace]) widget.unmount();
console.log('Recorded interview coverage UI decoder, actual React rendering, read-only requests, privacy, role/scope invalidation and race tests passed.');
