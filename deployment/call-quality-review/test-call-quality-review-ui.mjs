import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildReviewDetail, buildReviewSummary, unavailableSummary } from './call-quality-review.js';
import { sourceRow, actor, second, approver as backendApprover, reviewRow, ruleHash, evidenceHash, uid } from './test-call-quality-review.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sources = Object.fromEntries(await Promise.all(['CallQualityReview', 'CallQualitySummary'].map(async (name) => [name, compile(await readFile(new URL(`../../src/components/${name}.tsx`, import.meta.url), 'utf8'))])));
const library = { exports: {}, require, Error };
runInNewContext(compile(await readFile(new URL('../../src/lib/call-quality-review.ts', import.meta.url), 'utf8')), library);
const { parseCallQualityEvidence, parseCallQualitySummary, qualityNoteError } = library.exports;
const id = (number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fingerprint = 'a'.repeat(64);
const checks = { greetingFlow: 'PASS', questionDelivery: 'PASS', languageHandling: 'PASS', neutrality: 'PASS', outputExtraction: 'PASS', missingStateHandling: 'PASS' };
const sampleReview = (number) => ({ id: id(number), language: 'TELUGU', checks: { ...checks }, issueBuckets: [], note: 'Questions delivered without observed looping.', createdAt: '2026-10-12T05:00:00.000Z' });
function sampleEvidence(extra = {}) { return {
  schemaVersion: 1, executionId: id(1), campaignId: id(2), iterationId: id(3), runId: id(4), evidenceFingerprint: fingerprint,
  reviewable: true, approvalReady: false, blockedReasons: ['Independent assessment prerequisites are pending.'],
  evidence: { transcript: [{ role: 'agent', text: '<script>synthetic transcript only</script>' }], outputs: { issue_priority: 'Jobs' }, questions: [{ code: 'Q_ISSUE', text: 'What issue matters?', order: 1, outputVariables: ['issue_priority'] }], agent: { appId: 'Synthetic-Agent', version: 5, basis: 'EXECUTION_REQUEST' }, frozenInstrumentHash: 'b'.repeat(64), normalizationRuleHash: 'c'.repeat(64) },
  permissions: { canReview: true, canDecide: false }, ownReview: null, reviews: [], counts: { currentReviews: 0, staleReviews: 0 }, decision: null, decisionRevision: 0, ...extra
}; }
const summary = { schemaVersion: 1, campaignId: id(2), iterationId: id(3), status: 'PENDING', counts: { reviewableCalls: 0, reviewedCalls: 0, approvedCalls: 0, rejectedCalls: 0, staleCalls: 0 }, latestDecisionAt: null, limitations: ['Approval covers only reviewed call samples.'] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
function harness(name, apiFetch, initialProps = { executionId: id(1), campaignId: id(2), iterationId: id(3), runId: id(4) }, initialRole = 'ADMIN') {
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
      : key === '@/lib/call-quality-review' ? library.exports : key.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : require(key) };
  runInNewContext(sources[name], context);
  const Component = context.exports.default;
  const render = () => { cursor = 0; return Component(props); };
  const find = (test) => flatten(render()).find(test);
  return { render, find, body: () => text(render()), html: () => renderToStaticMarkup(render()), button: (label) => find((node) => node.type === 'button' && text(node).includes(label)),
    field: (label, type) => flatten(find((node) => node.type === 'label' && text(node).startsWith(label))).find((node) => node.type === type),
    changeProps: (value) => { props = { ...props, ...value }; render(); }, changeRole: (value, actorId = userId) => { role = value; userId = actorId; render(); },
    async flush() { while (effects.length) effects.shift()(); await tick(); await tick(); }, unmount() { hooks.forEach((hook) => hook.cleanup?.()); } };
}

const expectedScope = { campaignId: id(2), iterationId: id(3), runId: id(4) };
assert.equal(parseCallQualityEvidence(sampleEvidence(), id(1), expectedScope).evidence.agent.version, 5);
const invalid = [
  { ...sampleEvidence(), extra: 'private unrecognized field' }, { ...sampleEvidence(), executionId: id(8) }, { ...sampleEvidence(), campaignId: id(8) },
  { ...sampleEvidence(), evidenceFingerprint: null }, { ...sampleEvidence(), counts: { currentReviews: -1, staleReviews: 0 } },
  { ...sampleEvidence(), evidence: { ...sampleEvidence().evidence, requestPayload: { apiKey: 'should never enter UI' } } },
  { ...sampleEvidence(), ownReview: null, reviews: [sampleReview(11)] },
  { ...sampleEvidence(), ownReview: { ...sampleReview(11), checks: { ...checks, outputExtraction: 'FAIL' } }, reviews: [sampleReview(12)], counts: { currentReviews: 2, staleReviews: 0 }, approvalReady: true, blockedReasons: [], permissions: { canReview: false, canDecide: false } },
  { ...sampleEvidence(), counts: { currentReviews: 3, staleReviews: 0 }, permissions: { canReview: false, canDecide: false } },
  { ...sampleEvidence(), evidence: { ...sampleEvidence().evidence, agent: { appId: 'Synthetic', version: 0, basis: 'EXECUTION_REQUEST' } } },
  { ...sampleEvidence(), approvalReady: true, counts: { currentReviews: 2, staleReviews: 0 }, blockedReasons: [] },
  { ...sampleEvidence(), decision: { revision: 2, action: 'APPROVE_SAMPLE', reason: 'Not current', decidedAt: '2026-10-12T05:00:00.000Z', evidenceFingerprint: fingerprint }, decisionRevision: 1 }
];
for (const value of invalid) assert.throws(() => parseCallQualityEvidence(value, id(1), expectedScope));
assert.equal(parseCallQualitySummary({ ...summary, status: 'STALE', counts: { ...summary.counts, staleCalls: 3 } }, id(2), id(3)).counts.staleCalls, 3, 'historical stale calls need not be currently reviewable');
assert.equal(parseCallQualitySummary({ ...summary, status: 'CHANGES_REQUIRED', counts: { ...summary.counts, rejectedCalls: 1 } }, id(2), id(3)).counts.rejectedCalls, 1, 'current rejection can outlive reviewer eligibility');
for (const value of [{ ...summary, individualNotes: ['private'] }, { ...summary, iterationId: id(9) }, { ...summary, counts: { ...summary.counts, reviewedCalls: -1 } }]) assert.throws(() => parseCallQualitySummary(value, id(2), id(3)));
for (const value of [{ ...summary, status: 'SAMPLE_APPROVED_PARTIAL' }, { ...summary, status: 'NOT_AVAILABLE', latestDecisionAt: '2026-10-12T05:00:00.000Z' }, { ...summary, status: 'PENDING', counts: { ...summary.counts, approvedCalls: 2 } }]) assert.throws(() => parseCallQualitySummary(value, id(2), id(3)));
assert.ok(qualityNoteError('Call +91 98765 43210'));
assert.ok(qualityNoteError('person@example.test'));
assert.ok(qualityNoteError('', true));
assert.equal(qualityNoteError('Greeting repeats after the first answer.'), null);
// Verify the decoder against actual pure backend DTOs, not only UI-specific fixtures.
const backendReviews = [reviewRow(21, actor), reviewRow(22, second)];
const backendDecision = { execution_id: uid(6), revision: 1, action: 'APPROVE_SAMPLE', reason: 'Synthetic audited call sample only.', actor_user_id: backendApprover.id, evidence_fingerprint: evidenceHash, decided_at: '2026-10-12T12:00:00Z', eligible: true };
const backendScope = { campaignId: sourceRow.campaign_id, iterationId: sourceRow.iteration_id, runId: sourceRow.run_id };
for (const [row, account, reviews, decisions] of [
  [sourceRow, actor, [], []], [sourceRow, second, backendReviews.slice(0, 1), []],
  [sourceRow, actor, backendReviews, []], [sourceRow, backendApprover, backendReviews, []],
  [sourceRow, backendApprover, backendReviews, [backendDecision]],
  [sourceRow, backendApprover, [backendReviews[0], { ...backendReviews[1], eligible: false }], [backendDecision]],
  [{ ...sourceRow, request_payload: {} }, actor, [], []], [{ ...sourceRow, execution_status: 'SUBMITTED' }, actor, backendReviews, [backendDecision]],
  [{ ...sourceRow, questionnaire_snapshot: { ...sourceRow.questionnaire_snapshot, snapshot_schema_version: 1 } }, actor, [], []]
]) {
  const dto = buildReviewDetail(row, account, reviews, decisions, ruleHash);
  assert.equal(parseCallQualityEvidence(dto, sourceRow.execution_id, backendScope).executionId, sourceRow.execution_id);
}
for (const [rows, reviews, decisions] of [[[], [], []], [[sourceRow], backendReviews, []], [[sourceRow], backendReviews, [backendDecision]], [[sourceRow], backendReviews, [{ ...backendDecision, action: 'REJECT_SAMPLE' }]], [[], backendReviews, [backendDecision]]]) {
  const dto = buildReviewSummary(sourceRow.campaign_id, sourceRow.iteration_id, rows, reviews, decisions, ruleHash);
  assert.equal(parseCallQualitySummary(dto, sourceRow.campaign_id, sourceRow.iteration_id).status, dto.status);
}
assert.equal(parseCallQualitySummary(unavailableSummary(sourceRow.campaign_id, sourceRow.iteration_id), sourceRow.campaign_id, sourceRow.iteration_id).status, 'NOT_AVAILABLE');

for (const role of ['CAMPAIGN_MANAGER', 'CAMPAIGNER', null]) {
  let requests = 0;
  const app = harness('CallQualityReview', async () => { requests++; return sampleEvidence(); }, undefined, role);
  assert.equal(app.render(), null); await app.flush(); assert.equal(requests, 0, 'non-admin roles do not load individual review evidence'); app.unmount();
}
const requests = [];
let evidence = sampleEvidence(), write = deferred();
const app = harness('CallQualityReview', async (url, options) => { requests.push({ url, options }); return options?.method === 'POST' ? write.promise : evidence; });
assert.ok(app.body().includes('Loading current call evidence')); await app.flush();
assert.equal(requests.length, 1);
assert.ok(app.body().includes('Operational quality only'));
assert.ok(app.body().includes('Actual request agent'));
assert.ok(app.body().includes('Synthetic-Agent · version 5'));
assert.ok(app.html().includes('&lt;script&gt;synthetic transcript only&lt;/script&gt;'));
assert.ok(!app.html().includes('<script>'));
assert.ok(flatten(app.render()).filter((node) => node.type === 'select').every((node) => node.props.value === ''), 'no language/pass results are prefilled');
assert.ok(flatten(app.render()).filter((node) => node.type === 'input' && node.props.type === 'checkbox').every((node) => !node.props.checked), 'no attestation or issue is prefilled');
assert.equal(app.button('Record immutable review').props.disabled, true);
assert.equal(app.button('Approve reviewed call sample').props.disabled, true);
app.field('Observed language', 'select').props.onChange({ target: { value: 'TELUGU' } });
for (const [key, label] of library.exports.qualityChecks) app.field(label, 'select').props.onChange({ target: { value: key === 'greetingFlow' ? 'FAIL' : 'PASS' } });
app.field('Greeting / name-validation loop', 'input').props.onChange({ target: { checked: true } });
app.field('Diagnostic note', 'textarea').props.onChange({ target: { value: 'Greeting repeats after the first answer.' } });
app.field('I independently reviewed', 'input').props.onChange({ target: { checked: true } });
const reviewForm = app.find((node) => node.type === 'form' && text(node).startsWith('Independent review'));
reviewForm.props.onSubmit({ preventDefault() {} }); reviewForm.props.onSubmit({ preventDefault() {} });
await tick();
assert.equal(requests.filter((request) => request.options?.method === 'POST').length, 1, 'duplicate submit is blocked synchronously');
const reviewBody = JSON.parse(requests.at(-1).options.body);
assert.equal(reviewBody.expectedEvidenceFingerprint, fingerprint);
assert.equal(reviewBody.checks.greetingFlow, 'FAIL');
assert.equal(reviewBody.attested, true);
assert.deepEqual(reviewBody.issueBuckets, ['GREETING_LOOP']);
assert.ok(!Object.hasOwn(reviewBody, 'actorId'), 'actor identity is not client-supplied');
assert.equal(app.button('Refresh evidence').props.disabled, true);
write.reject(new Error('Request failed (409): evidence changed')); await tick();
assert.ok(app.body().includes('Draft cleared'));
assert.ok(app.body().includes('Loading current call evidence'));
await app.flush();
assert.ok(flatten(app.render()).filter((node) => node.type === 'select').every((node) => node.props.value === ''));
assert.ok(!app.field('I independently reviewed', 'input').props.checked);
assert.equal(requests.filter((request) => request.options?.method === 'POST').length, 1, 'conflict reload never automatically retries a write');

const old = deferred(), newer = deferred();
const switching = harness('CallQualityReview', (url) => url.endsWith(id(1)) ? old.promise : newer.promise);
switching.render(); await switching.flush();
switching.changeProps({ executionId: id(5) });
assert.ok(!switching.body().includes('Synthetic-Agent'));
await switching.flush();
newer.resolve(sampleEvidence({ executionId: id(5), evidence: { ...sampleEvidence().evidence, agent: { appId: 'New-Agent', version: 6, basis: 'EXECUTION_REQUEST' } } })); await tick();
assert.ok(switching.body().includes('New-Agent'));
old.resolve(sampleEvidence()); await tick(); assert.ok(switching.body().includes('New-Agent')); assert.ok(!switching.body().includes('Synthetic-Agent'));
switching.changeRole('CAMPAIGN_MANAGER'); assert.equal(switching.render(), null); await switching.flush();

const ready = sampleEvidence({ approvalReady: true, blockedReasons: [], permissions: { canReview: false, canDecide: true }, counts: { currentReviews: 2, staleReviews: 1 } });
const decisions = [];
const approver = harness('CallQualityReview', async (url, options) => { if (options) decisions.push(JSON.parse(options.body)); return ready; });
approver.render(); await approver.flush();
assert.equal(approver.button('Approve reviewed call sample').props.disabled, true);
approver.field('Decision reason', 'textarea').props.onChange({ target: { value: 'Two independent all-pass reviews cover this sample only.' } });
approver.field('I understand this decision', 'input').props.onChange({ target: { checked: true } });
assert.equal(approver.button('Approve reviewed call sample').props.disabled, false);
approver.button('Approve reviewed call sample').props.onClick(); await tick();
assert.equal(decisions[0].expectedDecisionRevision, 0);
assert.equal(decisions[0].action, 'APPROVE_SAMPLE');
assert.equal(decisions[0].expectedEvidenceFingerprint, fingerprint);

const sourceUnavailable = harness('CallQualityReview', async () => sampleEvidence({ approvalReady: false, blockedReasons: ['Frozen instrument not recorded.'], evidence: { ...sampleEvidence().evidence, frozenInstrumentHash: null, questions: [] } }));
sourceUnavailable.render(); await sourceUnavailable.flush(); assert.equal(sourceUnavailable.button('Approve reviewed call sample').props.disabled, true); assert.ok(sourceUnavailable.body().includes('No verified frozen question'));
const badPayload = harness('CallQualityReview', async () => ({ ...sampleEvidence(), executionId: id(88) }));
badPayload.render(); await badPayload.flush(); assert.ok(badPayload.body().includes('No approval is assumed')); assert.ok(!badPayload.body().includes('Synthetic-Agent'));
const roleChangeRequests = [];
const roleChange = harness('CallQualityReview', async (url) => { roleChangeRequests.push(url); return sampleEvidence(); }, undefined, 'SUPER_ADMIN');
roleChange.render(); await roleChange.flush(); assert.ok(roleChange.body().includes('Synthetic-Agent'));
roleChange.changeRole('ADMIN'); assert.ok(!roleChange.body().includes('Synthetic-Agent')); await roleChange.flush(); assert.equal(roleChangeRequests.length, 2, 'allowed-role change still invalidates and reloads evidence');
roleChange.changeRole('ADMIN', id(98)); assert.ok(!roleChange.body().includes('Synthetic-Agent')); await roleChange.flush(); assert.equal(roleChangeRequests.length, 3, 'actor change invalidates evidence even with the same allowed role');

const summaryRequests = [];
const aggregate = harness('CallQualitySummary', async (url) => { summaryRequests.push(url); return summary; }, { campaignId: id(2), iterationId: id(3), refreshKey: 'synthetic-report' }, 'CAMPAIGN_MANAGER');
aggregate.render(); await aggregate.flush(); assert.equal(summaryRequests.length, 0, 'aggregate summary stays closed and unloaded by default');
aggregate.find((node) => node.type === 'details').props.onToggle({ currentTarget: { open: true } }); aggregate.render(); await aggregate.flush();
assert.equal(summaryRequests.length, 1);
assert.equal(summaryRequests[0], `/api/research-quality/campaigns/${id(2)}?iterationId=${id(3)}`);
assert.ok(aggregate.body().includes('Gender, age and Mandal filters do not narrow'));
assert.ok(!aggregate.body().includes('synthetic transcript'));
assert.equal(aggregate.find((node) => node.props?.['aria-label'] === 'Iteration-wide call-sample review counts').props.tabIndex, 0);
aggregate.changeRole('ADMIN'); assert.ok(!aggregate.body().includes('Status: pending')); await aggregate.flush(); assert.equal(summaryRequests.length, 2, 'summary invalidates after an allowed-role change');
aggregate.changeProps({ iterationId: id(8) }); assert.ok(!aggregate.body().includes('Status: pending')); await aggregate.flush(); assert.ok(aggregate.body().includes('This is not zero reviews or an approval'));
const forbiddenSummary = harness('CallQualitySummary', async () => { throw new Error('must not fetch'); }, { campaignId: id(2), iterationId: id(3), refreshKey: 'synthetic' }, 'CAMPAIGNER');
assert.equal(forbiddenSummary.render(), null); await forbiddenSummary.flush();

const callsSource = await readFile(new URL('../../src/app/calls/page.tsx', import.meta.url), 'utf8');
assert.match(callsSource, /user\?\.role\.code === "ADMIN" \|\| user\?\.role\.code === "SUPER_ADMIN"\) && <CallQualityReview/);
assert.ok(callsSource.includes('setSelected(null); setDetailLoading(true)'), 'old actionable recipient is removed while new details load');
assert.ok(callsSource.includes('current === detailGeneration.current'), 'stale drawer responses cannot overwrite current selection');
const panelSource = await readFile(new URL('../../src/components/ResearchReportingPanel.tsx', import.meta.url), 'utf8');
assert.match(panelSource, /current\.scope\.iterationId && <CallQualitySummary/);
assert.ok(panelSource.includes('researchStatusLabel(current.methodology.humanValidation)'), 'sample review does not override research humanValidation');
for (const instance of [app, switching, approver, sourceUnavailable, badPayload, roleChange, aggregate, forbiddenSummary]) instance.unmount();
console.log('Call-quality UI, strict DTO, privacy, stale scope, independent review and decision tests passed.');
