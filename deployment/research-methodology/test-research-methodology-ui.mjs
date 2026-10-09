import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../../src/app/enterprise-dashboard/page.tsx', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('type DesignForm ='), source.indexOf('export default function EnterpriseDashboardPage'));
const compiled = ts.transpileModule(`${code}\nexport { ResearchDesignRegistry };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const states = [];
let cursor = 0;
function useState(initial) {
  const index = cursor++;
  if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
  return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
}
const iteration = {
  campaignId: 'campaign', campaignName: 'Demo Campaign', iterationId: 'iteration', iterationNumber: 1,
  iterationName: 'Iteration 1', targetPopulation: 'Not declared', sampleFrameName: '',
  samplingMethod: 'DIRECTIONAL_NON_PROBABILITY', selectionMethod: 'REPEATED_CROSS_SECTION',
  weightingStatus: 'NOT_CONFIGURED', weightingMethod: '', weightingVariables: [],
  cohortDesign: 'NOT_DECLARED', fieldworkMode: 'AI_ASSISTED_OUTBOUND_VOICE',
  methodologyNotes: 'Migration default', revision: 0, declaredAt: null, declaredByUserId: null,
  declarationComplete: false, questionContentRecorded: false, frozenQuestionCount: 0,
  comparisonStatus: 'BASELINE', comparisonReasons: ['Actual methodology is undeclared']
};
let data = { researchDesigns: [iteration] };
let historyResolver, historyPromise;
const requests = [];
const apiFetch = async (url, options) => {
  if (url.endsWith('/history')) {
    historyPromise = new Promise((resolve) => { historyResolver = resolve; });
    return historyPromise;
  }
  const body = JSON.parse(options.body);
  requests.push({ url, body });
  return {
    ...iteration, ...body, revision: body.expectedRevision + 1,
    declaredAt: '2026-10-08T10:00:00Z', declaredByUserId: 'actor', declarationComplete: true
  };
};
const context = { exports: {}, require, useState, apiFetch,
  styles: new Proxy({}, { get: (_, key) => key }) };
runInNewContext(compiled, context);
const Registry = context.exports.ResearchDesignRegistry;
const props = () => ({ data, onSaved: async () => {}, onBusy: () => {} });
function render() { cursor = 0; return Registry(props()); }
function flatten(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(flatten);
  return [element, ...flatten(element.props?.children)];
}
const find = (tree, test) => flatten(tree).find(test);
const childrenText = (value) => Array.isArray(value) ? value.map(childrenText).join('')
  : value?.props ? childrenText(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const button = (tree, text) => find(tree, (element) => element.type === 'button' && childrenText(element).includes(text));
function setField(placeholder, value) {
  const input = find(render(), (element) => element.props?.placeholder === placeholder);
  assert.ok(input, placeholder);
  input.props.onChange({ target: { value } });
}
function selectWith(optionValue, value = optionValue) {
  const select = find(render(), (element) => element.type === 'select'
    && flatten(element.props.children).some((child) => child.type === 'option' && child.props.value === optionValue));
  assert.ok(select, optionValue);
  select.props.onChange({ target: { value } });
}
const attest = () => find(render(), (element) => element.type === 'input' && element.props.type === 'checkbox').props.onChange({ target: { checked: true } });

assert.equal(button(render(), 'Save audited declaration').props.disabled, true);
assert.equal(find(render(), (element) => element.props?.placeholder === 'How contacts were selected, excluded and retried').props.value, '', 'migration default selection is not treated as actual fieldwork');
assert.equal(find(render(), (element) => element.props?.placeholder === 'Coverage gaps, non-response, recruitment bias, fieldwork evidence').props.value, '', 'migration notes are not confirmations');
setField('Who the findings are intended to describe', 'Consented demo participants');
setField('Actual list or roll extract used, including its date', 'Approved demo list dated 2026-10-08');
setField('How contacts were selected, excluded and retried', 'Invite all approved demo contacts');
setField('Identify the fieldwork record or confirmation supporting these actual methods', 'Fieldwork record verified');
selectWith('CENSUS');
selectWith('SAME_PARTICIPANTS');
selectWith('NOT_REQUIRED');
selectWith('AI_ASSISTED_OUTBOUND_VOICE');
assert.equal(button(render(), 'Save audited declaration').props.disabled, true, 'confirmation is mandatory');
attest();
assert.equal(button(render(), 'Save audited declaration').props.disabled, false);
const load = button(render(), 'View declaration history').props.onClick();
// Event starts the async operation synchronously; Save must not overlap it.
assert.equal(load, undefined);
assert.ok(historyPromise);
assert.equal(button(render(), 'Save audited declaration').props.disabled, true, 'history/save race is blocked');
historyResolver({ revisions: [] });
await historyPromise;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(button(render(), 'Save audited declaration').props.disabled, false);
button(render(), 'Save audited declaration').props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(requests.length, 1);
assert.equal(requests[0].body.expectedRevision, 0);
assert.equal(requests[0].body.attested, true);
assert.equal(states[2], 1);
assert.equal(states[3], false, 'confirmation resets after a save');

// Simulate another Admin saving revision 2, followed by the page Refresh action.
data = { researchDesigns: [{ ...iteration, targetPopulation: 'Verified current population', sampleFrameName: 'Current frame',
  samplingMethod: 'CENSUS', selectionMethod: 'Invite all approved contacts', cohortDesign: 'SAME_PARTICIPANTS',
  weightingStatus: 'NOT_REQUIRED', revision: 2, declaredAt: '2026-10-08T10:01:00Z', declarationComplete: true }] };
assert.ok(childrenText(render()).includes('revision 2 is now saved'));
assert.equal(button(render(), 'Save audited declaration').props.disabled, true);
button(render(), 'Reload selected declaration').props.onClick();
assert.equal(states[2], 2, 'explicit reload recovers from a stale revision');
assert.equal(states[1].targetPopulation, 'Verified current population');
assert.equal(states[1].changeReason, '');
assert.equal(states[3], false);
assert.equal(button(render(), 'Save audited declaration').props.disabled, true, 'reloaded fields still need a fresh reason and confirmation');
console.log('Executable methodology UI required fields, confirmation, revision recovery and busy-state tests passed.');
