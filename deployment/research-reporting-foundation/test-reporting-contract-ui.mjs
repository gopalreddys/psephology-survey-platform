import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { normalizeOutputValue } from '../output-variable-standardization/output-normalization.repository.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../../src/components/QuestionnaireReportingContracts.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../src/app/questionnaires/[id]/page.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../../src/components/questionnaire-reporting-contracts.module.css', import.meta.url), 'utf8');
const presetSource = await readFile(new URL('../../src/lib/reporting-presets.ts', import.meta.url), 'utf8');
const presetModule = { exports: {}, crypto: webcrypto, TextEncoder, Uint8Array, Date };
runInNewContext(ts.transpileModule(presetSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, presetModule);
const presets = presetModule.exports;
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;

function fixture(id = 'instrument', changes = {}) {
  return {
    questionnaire: { id, code: 'DEMO_INSTRUMENT', name: 'Demo instrument', version: 1, status: 'DRAFT' },
    locked: false, lockReason: null, usedByIterations: 0, metadataWritable: true,
    questions: [{ id: 'question', questionCode: 'Q_ISSUES', order: 1, text: 'What issue matters most?', contract: null,
      contractValid: false, contractError: null, expectedContractFingerprint: 'a'.repeat(64) }],
    ...changes
  };
}
const definition = {
  reportKey: 'issue_priority', outputVariables: ['issue_priority'], valueType: 'CATEGORICAL',
  allowedValues: ['Employment', 'Education'], target: { type: 'NONE', id: '', name: '' }, missingPolicy: 'EXPLICIT_STATES'
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flatten = (element) => !element || typeof element !== 'object' ? []
  : Array.isArray(element) ? element.flatMap(flatten) : [element, ...flatten(element.props?.children)];
const text = (value) => Array.isArray(value) ? value.map(text).join('')
  : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';

function harness(apiFetch, buildReviewPack = presets.buildSarvamReviewPack) {
  const hooks = [];
  const pendingEffects = [];
  let cursor = 0;
  let questionnaireId = 'instrument';
  const same = (left, right) => Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (next) => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: callback, deps };
      return hooks[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) {
        const previous = hooks[index];
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = callback(); });
      }
    }
  };
  const downloads = [], blobs = [], revoked = [];
  const context = { exports: {}, Error, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:local-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
    document: { body: { appendChild() {} }, createElement(kind) {
      assert.equal(kind, 'a');
      return { click() { downloads.push({ href: this.href, name: this.download }); }, remove() {} };
    } },
    require: (id) => id === 'react' ? react
    : id === '@/lib/api' ? { apiFetch }
      : id === '@/lib/reporting-presets' ? { ...presets, buildSarvamReviewPack: buildReviewPack }
      : id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : require(id) };
  runInNewContext(compiled, context);
  const Component = context.exports.default;
  const render = () => { cursor = 0; return Component({ questionnaireId }); };
  const find = (test) => flatten(render()).find(test);
  const button = (label) => find((element) => element.type === 'button' && text(element).includes(label));
  const field = (label) => {
    const item = find((element) => element.type === 'label' && text(element).startsWith(label));
    return flatten(item?.props.children).find((element) => ['input', 'select', 'textarea'].includes(element.type));
  };
  return {
    render, find, button, field, downloads, blobs, revoked,
    setField(label, value) { const control = field(label); assert.ok(control, label); control.props.onChange({ target: { value } }); },
    async flush() { while (pendingEffects.length) pendingEffects.shift()(); await tick(); },
    changeId(id) { questionnaireId = id; render(); },
    unmount() { hooks.forEach((hook) => hook.cleanup?.()); },
    body() { return text(render()); }
  };
}

const calls = [];
let current = fixture();
let failPatch = false;
let failReload = false;
let patchWait = null;
const app = harness(async (url, options) => {
  calls.push({ url, options });
  if (options?.method === 'PATCH') {
    if (failPatch) throw new Error('Definition changed concurrently. Refresh and retry.');
    if (patchWait) await patchWait.promise;
    const body = JSON.parse(options.body);
    current = fixture('instrument', { questions: [{ ...current.questions[0], contract: body.contract, contractValid: true, expectedContractFingerprint: 'b'.repeat(64) }] });
    return { question: current.questions[0] };
  }
  if (failReload) throw new Error('API returned 503');
  return current;
});
assert.ok(app.body().includes('Loading reporting definitions'));
assert.equal(app.button('Refresh definitions').props.disabled, true);
await app.flush();
assert.ok(app.body().includes('0/1 question contracts defined'));
assert.ok(app.body().includes('provider delivery not verified'));
assert.ok(app.body().includes('conceptual reporting-state names'));
assert.ok(app.body().includes('"no answer", "can\'t say" and "refused"'));
assert.ok(app.body().includes('Do not emit underscore tokens'));
assert.ok(app.find((element) => element.type === 'details' && text(element).startsWith('How reporting definitions work')));
app.button('Define reporting outputs').props.onClick();
assert.ok(app.field('Output keys *'));
const form = () => app.find((element) => element.type === 'form');
const submit = () => form().props.onSubmit({ preventDefault() {} });
submit();
await tick();
assert.ok(app.body().includes('Enter 1–10 unique output keys'));
assert.equal(calls.filter((call) => call.options?.method === 'PATCH').length, 0);
app.setField('Output keys *', 'issue_priority');
app.setField('Substantive categories *', 'Employment\nNOT_ANSWERED');
submit(); await tick();
assert.ok(app.body().includes('Do not include NOT_ANSWERED'));
app.setField('Substantive categories *', 'Employment\nEducation');
app.setField('Report *', 'candidate_impression');
assert.equal(app.field('Target type *').props.value, 'CANDIDATE');
submit(); await tick();
assert.ok(app.body().includes('Named targets need a stable ID'));
app.setField('Stable target ID *', 'candidate-demo');
app.setField('Target name *', 'Demo candidate');
failPatch = true;
submit(); await tick();
assert.ok(app.body().includes('Definition changed concurrently'));
assert.ok(!app.body().includes('Contract saved and reloaded'));
assert.ok(app.field('Target name *'), 'failed PATCH keeps the editor available');
failPatch = false;
patchWait = deferred();
submit();
submit();
assert.equal(calls.filter((call) => call.options?.method === 'PATCH').length, 2, 'one failed request and one in-flight request, with no duplicate submit');
assert.equal(app.button('Refresh definitions').props.disabled, true);
assert.equal(app.find((element) => element.type === 'fieldset').props.disabled, true);
patchWait.resolve(); await tick();
const patch = calls.findLast((call) => call.options?.method === 'PATCH');
assert.equal(JSON.parse(patch.options.body).expectedContractFingerprint, 'a'.repeat(64));
assert.equal(JSON.parse(patch.options.body).contract.target.type, 'CANDIDATE');
assert.equal(JSON.parse(patch.options.body).contract.missingPolicy, 'EXPLICIT_STATES');
assert.equal(calls.at(-1).options, undefined, 'successful PATCH is followed by GET before claiming success');
assert.ok(app.body().includes('Contract saved and reloaded. Provider delivery remains unverified.'));
assert.ok(app.body().includes('1/1 question contracts defined'));
patchWait = null;
app.button('Edit definition').props.onClick();
failReload = true;
submit(); await tick();
assert.ok(app.body().includes('change may have been saved'));
assert.ok(!app.body().includes('Contract saved and reloaded'));
assert.equal(app.button('Edit definition'), undefined, 'failed reload removes stale editable definitions');
failReload = false;
app.button('Refresh definitions').props.onClick(); await tick();
assert.ok(app.body().includes('1/1 question contracts defined'));

for (const changes of [{ locked: true, usedByIterations: 2, lockReason: 'Frozen instrument' }, { metadataWritable: false }, { usedByIterations: 1 }]) {
  const locked = harness(async () => fixture('instrument', changes));
  locked.render(); await locked.flush();
  assert.equal(locked.button('Define reporting outputs'), undefined);
  assert.ok(locked.body().includes('Create a new questionnaire version'));
}
const unavailable = harness(async () => { throw new Error('Request failed (404): <!DOCTYPE html> Cannot GET /api/questionnaires/instrument/reporting-coverage'); });
unavailable.render(); await unavailable.flush();
assert.ok(unavailable.body().includes('backend may not be installed'));
assert.ok(!unavailable.body().includes('<!DOCTYPE html>'));
assert.ok(!unavailable.body().includes('0/1 question contracts'));
assert.equal(unavailable.button('Define reporting outputs'), undefined);
assert.equal(unavailable.button('Refresh definitions').props.disabled, false);
for (const bad of [fixture('wrong'), { ...fixture(), questions: undefined }, { ...fixture(), questions: [{ ...fixture().questions[0], expectedContractFingerprint: 'missing' }] }]) {
  const malformed = harness(async () => bad);
  malformed.render(); await malformed.flush();
  assert.ok(malformed.body().includes('invalid response'));
  assert.equal(malformed.button('Define reporting outputs'), undefined);
}

const slow = deferred();
const race = harness(async (url) => url.includes('/instrument/') ? slow.promise : fixture('new-instrument'));
race.render(); await race.flush();
race.changeId('new-instrument'); await race.flush();
assert.ok(race.body().includes('0/1 question contracts defined'));
slow.resolve(fixture('instrument', { locked: true, usedByIterations: 99 })); await tick();
assert.ok(!race.body().includes('99 iteration(s)'), 'late responses cannot replace the new instrument');
assert.ok(race.button('Define reporting outputs'));

const latePatch = deferred();
let patchCount = 0;
const saveRace = harness(async (url, options) => {
  if (options?.method === 'PATCH') { ++patchCount; return latePatch.promise; }
  return fixture(url.includes('/instrument/') ? 'instrument' : 'new-instrument');
});
saveRace.render(); await saveRace.flush();
saveRace.button('Define reporting outputs').props.onClick();
saveRace.setField('Output keys *', 'issue_priority');
saveRace.setField('Substantive categories *', 'Employment\nEducation');
saveRace.find((element) => element.type === 'form').props.onSubmit({ preventDefault() {} });
saveRace.changeId('new-instrument'); await saveRace.flush();
latePatch.resolve({ question: {} }); await tick();
assert.equal(patchCount, 1);
assert.ok(!saveRace.body().includes('Contract saved'), 'late PATCH cannot report success in another instrument');
assert.ok(saveRace.button('Define reporting outputs'));

const nullStates = harness(async () => fixture('instrument', {
  questions: [{ ...fixture().questions[0], contract: definition, contractValid: true }]
}));
nullStates.render(); await nullStates.flush();
assert.ok(nullStates.body().includes('Employment, Education'));
assert.ok(nullStates.body().includes('Contract defined · provider delivery not verified'));
assert.ok(!nullStates.body().includes('Sarvam verified'));
assert.ok(page.includes('key={`${questionnaireId}:${questionnaire.questions.length}`}'), 'adding questions reloads the collection-contract component');
assert.ok(page.indexOf('<QuestionnaireReportingContracts') > page.indexOf('className="question-detail-metrics"'));
assert.ok(page.indexOf('<QuestionnaireReportingContracts') < page.indexOf('{showAdd &&'));
assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
assert.ok(css.includes('@media (max-width: 640px)'));
assert.ok(css.includes(':focus-visible'));

// Every preset is an explicit authoring aid, not a question/provider update.
assert.deepEqual(Array.from(presets.REPORTING_PRESETS, (item) => item.reportKey), ['development_priority', 'expected_change', 'leader_assessment']);
for (const preset of presets.REPORTING_PRESETS) {
  for (const label of preset.allowedValues) {
    assert.equal(normalizeOutputValue(preset.outputVariable, label).label, label,
      `${preset.reportKey}: canonical emitted categories round-trip through the real normalizer`);
  }
  assert.ok(preset.english && preset.telugu);
  assert.doesNotMatch(`${preset.english} ${preset.telugu}`, /BRS|BJP|Congress|Kasani|Veeresh|vote for|support this/i);
}
assert.ok(!presets.PRIORITY_REPORTING_CATEGORIES.includes('Multiple issues mentioned'), 'Multiple/uncoded is not a substantive emitted preset category');
const presetCalls = [];
const presetApp = harness(async (url, options) => { presetCalls.push({ url, options }); return fixture(); });
presetApp.render(); await presetApp.flush();
presetApp.button('Define reporting outputs').props.onClick();
assert.equal(presetApp.button('Download agent review pack').props.disabled, true, 'An unsaved editor cannot export stale saved definitions');
for (const preset of presets.REPORTING_PRESETS) {
  presetApp.button(`Use ${preset.label.toLowerCase()} preset`).props.onClick();
  assert.equal(presetApp.field('Report *').props.value, preset.reportKey);
  assert.equal(presetApp.field('Output keys *').props.value, preset.outputVariable);
  assert.equal(presetApp.field('Substantive categories *').props.value, preset.allowedValues.join('\n'));
  assert.equal(presetApp.field('Target type *').props.value, preset.targetType);
  assert.ok(presetApp.body().includes('What issue matters most?'), 'The saved question is not replaced by a suggestion');
  assert.equal(presetApp.field('Suggested English question').props.readOnly, true);
  assert.equal(presetApp.field('Suggested English question').props.value, preset.english);
  assert.equal(presetApp.field('Suggested Telugu question').props.lang, 'te');
  assert.equal(presetCalls.filter((call) => call.options).length, 0, 'Applying a preset performs no API write');
}
presetApp.find((element) => element.type === 'form').props.onSubmit({ preventDefault() {} }); await tick();
assert.ok(presetApp.body().includes('Named targets need a stable ID'), 'Leader preset cannot be saved without target identity');
assert.equal(presetCalls.filter((call) => call.options).length, 0);
presetApp.button('Download agent review pack').props.onClick(); await tick();
assert.equal(presetApp.downloads.length, 0, 'The handler independently blocks exports during unsaved editing');
presetApp.button('Cancel').props.onClick();
assert.equal(presetApp.button('Download agent review pack').props.disabled, false);

const leaderDefinition = { reportKey: 'leader_assessment', outputVariables: ['leader_assessment'], valueType: 'CATEGORICAL',
  allowedValues: ['Positive', 'Neutral', 'Negative', 'Mixed'], target: { type: 'LEADER', id: 'leader_demo', name: 'Example leader' }, missingPolicy: 'EXPLICIT_STATES' };
const packCoverage = fixture('instrument', {
  questionnaire: { ...fixture().questionnaire, phone_number: 'NEVER_EXPORT_PHONE', secret: 'NEVER_EXPORT_CREDENTIAL' },
  respondents: [{ name: 'NEVER_EXPORT_RESPONDENT', output: 'NEVER_EXPORT_ANSWER' }],
  transcript: 'NEVER_EXPORT_TRANSCRIPT',
  questions: [{ ...fixture().questions[0], text: 'Actual saved question, not a suggestion?', contractValid: true,
    contract: { ...leaderDefinition, response_variables: 'NEVER_EXPORT_CONTRACT_EXTRA', target: { ...leaderDefinition.target, phone: 'NEVER_EXPORT_TARGET_EXTRA' } },
    participant: 'NEVER_EXPORT_QUESTION_EXTRA' }]
});
const generatedAt = '2026-10-15T12:00:00.000Z';
const pack = await presets.buildSarvamReviewPack(packCoverage, generatedAt);
assert.equal(pack.provenance, 'CURRENT_CATALOGUE_NOT_ITERATION_SNAPSHOT');
assert.equal(pack.sourceFreshness, 'LOADED_COVERAGE_NOT_REVALIDATED_AT_EXPORT', 'Generation time does not certify the latest server catalogue');
assert.equal(pack.questions[0].questionText, 'Actual saved question, not a suggestion?');
assert.equal(pack.questions[0].expectedContractFingerprint, 'a'.repeat(64));
assert.equal(pack.questions[0].contract.target.id, 'leader_demo');
assert.equal(pack.reviewStatus, 'MANUAL_REVIEW_REQUIRED_NOT_LAUNCH_APPROVAL');
assert.deepEqual(JSON.parse(JSON.stringify(pack.actionsPerformed)), { providerUpdate: false, agentCommit: false, canaryCall: false, launch: false });
assert.ok(pack.requiredBeforeLaunch.some((value) => /commit the intended Sarvam agent version/.test(value)));
assert.ok(pack.requiredBeforeLaunch.some((value) => /approved canary test call/.test(value)));
assert.doesNotMatch(JSON.stringify(pack), /NEVER_EXPORT/);
const canonicalPack = (value) => Array.isArray(value) ? value.map(canonicalPack) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en-US')).map(([key, item]) => [key, canonicalPack(item)])) : value;
const payload = Object.fromEntries(Object.entries(pack).filter(([key]) => key !== 'contentFingerprint'));
assert.equal(pack.contentFingerprint, createHash('sha256').update(JSON.stringify(canonicalPack(payload))).digest('hex'));
assert.equal((await presets.buildSarvamReviewPack(packCoverage, generatedAt)).contentFingerprint, pack.contentFingerprint);
assert.notEqual((await presets.buildSarvamReviewPack({ ...packCoverage, questions: [{ ...packCoverage.questions[0], text: 'Changed wording?' }] }, generatedAt)).contentFingerprint, pack.contentFingerprint);
for (const changes of [
  { questions: [{ ...packCoverage.questions[0], expectedContractFingerprint: 'invalid' }] },
  { questions: [packCoverage.questions[0], packCoverage.questions[0]] },
  { questions: [{ ...packCoverage.questions[0], contractValid: true, contract: null }] }
]) await assert.rejects(() => presets.buildSarvamReviewPack({ ...packCoverage, ...changes }, generatedAt), /Reload valid current/);
await assert.rejects(() => presets.buildSarvamReviewPack(packCoverage, 'invalid'), /Reload valid current/);
const invalidContractPack = await presets.buildSarvamReviewPack({ ...packCoverage, questions: [{ ...packCoverage.questions[0], contractValid: false }] }, generatedAt);
assert.equal(invalidContractPack.questions[0].contract, null, 'Invalid definitions cannot be exported as valid agent instructions');
assert.equal(invalidContractPack.questions[0].definitionStatus, 'NOT_DEFINED_OR_INVALID');

const waitUntil = async (condition) => { for (let attempt = 0; attempt < 30 && !condition(); ++attempt) await tick(); assert.ok(condition()); };
const downloadCalls = [];
const downloadApp = harness(async (url, options) => { downloadCalls.push({ url, options }); return packCoverage; });
downloadApp.render(); await downloadApp.flush();
const downloadAction = downloadApp.button('Download agent review pack').props.onClick;
downloadAction(); downloadAction();
await waitUntil(() => downloadApp.downloads.length === 1);
assert.equal(downloadApp.downloads[0].name, 'sarvam-review-DEMO_INSTRUMENT-v1.json');
assert.equal(downloadApp.blobs[0].type, 'application/json');
assert.equal(JSON.parse(await downloadApp.blobs[0].text()).questions[0].questionText, packCoverage.questions[0].text);
assert.equal(downloadApp.revoked.length, 1, 'Local object URLs are cleaned up');
assert.equal(downloadCalls.length, 1, 'Export uses verified current coverage, with no additional API request or provider action');
assert.ok(downloadApp.body().includes('No provider update or call was performed'));

for (const changes of [{ locked: true, usedByIterations: 2 }, { metadataWritable: false }]) {
  const lockedApp = harness(async () => fixture('instrument', changes));
  lockedApp.render(); await lockedApp.flush();
  assert.equal(lockedApp.button('Define reporting outputs'), undefined);
  assert.equal(lockedApp.button('Download agent review pack').props.disabled, false, 'Frozen/read-only catalogue may be reviewed without being edited');
  assert.equal(lockedApp.button('Use development priorities preset'), undefined);
}
const packWait = deferred();
const exportRace = harness(async (url) => fixture(url.includes('/instrument/') ? 'instrument' : 'new-instrument'), async (saved) => {
  const prepared = await presets.buildSarvamReviewPack(saved, generatedAt); await packWait.promise; return prepared;
});
exportRace.render(); await exportRace.flush();
exportRace.button('Download agent review pack').props.onClick();
exportRace.changeId('new-instrument'); await exportRace.flush();
packWait.resolve(); await tick(); await tick();
assert.equal(exportRace.downloads.length, 0, 'A prepared pack from an old instrument cannot download after scope changes');
assert.ok(!exportRace.body().includes('Review pack downloaded'));
const failedDownload = harness(async () => fixture(), async () => { throw new Error('Local digest unavailable'); });
failedDownload.render(); await failedDownload.flush();
failedDownload.button('Download agent review pack').props.onClick(); await tick();
assert.ok(failedDownload.body().includes('Unable to prepare the local review pack'));
assert.equal(failedDownload.downloads.length, 0);
assert.equal(failedDownload.button('Download agent review pack').props.disabled, false);

console.log('Reporting-contract actual-render validation, neutral presets, local fingerprinted review packs, frozen instruments, no provider writes, scope races, reload and accessibility tests passed.');
