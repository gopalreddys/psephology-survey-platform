import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(new URL("../../package.json", import.meta.url));
const ts = require("typescript");
const source = await readFile(new URL("../../src/app/analytics/campaigns/[id]/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
} }).outputText;

// Execute the actual page with controlled hooks/timers/network. This harness
// verifies async scope behavior without a browser, network or new dependencies.
const slots = [];
let cursor = 0;
let effects = [];
let timers = [];
const requests = [];
const user = { id: "admin", role_code: "ADMIN" };
const equalDeps = (left, right) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));
const hooks = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useCallback(callback, deps) {
    const index = cursor++;
    if (!equalDeps(slots[index]?.deps, deps)) slots[index] = { deps, callback };
    return slots[index].callback;
  },
  useEffect(callback, deps) {
    const index = cursor++;
    if (!equalDeps(slots[index]?.deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: callback() };
    });
  }
};
const jsx = (type, props) => ({ type, props });
const imports = {
  react: hooks,
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  "next/link": { __esModule: true, default: "Link" },
  "next/navigation": { useParams: () => ({ id: "campaign" }), useRouter: () => ({ push() {} }) },
  "@/components/AppShell": { __esModule: true, default: "AppShell" },
  "@/components/FeedbackMessage": { __esModule: true, default: "FeedbackMessage" },
  "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user }) },
  "@/lib/api": { apiFetch(url) {
    if (url === "/api/analytics") return Promise.resolve({ campaigns: [{ id: "campaign", name: "Fixture", code: "TEST" }] });
    return new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
  } }
};
const pageModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: pageModule, exports: pageModule.exports,
  require(id) {
    if (id === "lucide-react") return new Proxy({}, { get: (_, key) => key });
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (!(id in imports)) throw new Error(`Unexpected page import: ${id}`);
    return imports[id];
  },
  window: {
    location: { search: "?iterationId=i2&gender=Female" },
    setTimeout(callback) { const timer = { callback, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.active = false; }
  },
  console, URLSearchParams
});

function render() {
  cursor = 0;
  const tree = pageModule.exports.default();
  const pendingEffects = effects;
  effects = [];
  return { tree, commit: () => pendingEffects.forEach((effect) => effect()) };
}
function flushTimers() {
  const pending = timers;
  timers = [];
  pending.filter((timer) => timer.active).forEach((timer) => timer.callback());
}
function walk(node, predicate) {
  if (!node) return null;
  if (Array.isArray(node)) return node.map((child) => walk(child, predicate)).find(Boolean) || null;
  if (typeof node !== "object") return null;
  return predicate(node) ? node : walk(node.props?.children, predicate);
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (node && typeof node === "object") return text(node.props?.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function payload(name, gender) {
  return {
    campaign: { id: "campaign", name, code: "TEST", targetName: "Fixture", surveyStage: "PULSE" },
    scope: { iteration: { id: "i2", number: 2 }, run: null, operations: { callAttempts: 20, connectedCalls: 12, responseCoveragePct: 100 }, interpretation: "Iteration-wide" },
    options: { iterations: [{ id: "i2", number: 2, name: "Wave 2", runs: [{ id: "run-a", number: 1, status: "COMPLETED" }] }], filters: { genders: ["Female", "Male"], ageBands: [], mandals: [] } },
    segment: { filters: { gender, ageBand: null, mandal: null }, respondentBase: 6, minimumBase: 5, suppressed: false },
    validity: { latestRespondentBase: 6, warnings: [] }, latestIteration: { id: "i2", number: 2 }, comparison: null,
    issueAnalysis: { priorities: [] },
    iterationDashboard: { partyAttention: [], candidateSentiment: [], perceivedIssueLeadership: [], incumbentSentiment: [] },
    findings: []
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

let view = render(); view.commit(); flushTimers();
view = render(); view.commit(); flushTimers();
assert.equal(requests.length, 1, "URL scope is initialized before the first insight request");
assert.match(requests[0].url, /iterationId=i2/);
assert.match(requests[0].url, /gender=Female/);
requests[0].resolve(payload("Initial Female evidence", "Female"));
await settle();
view = render(); view.commit();
const genderLabel = walk(view.tree, (node) => node.type === "label" && text(node).startsWith("Gender"));
const changeGender = walk(genderLabel, (node) => node.type === "select").props.onChange;

changeGender({ target: { value: "Male" } });
view = render();
assert.doesNotMatch(text(view.tree), /Initial Female evidence/, "old insights are hidden immediately after changing a filter");
view.commit(); flushTimers();
assert.equal(requests.length, 2);
changeGender({ target: { value: "Female" } });
view = render(); view.commit(); flushTimers();
assert.equal(requests.length, 3);
requests[2].resolve(payload("Current Female evidence", "Female"));
await settle();
requests[1].resolve(payload("Stale Male evidence", "Male"));
await settle();
view = render(); view.commit();
assert.match(text(view.tree), /Current Female evidence/);
assert.doesNotMatch(text(view.tree), /Stale Male evidence/, "a slower prior request cannot overwrite the current scope");

changeGender({ target: { value: "Male" } });
view = render(); view.commit(); flushTimers();
changeGender({ target: { value: "Female" } });
view = render(); view.commit(); flushTimers();
requests[4].resolve(payload("Current scope after retry", "Female"));
await settle();
requests[3].reject(new Error("Stale scope failure"));
await settle();
view = render(); view.commit();
assert.match(text(view.tree), /Current scope after retry/);
assert.equal(walk(view.tree, (node) => node.type === "FeedbackMessage"), null, "stale request errors do not replace the current evidence");

const runLabel = walk(view.tree, (node) => node.type === "label" && text(node).startsWith("Run · operations only"));
walk(runLabel, (node) => node.type === "select").props.onChange({ target: { value: "run-a" } });
view = render(); view.commit(); flushTimers();
assert.match(requests[5].url, /runId=run-a/);
assert.match(requests[5].url, /gender=Female/, "Run selection preserves the active cohort filter");
const suppressed = payload("Small cohort operations", "Female");
suppressed.segment.suppressed = true;
suppressed.segment.respondentBase = null;
requests[5].resolve(suppressed);
await settle();
view = render(); view.commit();
assert.ok(walk(view.tree, (node) => node.props?.["aria-label"] === "Selected operational scope"), "operations remain visible when research insights are suppressed");
assert.match(text(view.tree), /Segment results withheld/);
console.log("Analytics UI request ordering, scope and suppression behavior tests passed.");
