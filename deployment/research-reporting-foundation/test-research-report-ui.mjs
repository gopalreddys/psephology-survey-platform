import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { canonical } from './research-report.js';
import { syntheticId, syntheticResearchReport } from './reporting-ui-fixtures.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../../src/components/ResearchReportingPanel.tsx', import.meta.url), 'utf8');
const librarySource = await readFile(new URL('../../src/lib/research-report.ts', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../../src/app/analytics/campaigns/[id]/page.tsx', import.meta.url), 'utf8');
const compile = (input) => ts.transpileModule(input, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const library = { exports: {}, require, Error, URLSearchParams, crypto: webcrypto, TextEncoder, TextDecoder };
runInNewContext(compile(librarySource), library);
const code = compile(source);
const baseReport = syntheticResearchReport();
assert.equal(baseReport.schemaVersion, 2);
assert.equal(baseReport.rulesVersion, 'RESEARCH_REPORT_V2');
assert.equal(baseReport.fieldworkDiagnostics.status, 'AVAILABLE');
assert.deepEqual(baseReport.fieldworkDiagnostics.coverage.stages.map((row) => row.participants), [60, 50, 40, 30]);
assert.equal(baseReport.fieldworkDiagnostics.sources.analysisBaseAlignment, 'MATCHED');
assert.equal(baseReport.reports.filter((report) => report.captureStatus === 'DESCRIPTIVE_AVAILABLE').length, 8, 'preview uses exact frozen-output aggregation for implemented constructs');
assert.equal(baseReport.reports.filter((report) => report.captureStatus === 'MAPPING_PENDING').length, 2, 'scheme and named-leader calculations remain pending, not fabricated');
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flatten = (element) => !element || typeof element !== 'object' ? []
  : Array.isArray(element) ? element.flatMap(flatten) : [element, ...flatten(element.props?.children)];
const text = (value) => Array.isArray(value) ? value.map(text).join('')
  : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function rehash(report) {
  const payload = Object.fromEntries(Object.entries(report).filter(([key]) => !['checksum', 'reportId'].includes(key)));
  const checksum = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  return { ...payload, checksum, reportId: `research-report-${checksum.slice(0, 24)}` };
}

function harness(apiFetch, initialProps = { campaignId: syntheticId(1), query: `iterationId=${syntheticId(2)}` }) {
  const hooks = [];
  const pendingEffects = [];
  const downloads = [];
  const blobs = [];
  const delayedRevocations = [];
  let cursor = 0;
  let props = initialProps;
  const same = (left, right) => Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (next) => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) {
        const previous = hooks[index];
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = callback(); });
      }
    },
    useCallback(callback, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: callback, deps }; return hooks[index].value; },
    useMemo(callback, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: callback(), deps }; return hooks[index].value; }
  };
  const context = {
    exports: {}, Error, Blob, crypto: webcrypto, TextEncoder, TextDecoder, URLSearchParams,
    URL: { createObjectURL: (blob) => { blobs.push(blob); return `blob:synthetic-report-${blobs.length}`; }, revokeObjectURL: (url) => downloads.push({ revoked: url }) },
    document: { createElement: (tag) => { assert.equal(tag, 'a'); const link = { href: '', download: '', click: () => downloads.push({ href: link.href, name: link.download }) }; return link; } },
    window: { setTimeout: (callback, delay) => { if (delay === 1000) { delayedRevocations.push(callback); return 0; } return setTimeout(callback, delay); }, clearTimeout },
    require: (id) => id === 'react' ? react : id === '@/lib/api' ? { apiFetch }
      : id === '@/lib/research-report' ? library.exports
        : id === './CallQualitySummary' ? { default: () => null }
        : id === './InterviewCompletionSummary' ? { default: () => null }
        : id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : require(id)
  };
  runInNewContext(code, context);
  const Component = context.exports.default;
  const render = () => { cursor = 0; return Component(props); };
  const find = (test) => flatten(render()).find(test);
  const button = (label) => find((element) => element.type === 'button' && text(element).includes(label));
  return {
    render, find, button, downloads, blobs, delayedRevocations,
    body() { return text(render()); },
    changeProps(next) { props = { ...props, ...next }; render(); },
    async flush() { while (pendingEffects.length) pendingEffects.shift()(); await tick(); await tick(); },
    unmount() { hooks.forEach((hook) => hook.cleanup?.()); }
  };
}

const requests = [];
let report = baseReport;
const app = harness(async (url, options) => { requests.push({ url, options }); return report; });
app.render();
assert.equal(app.button('Printable report').props.disabled, true);
assert.equal(app.button('Report JSON').props.disabled, true);
assert.ok(app.body().includes('Checking this selected research scope'));
await app.flush();
assert.equal(requests.length, 1);
assert.equal(requests[0].options, undefined, 'research checks are read-only GET requests');
assert.ok(app.body().includes('Methodology and report checks'));
assert.ok(app.body().includes('Display threshold met · not validation'), app.body());
assert.ok(app.body().includes('8/10'));
assert.ok(app.body().includes('No automatic research sign-off'));
assert.equal(app.button('Report JSON').props.disabled, false);
for (const disclosure of ['Report coverage and evidence', 'Contact cohort and response coverage', 'Methodology, provenance and limitations', 'Next research actions']) {
  const item = app.find((element) => element.type === 'details' && text(element).startsWith(disclosure));
  assert.ok(item, disclosure);
  assert.ok(!item.props.open, 'explanation is closed by default');
}
assert.ok(app.body().includes('Government scheme experience'));
assert.ok(app.body().includes('mapping pending'), 'unsupported mappings are not reported as available');
const tableRegion = app.find((element) => element.props?.['aria-label'] === 'Report coverage table');
assert.equal(tableRegion.props.tabIndex, 0, 'wide coverage table can be focused and panned by keyboard');
assert.equal(flatten(app.render()).filter((item) => item.type === 'article').length, 4, 'diagnostics do not add another row of summary cards');
assert.equal(flatten(app.render()).filter((item) => item.type === 'details' && text(item).startsWith('Contact cohort and response coverage')).length, 1);
assert.ok(app.body().includes('not verified unique people'));
assert.ok(app.body().includes('Current voter master · not frozen selection-time attributes'));
assert.ok(app.body().includes('30 / 60 (50.0%)'));
assert.ok(app.body().includes('Not a validated completed-survey or AAPOR response rate'));
for (const label of ['Contact coverage stages', 'Contact operational outcomes', 'Gender composition table', 'Age band composition table', 'Mandal composition table']) {
  assert.equal(app.find((element) => element.props?.['aria-label'] === label).props.tabIndex, 0);
}
app.button('Report JSON').props.onClick();
await tick();
assert.equal(app.blobs.length, 1);
assert.equal(app.blobs[0].type, 'application/json');
const json = await app.blobs[0].text();
assert.ok(json.includes('RESEARCH_REPORT_V2'));
assert.deepEqual(JSON.parse(json).fieldworkDiagnostics, baseReport.fieldworkDiagnostics, 'screen and JSON use the same aggregate diagnostic DTO');
assert.ok(!json.includes('phone_number'));
assert.match(app.downloads[0].name, /^research-report-[a-zA-Z0-9_-]+\.json$/);
assert.ok(!app.downloads[0].name.includes('/'));
app.button('Printable report').props.onClick();
await tick();
assert.equal(app.blobs.length, 2);
assert.ok(app.blobs[1].type.startsWith('text/html'));
const html = await app.blobs[1].text();
assert.ok(html.includes("default-src 'none'"));
assert.ok(html.includes('not an election forecast'));
for (const label of ['Contact cohort and response coverage', 'Observed coverage stages', 'Observed operational outcomes', 'Gender composition', 'Age band composition', 'Mandal composition', 'Last stored cohort event (UTC)', 'Current voter-master data', 'Coverage next actions']) assert.ok(html.includes(label), label);
assert.ok(html.includes('50.0%'));
assert.ok(!/<script\b|<iframe\b|<img\b/i.test(html));
assert.ok(!/\bsrc\s*=|https?:\/\//i.test(html));
assert.ok(/payload|JSON content/i.test(html), 'checksum scope must refer to the report payload rather than the HTML/PDF bytes');
assert.equal(app.delayedRevocations.length, 2);
app.delayedRevocations.forEach((callback) => callback());
assert.equal(app.downloads.filter((item) => item.revoked).length, 2);

report = syntheticResearchReport({ generatedAt: '2026-10-11T12:01:00.000Z' });
app.button('Refresh checks').props.onClick();
assert.equal(app.button('Report JSON').props.disabled, true, 'old report cannot be exported during refresh');
await app.flush();
assert.equal(requests.length, 2);
assert.ok(app.body().includes('2026-10-11T12:01:00.000Z'));

const unavailable = harness(async () => { throw new Error('Request failed (404): reporting API not installed'); });
unavailable.render(); await unavailable.flush();
assert.ok(unavailable.body().includes('Do not interpret an unavailable check as a pass'));
assert.equal(unavailable.button('Report JSON').props.disabled, true);
assert.equal(unavailable.button('Refresh checks').props.disabled, false);

const invalidPayloads = [
  { schemaVersion: 1, reports: [], checks: [] },
  rehash({ ...baseReport, methodology: null }),
  rehash({ ...baseReport, reports: baseReport.reports.map((item, index) => index ? item : { ...item, outputVariables: null }) }),
  rehash({ ...baseReport, reports: baseReport.reports.map((item, index) => index ? item : { ...item, suppressed: true, distribution: [] }) }),
  rehash({ ...baseReport, reports: baseReport.reports.map((item, index) => index ? item : { ...item, codedBase: 999 }) }),
  rehash({ ...baseReport, reports: baseReport.reports.map((item, index) => index ? item : { ...item, distribution: item.distribution.map((row, rowIndex) => rowIndex ? row : { ...row, percentage: 99 }) }) }),
  syntheticResearchReport({ campaignId: syntheticId(99) }),
  syntheticResearchReport({ iterationId: syntheticId(99) }),
  syntheticResearchReport({ filters: { gender: 'Female' } }),
  { ...baseReport, checksum: '0'.repeat(64) }
];
const mutateDiagnostics = (change) => {
  const value = structuredClone(baseReport); change(value.fieldworkDiagnostics); return rehash(value);
};
invalidPayloads.push(
  rehash({ ...baseReport, fieldworkDiagnostics: null }),
  rehash({ ...baseReport, schemaVersion: 1, rulesVersion: 'RESEARCH_REPORT_V1' }),
  rehash({ ...baseReport, reports: baseReport.reports.map((item) => ({ ...item, respondentBase: 35 })) }),
  mutateDiagnostics((item) => { item.scope.campaignId = syntheticId(99); }),
  mutateDiagnostics((item) => { item.scope.iterationId = syntheticId(99); }),
  mutateDiagnostics((item) => { item.scope.filters.ageBand = '18–29'; }),
  mutateDiagnostics((item) => { item.scope = null; }),
  mutateDiagnostics((item) => { item.status = 'NOT_AVAILABLE'; }),
  mutateDiagnostics((item) => { item.sources.eligibleFrame = 'VERIFIED'; }),
  mutateDiagnostics((item) => { item.coverage.selectedBase = 61; }),
  mutateDiagnostics((item) => { item.coverage.stages[1].participants = 59; item.coverage.stages[1].percentage = 98.3; }),
  mutateDiagnostics((item) => { item.coverage.stages[2].participants = 1; item.coverage.stages[2].percentage = 1.7; }),
  mutateDiagnostics((item) => { item.coverage.stages[0].percentage = 99; }),
  mutateDiagnostics((item) => { item.coverage.yield.percentage = 98; }),
  mutateDiagnostics((item) => { item.coverage.yield = null; }),
  mutateDiagnostics((item) => { item.outcomes.rows[0].participants = 1; item.outcomes.rows[0].percentage = 1.7; }),
  mutateDiagnostics((item) => { item.outcomes.rows[1].participants = 5; item.outcomes.rows[1].percentage = 8.3; }),
  mutateDiagnostics((item) => { item.demographics.gender.rows[0].selected = 18; item.demographics.gender.rows[0].selectedPct = 30; item.demographics.gender.rows[1].selected = 42; item.demographics.gender.rows[1].selectedPct = 70; }),
  mutateDiagnostics((item) => { item.demographics.ageBand.rows[0].structuredPct = 99; }),
  mutateDiagnostics((item) => { item.demographics.mandal.rows[0].differencePp = 99; }),
  mutateDiagnostics((item) => { item.demographics.mandal.rows[0].category = '123 456 7890'; }),
  mutateDiagnostics((item) => { item.demographics.mandal.rows[0].category = 'person@example.com'; }),
  mutateDiagnostics((item) => { item.demographics.mandal.rows[0].category = syntheticId(99); }),
  mutateDiagnostics((item) => { item.demographics.mandal.rows[0].category = 'ABC1234567'; }),
  mutateDiagnostics((item) => { item.demographics.mandal.status = 'WITHHELD'; item.demographics.mandal.selectedBase = null; item.demographics.mandal.structuredBase = null; }),
  mutateDiagnostics((item) => { item.coverage.stages[0].title = 'Sensitive name 9999999999'; }),
  mutateDiagnostics((item) => { item.voterIds = [syntheticId(99)]; }),
  mutateDiagnostics((item) => { item.sources.phone = '9999999999'; }),
  mutateDiagnostics((item) => { item.outcomes.rows[0].transcript = 'Sensitive conversation'; }),
  mutateDiagnostics((item) => { item.demographics.gender.rows[0].voter_id = syntheticId(99); })
);
for (const malformed of invalidPayloads) {
  const bad = harness(async () => malformed);
  bad.render(); await bad.flush();
  assert.ok(bad.body().includes('Research checks unavailable'), 'unsupported response is a component-level failure, not an Analysis crash');
  assert.equal(bad.button('Report JSON').props.disabled, true);
  assert.equal(bad.button('Printable report').props.disabled, true);
  assert.ok(!bad.body().includes('Fully specified report contracts'));
}

const legacy = harness(async () => syntheticResearchReport({ noSnapshot: true }));
legacy.render(); await legacy.flush();
assert.ok(legacy.body().includes('0/10'));
assert.ok(legacy.body().includes('not available'));
assert.ok(legacy.body().includes('unconfigured'));
assert.equal(legacy.button('Report JSON').props.disabled, false, 'an honest incomplete report is still available; unavailable definitions are not a transport failure');

for (const diagnosticMode of ['unavailable', 'withheld', 'demographic-withheld', 'complement-withheld', 'zero']) {
  const expected = syntheticResearchReport({ diagnosticMode });
  const example = harness(async () => expected); example.render(); await example.flush();
  assert.equal(example.button('Report JSON').props.disabled, false, `${diagnosticMode} is an honest safe state, not an API failure`);
  example.button('Report JSON').props.onClick(); await tick();
  const exported = JSON.parse(await example.blobs[0].text()).fieldworkDiagnostics;
  assert.deepEqual(exported, expected.fieldworkDiagnostics);
  if (diagnosticMode === 'unavailable') {
    assert.equal(exported.coverage.selectedBase, null);
    assert.ok(example.body().includes('Structured-record yield: Unavailable'));
  } else if (diagnosticMode === 'withheld') {
    assert.equal(exported.coverage.selectedBase, null);
    assert.equal(exported.coverage.yield, null);
    assert.ok(exported.coverage.stages.every((row) => row.participants === null && row.percentage === null));
    assert.ok(exported.outcomes.rows.every((row) => row.participants === null && row.percentage === null));
    assert.ok(Object.values(exported.demographics).every((partition) => partition.rows.length === 0));
    assert.ok(example.body().includes('Structured-record yield: Withheld'));
  } else if (diagnosticMode === 'demographic-withheld' || diagnosticMode === 'complement-withheld') {
    const kind = diagnosticMode === 'demographic-withheld' ? 'mandal' : 'gender';
    assert.equal(exported.demographics[kind].status, 'WITHHELD');
    assert.equal(exported.demographics[kind].rows.length, 0);
    assert.ok(!example.body().includes('Hidden tiny synthetic geography'));
    assert.ok(!JSON.stringify(exported).includes('Hidden tiny synthetic geography'));
    const printed = library.exports.buildPrintableResearchReport(expected);
    assert.ok(!printed.includes('Hidden tiny synthetic geography'));
    assert.ok(printed.includes('Whole composition partition withheld'));
  } else {
    assert.equal(exported.coverage.selectedBase, 0, 'verified empty filtered cohort is zero, not unavailable');
    assert.ok(exported.coverage.stages.every((row) => row.participants === 0 && row.percentage === null));
    assert.equal(exported.coverage.yield, null, 'zero denominator does not imply a zero-percent rate');
    assert.ok(example.body().includes('Retained cohort base: 0'));
    assert.ok(example.body().includes('Not calculable (zero retained cohort)'));
    assert.ok(example.body().includes('No retained records in this filtered cohort.'));
    assert.ok(!example.body().includes('Composition source unavailable.'));
    const printed = library.exports.buildPrintableResearchReport(expected);
    assert.ok(printed.includes('Not calculable (zero retained cohort)'));
    assert.ok(printed.includes('No retained records in this filtered cohort.'));
    assert.ok(!printed.includes('Composition source unavailable.'));
  }
}
const mismatchValue = rehash({ ...baseReport, fieldworkDiagnostics: { ...baseReport.fieldworkDiagnostics,
  sources: { ...baseReport.fieldworkDiagnostics.sources, analysisBaseAlignment: 'MISMATCH' } },
  reports: baseReport.reports.map((item) => ({ ...item, respondentBase: 35 })) });
const mismatch = harness(async () => mismatchValue); mismatch.render(); await mismatch.flush();
assert.equal(mismatch.button('Report JSON').props.disabled, false, 'explicit mismatches remain downloadable diagnostics, not fabricated matches');
assert.ok(mismatch.body().includes('need reconciliation'));
const partial = harness(async () => syntheticResearchReport({ iterationCompleted: false }));
partial.render(); await partial.flush();
assert.equal(partial.button('Report JSON').props.disabled, false);
assert.ok(partial.body().includes('Fieldwork is still open'));
assert.ok(partial.body().includes('in progress'));

const injected = harness(async () => rehash({ ...baseReport, respondents: [{ full_name: 'Sensitive person', phone_number: '9999999999' }], transcript: 'Sensitive conversation' }));
injected.render(); await injected.flush();
if (!injected.button('Report JSON').props.disabled) {
  injected.button('Report JSON').props.onClick(); await tick();
  const safe = await injected.blobs[0].text();
  for (const sensitive of ['Sensitive person', '9999999999', 'Sensitive conversation', 'phone_number']) assert.ok(!safe.includes(sensitive), 'unknown sensitive data cannot enter exports');
} else {
  assert.ok(injected.body().includes('Research checks unavailable'), 'unknown export fields may instead fail closed');
}

const old = deferred();
const raceCalls = [];
const filteredQuery = `iterationId=${syntheticId(2)}&ageBand=${encodeURIComponent('18–29')}`;
const race = harness(async (url) => { raceCalls.push(url); return url.includes('ageBand=') ? syntheticResearchReport({ filters: { ageBand: '18–29' } }) : old.promise; });
race.render(); await race.flush();
race.changeProps({ query: filteredQuery });
assert.equal(race.button('Report JSON').props.disabled, true);
await race.flush();
assert.equal(race.button('Report JSON').props.disabled, false);
old.resolve(syntheticResearchReport({ generatedAt: '2026-10-11T13:00:00.000Z' })); await tick(); await tick();
assert.ok(!race.body().includes('2026-10-11T13:00:00.000Z'), 'late GET cannot replace the new filtered report');
race.button('Report JSON').props.onClick(); await tick();
assert.equal(JSON.parse(await race.blobs[0].text()).scope.filters.ageBand, '18–29');
assert.equal(raceCalls.length, 2);

const staleFailure = deferred();
const failureRace = harness(async (url) => url.includes('ageBand=') ? syntheticResearchReport({ filters: { ageBand: '18–29' } }) : staleFailure.promise);
failureRace.render(); await failureRace.flush();
failureRace.changeProps({ query: filteredQuery }); await failureRace.flush();
staleFailure.reject(new Error('An old scope failed')); await tick();
assert.ok(!failureRace.body().includes('An old scope failed'));
assert.equal(failureRace.button('Report JSON').props.disabled, false);

const privateHtml = library.exports.buildPrintableResearchReport({ ...baseReport, campaign: { ...baseReport.campaign, name: '<script>alert("unsafe")</script>' } });
assert.ok(privateHtml.includes('&lt;script&gt;'));
assert.ok(!privateHtml.includes('<script>'));
assert.ok(/ResearchReportingPanel[^>]*key=[\s\S]{0,180}data\.generatedAt|ResearchReportingPanel[\s\S]{0,180}data\.generatedAt/.test(pageSource), 'main Analysis refresh also refreshes the report component');
console.log('Actual-render V2 research report and contact-cohort diagnostics: strict schema, stale scopes, same-DTO exports, small-cell/complement suppression, unavailable vs zero, aggregate privacy and printable safety passed.');
