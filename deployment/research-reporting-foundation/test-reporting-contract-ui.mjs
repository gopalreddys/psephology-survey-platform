import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../../src/components/QuestionnaireReportingContracts.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../src/app/questionnaires/[id]/page.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../../src/components/questionnaire-reporting-contracts.module.css', import.meta.url), 'utf8');
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

function harness(apiFetch) {
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
  const context = { exports: {}, Error, require: (id) => id === 'react' ? react
    : id === '@/lib/api' ? { apiFetch }
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
    render, find, button, field,
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
console.log('Reporting-contract actual-render validation, frozen instruments, no false provider verification, GET/PATCH races, failed reload and accessibility tests passed.');
