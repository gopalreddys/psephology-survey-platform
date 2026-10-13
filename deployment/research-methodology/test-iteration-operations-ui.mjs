import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sources = Object.fromEntries(await Promise.all([
  ['setup', '../../src/components/IterationResearchSetup.tsx'],
  ['closeout', '../../src/components/IterationOperationalCloseout.tsx'],
  ['legacy', '../../src/app/iterations/[id]/analysis/page.tsx']
].map(async ([name, path]) => [name, ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText])));
const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
const text = (node) => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const jsx = (type, props, key) => ({ type, props, key });
function harness(name, apiFetch, initialRole = 'ADMIN', initialProps = {}) {
  const slots = [], effects = [], navigation = [];
  let cursor = 0, role = initialRole, props = initialProps, actorId = 'admin', iterationId = 'i1', confirmation = true;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (value) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = callback(); }); } }
  };
  const context = { exports: {}, Error, window: { setTimeout, clearTimeout, confirm: () => confirmation }, require(key) {
    if (key === 'react') return react;
    if (key === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (key === '@/lib/api') return { apiFetch };
    if (key === '@/hooks/useCurrentUser') return { useCurrentUser: () => ({ user: role ? { id: actorId, role: { code: role } } : null }) };
    if (key === 'next/navigation') return { useParams: () => ({ id: iterationId }), useRouter: () => ({ replace: (url) => navigation.push(url) }) };
    if (key.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (key === 'next/link') return { default: 'Link' };
    if (key.startsWith('@/components/')) return { default: key.split('/').at(-1) };
    return require(key);
  } };
  runInNewContext(sources[name], context);
  const render = () => { cursor = 0; return context.exports.default(props); };
  const find = (predicate) => flatten(render()).find(predicate);
  return { render, find, navigation, body: () => text(render()), button: (label) => find((node) => node.type === 'button' && text(node).includes(label)),
    open() { find((node) => node.type === 'details').props.onToggle({ currentTarget: { open: true } }); render(); },
    changeProps(next) { props = { ...props, ...next }; render(); }, changeRole(next, id = actorId) { role = next; actorId = id; render(); },
    changeIteration(next) { iterationId = next; render(); }, setConfirmation(next) { confirmation = next; },
    async flush() { render(); while (effects.length) effects.shift()(); await tick(); await tick(); },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}
const design = (iterationId = 'i1', campaignId = 'c1') => ({ iterationId, campaignId, iterationName: 'Wave', campaignName: 'Demo', iterationNumber: 1, revision: 0 });
const closeout = (extra = {}) => ({ iteration: { id: 'i1', campaign_id: 'c1', status: 'ACTIVE' }, runs: [{ id: 'r1', run_number: 1, status: 'COMPLETED' }], summary: { completedRuns: 1, runCount: 1, callbacksReceived: 10, transcriptsCaptured: 8, retryEligibleVoters: 0 }, readyToComplete: false, blockers: ['Exactly three closed policy Runs are required.'], ...extra });

// Methodology is lazy, role-restricted and locked to this exact operational scope.
for (const role of ['CAMPAIGN_MANAGER', 'CAMPAIGNER', null]) {
  let requests = 0;
  const ui = harness('setup', async () => { requests += 1; }, role, { iterationId: 'i1', campaignId: 'c1' });
  assert.equal(ui.render(), null);
  await ui.flush();
  assert.equal(requests, 0);
  ui.unmount();
}
const setupRequests = [];
const setup = harness('setup', (url) => { const request = deferred(); setupRequests.push({ url, ...request }); return request.promise; }, 'ADMIN', { iterationId: 'i1', campaignId: 'c1' });
await setup.flush();
assert.equal(setupRequests.length, 0, 'closed setup does not load the full portfolio');
setup.open(); await setup.flush();
assert.equal(setupRequests.length, 1);
assert.equal(setupRequests[0].url, '/api/enterprise-dashboard/research-quality');
setupRequests[0].resolve({ researchDesigns: [design(), design('i2', 'c2')] }); await tick();
let editor = setup.find((node) => node.type?.name === 'ResearchDesignEditor');
assert.equal(editor.props.data.researchDesigns.length, 1);
assert.equal(editor.props.data.researchDesigns[0].iterationId, 'i1');
setup.changeProps({ iterationId: 'i2', campaignId: 'c2' });
assert.equal(setup.find((node) => node.type?.name === 'ResearchDesignEditor'), undefined, 'old scope hides synchronously');
await setup.flush();
assert.equal(setupRequests.length, 2);
setupRequests[1].resolve({ researchDesigns: [design('i2', 'wrong-campaign')] }); await tick();
assert.match(setup.body(), /no unique authorized methodology record/);
assert.equal(setup.find((node) => node.type?.name === 'ResearchDesignEditor'), undefined);
setup.button('Retry research setup').props.onClick(); await tick();
setupRequests[2].resolve({ researchDesigns: [design('i2', 'c2'), design('i2', 'c2')] }); await tick();
assert.match(setup.body(), /no unique authorized methodology record/, 'ambiguous duplicates fail closed');
setup.button('Retry research setup').props.onClick(); await tick();
setup.changeRole('ADMIN', 'other-admin'); await setup.flush();
setupRequests[4].resolve({ researchDesigns: [design('i2', 'c2')] }); await tick();
setupRequests[3].resolve({ researchDesigns: [{ ...design('i2', 'c2'), revision: 99 }] }); await tick();
editor = setup.find((node) => node.type?.name === 'ResearchDesignEditor');
assert.equal(editor.key, JSON.stringify(['other-admin', 'i2', 'c2']));
assert.equal(editor.props.data.researchDesigns[0].revision, 0, 'old actor response cannot overwrite the current declaration');
setup.changeRole('CAMPAIGN_MANAGER');
assert.equal(setup.render(), null);
setup.unmount();

// Completion moved to operations. Other roles cannot even display a mutation control.
for (const role of ['SUPER_ADMIN', 'ADMIN', 'CAMPAIGNER', null]) {
  let requests = 0;
  const ui = harness('closeout', async () => { requests += 1; }, role, { iterationId: 'i1', campaignId: 'c1', refreshKey: '', onCompleted: async () => {} });
  assert.equal(ui.render(), null); await ui.flush(); assert.equal(requests, 0); ui.unmount();
}
const closeoutRequests = [];
let completedCallbacks = 0;
const operations = harness('closeout', (url, options) => { const request = deferred(); closeoutRequests.push({ url, options, ...request }); return request.promise; }, 'CAMPAIGN_MANAGER', { iterationId: 'i1', campaignId: 'c1', refreshKey: '', onCompleted: async () => { completedCallbacks += 1; } });
await operations.flush();
assert.equal(closeoutRequests.length, 1);
closeoutRequests[0].resolve(closeout()); await tick();
assert.equal(operations.button('Complete Iteration').props.disabled, true);
assert.match(operations.body(), /not independently validated interviews/);
operations.changeProps({ refreshKey: 'r1:COMPLETED|r2:SKIPPED|r3:SKIPPED' }); await operations.flush();
closeoutRequests[1].resolve(closeout({ readyToComplete: true, blockers: [], summary: { ...closeout().summary, runCount: 3, completedRuns: 3 } })); await tick();
assert.equal(operations.button('Complete Iteration').props.disabled, false);
operations.setConfirmation(false); operations.button('Complete Iteration').props.onClick(); await tick();
assert.equal(closeoutRequests.length, 2, 'canceling confirmation does not submit');
operations.setConfirmation(true);
const submit = operations.button('Complete Iteration').props.onClick;
submit(); submit(); await tick();
assert.equal(closeoutRequests.length, 3, 'double click cannot issue two completion POSTs');
assert.equal(closeoutRequests[2].options.method, 'POST');
assert.equal(closeoutRequests[2].url, '/api/iterations/i1/complete');
closeoutRequests[2].resolve(closeout({ iteration: { id: 'i1', campaign_id: 'c1', status: 'COMPLETED' }, readyToComplete: true, blockers: [] })); await tick();
assert.equal(operations.button('Complete Iteration'), undefined);
assert.equal(completedCallbacks, 1);
operations.unmount();

const wrongCloseout = harness('closeout', async () => closeout({ iteration: { id: 'i1', campaign_id: 'wrong', status: 'ACTIVE' }, readyToComplete: true }), 'CAMPAIGN_MANAGER', { iterationId: 'i1', campaignId: 'c1', refreshKey: '', onCompleted: async () => {} });
await wrongCloseout.flush();
assert.match(wrongCloseout.find((node) => node.type === 'FeedbackMessage').props.message, /does not match this Iteration and Campaign/);
assert.equal(wrongCloseout.button('Complete Iteration').props.disabled, true);
wrongCloseout.unmount();

// Compatibility bookmarks resolve only after the authenticated navigation boundary responds.
for (const role of ['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER', 'CAMPAIGNER']) {
  const requests = [];
  const legacy = harness('legacy', async (url) => { requests.push(url); return { iterationId: 'i1', campaignId: 'c1' }; }, role);
  await legacy.flush();
  assert.equal(requests[0], '/api/iterations/i1/navigation');
  assert.equal(legacy.navigation[0], role === 'CAMPAIGNER' ? '/iterations/i1' : '/analytics/campaigns/c1?iterationId=i1');
  assert.equal(requests.length, 1, 'legacy bookmarks do not run a duplicate analysis or closeout');
  legacy.unmount();
}
const invalidLegacy = harness('legacy', async () => ({ iterationId: 'other', campaignId: 'c1' }), 'ADMIN');
await invalidLegacy.flush(); assert.equal(invalidLegacy.navigation.length, 0); assert.match(invalidLegacy.find((node) => node.type === 'FeedbackMessage').props.message, /does not match this Iteration/); invalidLegacy.unmount();
console.log('Iteration setup lazy loading, role/scope/race checks, governed completion controls and legacy navigation tests passed.');
