import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Exercise the actual AppShell auth gate and actual Quick page with a small
// component-lifecycle runner. Amplify, hooks and AWS requests are synthetic;
// no real auth tokens, users, dashboards or survey data are loaded.
const require = createRequire(import.meta.url);
const React = require('react');
const ts = require('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
} }).outputText;
let authStatus = 'authenticated';
let actor = { id: 'super-one', name: 'Synthetic Super Admin', role: { code: 'SUPER_ADMIN', name: 'Super Admin' } };
let scope, apiCalls = 0, cleanups = 0;
const instances = new Map();
const react = {
  ...React,
  useState(initial) {
    const index = scope.cursor++;
    if (!(index in scope.slots)) scope.slots[index] = typeof initial === 'function' ? initial() : initial;
    const owner = scope;
    return [scope.slots[index], (next) => { owner.slots[index] = typeof next === 'function' ? next(owner.slots[index]) : next; }];
  },
  useRef(initial) {
    const index = scope.cursor++;
    return scope.slots[index] ||= { current: initial };
  },
  useCallback(callback) { scope.cursor++; return callback; },
  useEffect(callback) {
    const index = scope.cursor++;
    if (!(index in scope.slots)) scope.slots[index] = { cleanup: callback() };
  }
};
const useCurrentUser = () => {
  // Matches the existing once-per-mount profile hook; changing actor globally
  // does not update an already-mounted profile, so a missing auth boundary fails.
  const [snapshot] = react.useState(actor);
  return { user: snapshot, loading: false, error: null };
};
const wrap = (value) => ({ __esModule: true, default: value });
const Icon = () => null;
const sharedMocks = {
  react,
  'lucide-react': new Proxy({}, { get: () => Icon }),
  'next/link': wrap(({ children, ...props }) => React.createElement('a', props, children)),
  'next/navigation': { usePathname: () => '/enterprise-dashboard' },
  '@aws-amplify/ui-react': { useAuthenticator: () => ({ authStatus, signOut: () => {} }), Authenticator: () => React.createElement('div', null, 'Synthetic login') },
  '@aws-amplify/ui-react/styles.css': {},
  '@/hooks/useCurrentUser': { useCurrentUser },
  '@/lib/api': { apiFetch: () => { apiCalls++; throw new Error('No live requests in auth-boundary test'); } }
};
const shellContext = { exports: {}, require: (name) => sharedMocks[name] ?? require(name) };
runInNewContext(compile(await readFile(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8')), shellContext);
const mocks = { ...sharedMocks,
  '@/components/AppShell': wrap(shellContext.exports.default),
  '@/components/FeedbackMessage': wrap(({ message }) => React.createElement('div', { role: 'alert' }, message)),
  './QuickDashboardEmbed': wrap(({ embedUrl }) => React.createElement('div', { 'data-test-session': embedUrl })),
  './TelanganaBoundaryMap': wrap(() => null),
  './quick.module.css': wrap(new Proxy({}, { get: (_, key) => String(key) }))
};
const pageContext = { exports: {}, AbortController, URLSearchParams,
  window: { setTimeout: () => 1, clearTimeout: () => { cleanups++; } },
  require: (name) => mocks[name] ?? require(name) };
runInNewContext(compile(await readFile(new URL('../../src/app/enterprise-dashboard/page.tsx', import.meta.url), 'utf8')), pageContext);
function render() {
  const seen = new Set();
  function visit(element, path) {
    if (Array.isArray(element)) return element.map((item, index) => visit(item, `${path}/${index}`));
    if (!element?.props) return element;
    if (typeof element.type === 'function') {
      const key = `${path}:${element.type.name}`;
      seen.add(key);
      const parent = scope;
      scope = instances.get(key) || { slots: [], cursor: 0 };
      instances.set(key, scope); scope.cursor = 0;
      const output = element.type(element.props);
      scope = parent;
      return visit(output, key);
    }
    return { type: element.type, props: { ...element.props, children: visit(element.props.children, `${path}/children`) } };
  }
  const tree = visit(React.createElement(pageContext.exports.default), 'page');
  for (const [key, instance] of instances) if (!seen.has(key)) {
    instance.slots.forEach((slot) => slot?.cleanup?.()); instances.delete(key);
  }
  return tree;
}
const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten)
  : value?.props ? [value, ...flatten(value.props.children)] : [];
const reportInstance = () => [...instances].find(([key]) => key.endsWith(':AuthenticatedEnterpriseDashboard'))?.[1];
const session = (tree) => flatten(tree).find((node) => node.props['data-test-session'])?.props['data-test-session'];
render();
const first = reportInstance();
assert.ok(first, 'authenticated report is mounted below the real AppShell');
// Profile snapshot is hook slot 0; report data and loaded actor are slots 1/6.
first.slots[1] = { embedUrl: 'synthetic-super-session', accessScope: 'SUPER_ADMIN_PORTFOLIO' };
first.slots[3] = false;
first.slots[6] = actor.id;
assert.equal(session(render()), 'synthetic-super-session');
authStatus = 'unauthenticated';
assert.equal(session(render()), undefined);
assert.equal(reportInstance(), undefined, 'logout unmounts report/profile/session state rather than just hiding an iframe');
assert.ok(cleanups > 0, 'pending report effect is cleaned up');
actor = { id: 'admin-two', name: 'Synthetic Admin', role: { code: 'ADMIN', name: 'Admin' } };
authStatus = 'authenticated';
assert.equal(session(render()), undefined, 'new login cannot revive the prior Super Admin URL');
assert.notEqual(reportInstance(), first);
assert.equal(reportInstance().slots[0].id, 'admin-two', 'profile is loaded again for the newly mounted account');
assert.equal(apiCalls, 0);
console.log('Actual AppShell/Quick auth boundary: logout cleanup and different-account re-login discard old profile, report and session state.');
