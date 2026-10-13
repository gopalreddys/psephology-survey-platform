import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Render the real client Dashboard with synthetic data. Effects and requests are
// deliberately disabled: this test cannot load users, voters or a live report.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = await readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { ReportNote, BaseCaption, SegmentNote };`, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true
  }
}).outputText;
const styles = new Proxy({}, { get: (_, key) => `regularDashboardFixture_${String(key)}` });
let currentUser;
let hookStates = [];
let hookCursor = 0;
let apiCalls = 0;
function useState(initial) {
  const index = hookCursor++;
  if (!(index in hookStates)) hookStates[index] = typeof initial === 'function' ? initial() : initial;
  return [hookStates[index], (next) => {
    hookStates[index] = typeof next === 'function' ? next(hookStates[index]) : next;
  }];
}
const defaultModule = (value) => ({ __esModule: true, default: value });
const Icon = ({ size = 16, className, ...props }) => React.createElement('svg', {
  ...props, className, width: size, height: size, 'aria-hidden': true
});
const mocks = {
  react: { ...React, useState, useRef: (current) => ({ current }), useCallback: (callback) => callback, useEffect: () => {} },
  'lucide-react': new Proxy({}, { get: () => Icon }),
  'next/link': defaultModule(({ children, ...props }) => React.createElement('a', props, children)),
  '@/components/AppShell': defaultModule(({ children }) => React.createElement('div', { className: 'fixtureAppShell' }, children)),
  '@/components/FeedbackMessage': defaultModule(({ message, tone }) => React.createElement('div', {
    role: 'alert', 'data-feedback-tone': tone
  }, message)),
  '@/hooks/useCurrentUser': { useCurrentUser: () => ({ user: currentUser }) },
  '@/lib/api': { apiFetch: () => { apiCalls++; throw new Error('Live API calls are prohibited in this local fixture'); } },
  './dashboard.module.css': defaultModule(styles)
};
const context = { exports: {}, URLSearchParams, require: (name) => name in mocks ? mocks[name] : require(name) };
runInNewContext(compiled, context);
const { default: Home, ReportNote, BaseCaption, SegmentNote } = context.exports;

const measure = (overrides = {}) => ({
  respondentBase: 10, answerBase: 8, missingCount: 2, cantSayCount: 1,
  refusedCount: 1, uncodedCount: 1, coveragePct: 80, suppressed: false,
  normalizationVersion: 'synthetic-v1', ...overrides
});
const segment = (label, overrides = {}) => ({
  label, base: 8, suppressed: false, ...measure(),
  sentiment: [{ value: 'Positive', respondents: 0, percentage: 0 }],
  positivePct: 0, ...overrides
});
const distribution = [
  { value: 'Positive', respondents: 0, percentage: 0 },
  { value: 'Neutral', respondents: 3, percentage: 37.5 },
  { value: 'Negative', respondents: 1, percentage: 12.5 },
  { value: 'Mixed', respondents: 1, percentage: 12.5 },
  { value: "Can't say", respondents: 1, percentage: 12.5 },
  { value: 'Declined to answer', respondents: 1, percentage: 12.5 },
  { value: 'Uncoded response', respondents: 1, percentage: 12.5 }
];
const intelligence = {
  programs: [{ id: 'synthetic-program', name: 'Synthetic research program', code: 'SYNTHETIC' }],
  program: { id: 'synthetic-program', name: 'Synthetic research program', code: 'SYNTHETIC' },
  campaign: null, iteration: null,
  filters: {
    campaigns: [{ id: 'synthetic-campaign', name: 'Synthetic campaign', code: 'SYNTHETIC-C' }],
    iterations: [{ id: 'synthetic-iteration', number: 1, name: 'Synthetic iteration', campaignName: 'Synthetic campaign' }],
    mandals: ['Synthetic Mandal'], genders: ['Female', 'Male', 'Not recorded'],
    ageBands: ['18–29', '30–39', '40–49', '50+'],
    selectedProgramId: 'synthetic-program', selectedCampaignId: '', selectedIterationId: '',
    selectedMandal: '', selectedGender: '', selectedAgeBand: '',
    sentimentConstructs: [
      { key: 'candidate_impression', label: 'Candidate impression' },
      { key: 'incumbent_assessment', label: 'Incumbent assessment' }
    ], selectedSentimentConstruct: 'candidate_impression'
  },
  minimumBase: 5, respondentBase: 10, suppressed: false,
  scopeLabel: 'Synthetic Program · all Campaigns · all Iterations · all Runs',
  sentimentConstruct: { key: 'candidate_impression', label: 'Candidate impression', outputKeys: ['SYNTHETIC_CANDIDATE_IMPRESSION'], type: 'SENTIMENT' },
  sentimentValidation: {
    status: 'HUMAN_REVIEW_PENDING', method: 'EXPLICIT_LABELS', normalizationVersion: 'synthetic-v1',
    ruleHash: 'synthetic-rule-hash', message: 'Synthetic validation explanation retained for review'
  },
  rating: { value: null, scale: 5, confidence: 'Limited evidence', basis: 'Synthetic score calculation explanation', answeredBase: 0 },
  measures: {
    sentiment: measure(), issues: measure(), candidate: measure(), leadership: measure(),
    party: measure({ answerBase: 3, missingCount: 7, coveragePct: 30, suppressed: true })
  },
  sentiment: distribution, issues: [{ value: 'Synthetic employment priority', respondents: 8, percentage: 100 }],
  landscape: {
    party: [{ value: 'BRS', respondents: 2, percentage: null }, { value: 'BJP', respondents: 1, percentage: null }],
    candidate: distribution, leadership: [{ value: 'Synthetic recorded leadership response', respondents: 8, percentage: 100 }]
  },
  age: [segment('18–29'), segment('30–39', { answerBase: 3, respondentBase: 5, missingCount: 2, coveragePct: 60, suppressed: true, positivePct: null })],
  gender: [segment('Female')],
  mandalHeatmap: [segment('Synthetic Mandal'), segment('Sparse synthetic Mandal', {
    answerBase: 3, respondentBase: 4, coveragePct: 75, missingCount: 1, suppressed: true, positivePct: null,
    sentiment: [{ value: 'Positive', respondents: 3, percentage: null }]
  })],
  predictive: {
    status: 'NOT_COMPARABLE', direction: 'History needs comparable evidence', confidence: 'Limited',
    statement: 'Synthetic history calculation explanation', scopeLabel: 'Full Iterations · all Runs', projectedNextRating: null,
    points: [{ iterationId: 'synthetic-iteration', iterationNumber: 1, iterationName: 'Synthetic iteration', campaignName: 'Synthetic campaign', base: 10, answeredBase: 8, value: 3.5 }],
    comparability: {
      source: 'SYNTHETIC', reasons: ['Synthetic recorded questionnaire mismatch'], comparisons: [],
      includedIterations: 1, excludedIterations: 1, questionnaireCode: 'SYNTHETIC_QUESTIONNAIRE',
      questionnaireVersion: '1', researchPhase: 'SYNTHETIC', sampleDesign: 'SYNTHETIC'
    }
  },
  methodology: { sampleType: 'Synthetic convenience fixture', weighted: false, analysisUnit: 'Synthetic respondent observations', disclosure: 'Synthetic methodology explanation' }
};
const fixtureVariants = ['default', 'sparse', 'populated', 'withheld-partitions'];
function fixtureIntelligence(variant) {
  if (variant === 'default') return intelligence;
  if (variant === 'withheld-partitions') {
    const withheld = measure({ respondentBase: null, answerBase: null, missingCount: null,
      cantSayCount: null, refusedCount: null, uncodedCount: null, coveragePct: null, suppressed: true });
    return { ...intelligence,
      rating: { ...intelligence.rating, value: null, answeredBase: null },
      measures: Object.fromEntries(Object.keys(intelligence.measures).map((key) => [key, withheld])),
      sentiment: [], issues: [], landscape: { party: [], candidate: [], leadership: [] },
      age: [segment('18–29', { ...withheld, base: null, positivePct: null, sentiment: [] })],
      gender: [], mandalHeatmap: [], predictive: { ...intelligence.predictive, points: [] }
    };
  }
  if (variant === 'sparse') return {
    ...intelligence,
    rating: { ...intelligence.rating, value: null, answeredBase: 0 },
    measures: Object.fromEntries(Object.keys(intelligence.measures).map((key) => [key, measure({
      answerBase: 0, missingCount: 10, cantSayCount: 0, refusedCount: 0,
      uncodedCount: 0, coveragePct: 0, suppressed: true
    })])),
    sentiment: [], issues: [], landscape: { party: [], candidate: [], leadership: [] },
    age: [], gender: [], mandalHeatmap: [],
    predictive: { ...intelligence.predictive, points: [], projectedNextRating: null }
  };
  return {
    ...intelligence,
    sentimentConstruct: {
      ...intelligence.sentimentConstruct,
      label: 'Synthetic candidate impression and recorded expectations for accountable public service'
    },
    rating: { ...intelligence.rating, value: 3.5, answeredBase: 8 },
    issues: [
      'Synthetic opportunities for accessible employment and vocational learning',
      'Synthetic improvements to transport connectivity and road maintenance',
      'Synthetic public health access and continuity of essential services',
      'Synthetic reliable utilities and transparent infrastructure planning',
      'Synthetic education access and local skills development opportunities',
      'Synthetic timely grievance handling and accountable public administration'
    ].map((value) => ({ value, respondents: 1, percentage: 12.5 })),
    landscape: {
      ...intelligence.landscape,
      party: [
        { value: 'Synthetic party A', respondents: 3, percentage: 37.5 },
        { value: 'Synthetic party B', respondents: 2, percentage: 25 },
        { value: 'Synthetic party C', respondents: 1, percentage: 12.5 },
        { value: 'Synthetic independent response', respondents: 1, percentage: 12.5 },
        { value: "Can't say", respondents: 1, percentage: 12.5 }
      ],
      leadership: [{ value: 'Synthetic recorded leadership response with a deliberately long descriptive label', respondents: 8, percentage: 100 }]
    },
    measures: { ...intelligence.measures, party: measure() },
    age: ['18–29', '30–39', '40–49', '50+'].map((label) => segment(label)),
    gender: ['Female', 'Male', 'Not recorded'].map((label) => segment(label)),
    predictive: {
      ...intelligence.predictive, status: 'INDICATIVE', direction: 'Synthetic comparable descriptive history',
      projectedNextRating: 3.2,
      points: [1, 2, 3].map((number) => ({
        iterationId: `synthetic-iteration-${number}`, iterationNumber: number,
        iterationName: `Synthetic iteration ${number}`,
        campaignName: 'Synthetic campaign with a deliberately long research label',
        base: 10, answeredBase: 8, value: number + 1
      }))
    }
  };
}
const summary = {
  campaignsVisible: 1, campaignsCompleted: 0, campaignsWithoutManager: 0,
  iterationsVisible: 3, iterationsCompleted: 1, runsReady: 1, runsRunning: 0, runsClosed: 3,
  pendingContacts: 2, retryEligibleContacts: 1, successfulContacts: 8,
  callAttempts: 12, awaitingCallbacks: 1, staleCallbacks: 1,
  connectedCalls: 10, missingTranscripts: 1, missingResponses: 0
};
function dashboard(role, overrides = {}) {
  return {
    role, summary,
    roleBrief: {
      eyebrow: 'SYNTHETIC ROLE BRIEF', title: 'Synthetic role work', status: 'IN_PROGRESS',
      description: 'Synthetic role explanation', responsibility: 'Synthetic responsibility explanation',
      boundary: 'Synthetic role boundary explanation', nextHref: '/campaigns', nextLabel: 'Review visible work'
    },
    actions: [{ kind: 'STALE_CALLBACKS', priority: 90, title: 'Synthetic callback needs attention',
      detail: 'Synthetic operational action remains visible', href: '/calls', campaignName: 'Synthetic campaign' }],
    campaigns: [{
      id: 'synthetic-campaign', name: 'Synthetic campaign', code: 'SYNTHETIC-C', status: 'ACTIVE',
      managerAssigned: true, iterationCount: 3, completedIterationCount: 1, activeRunCount: 1,
      callAttempts: 12, connectedCalls: 10, successfulContacts: 8, evidenceExceptions: 1,
      connectionRatePct: 83.3, evidenceReadyPct: 95,
      iterations: [{ id: 'synthetic-iteration', number: 1, name: 'Synthetic iteration', status: 'COMPLETED', runCount: 3, readyRunCount: 0, runningRunCount: 0 }]
    }],
    intelligence, generatedAt: '2026-10-11T08:00:00.000Z', ...overrides
  };
}

function resolve(element) {
  if (Array.isArray(element)) return element.map((child, index) => {
    const resolved = resolve(child);
    return React.isValidElement(resolved) && resolved.key === null
      ? React.cloneElement(resolved, { key: `fixture-child-${index}` }) : resolved;
  });
  if (!element || typeof element !== 'object') return element;
  if (typeof element.type === 'function') return resolve(element.type(element.props));
  if (element.type === React.Fragment) return resolve(element.props.children);
  const { children, ...props } = element.props;
  return React.createElement(element.type, { ...props, key: element.key }, resolve(children));
}
function render({ role = 'SUPER_ADMIN', data = dashboard(role), loading = false, refreshing = false,
  error = null, filters = ['', '', '', '', '', '', 'candidate_impression'], loadedScope = JSON.stringify(filters) } = {}) {
  currentUser = { id: 'synthetic-user', role: { code: role } };
  hookStates = [data, loading, refreshing, error, ...filters, loadedScope];
  return renderCurrentState();
}
function renderCurrentState() { hookCursor = 0; return resolve(Home()); }
function flatten(element) {
  if (Array.isArray(element)) return element.flatMap(flatten);
  if (!element || typeof element !== 'object') return [];
  return [element, ...flatten(element.props.children)];
}
function textContent(element, visibleOnly = false) {
  if (Array.isArray(element)) return element.map((child) => textContent(child, visibleOnly)).join('');
  if (!element || typeof element !== 'object') return typeof element === 'string' || typeof element === 'number' ? String(element) : '';
  if (visibleOnly && element.type === 'details' && !element.props.open) {
    return textContent(flatten(element.props.children).find((child) => child.type === 'summary'), true);
  }
  return textContent(element.props.children, visibleOnly);
}
const find = (tree, predicate) => flatten(tree).find(predicate);
const hasClass = (element, name) => element.props.className?.split(' ').includes(styles[name]);
const links = (tree) => flatten(tree).filter((element) => element.type === 'a').map((element) => element.props.href);
const selectFor = (tree, label) => {
  const container = find(tree, (element) => element.type === 'label'
    && textContent(element.props.children[0]) === label);
  return container && find(container, (element) => element.type === 'select');
};
function assertClosedDetails(tree) {
  const notes = flatten(tree).filter((element) => element.type === 'details');
  assert.ok(notes.length, 'disclosure notes render');
  for (const note of notes) {
    assert.ok(!note.props.open, 'all disclosure notes start closed');
    const firstChild = flatten(note.props.children)[0];
    assert.equal(firstChild?.type, 'summary', 'summary is the first disclosure child');
    assert.ok(textContent(firstChild).trim(), 'every note has an accessible summary label');
  }
}
function assertReportCardStructure(tree, label) {
  const grids = flatten(tree).filter((element) => hasClass(element, 'reportGrid'));
  assert.equal(grids.length, 1, `${label}: all nine reports share one flat grid`);
  const cards = [grids[0].props.children].flat(Infinity).filter(React.isValidElement);
  assert.equal(cards.length, 9, `${label}: report grid has exactly nine direct cards`);
  assert.equal(flatten(tree).filter((element) => hasClass(element, 'reportCard')).length, 9,
    `${label}: reports are not nested in additional layout cards`);
  for (const [index, card] of cards.entries()) {
    const prefix = `${label}, report ${index + 1}`;
    assert.equal(card.type, 'article', `${prefix}: semantic article`);
    assert.ok(hasClass(card, 'reportCard'), `${prefix}: shared card dimensions class`);
    const sections = [card.props.children].flat(Infinity).filter(React.isValidElement);
    assert.equal(sections.length, 3, `${prefix}: consistent header, body and footer`);
    const [header, body, footer] = sections;
    assert.equal(header.type, 'header');
    assert.ok(hasClass(header, 'chartHead'));
    const heading = [header.props.children].flat(Infinity).filter(React.isValidElement);
    assert.deepEqual(heading.map((element) => element.type), ['span', 'h3', 'div'],
      `${prefix}: fixed eyebrow, title and subtitle slots`);
    assert.ok(textContent(heading[0]).trim(), `${prefix}: eyebrow retained`);
    assert.ok(textContent(heading[1]).trim(), `${prefix}: heading retained`);
    assert.ok(hasClass(heading[2], 'chartSubtitle'), `${prefix}: subtitle slot remains even when empty`);
    assert.ok(hasClass(body, 'reportBody'), `${prefix}: chart body uses common layout`);
    assert.equal(footer.type, 'footer');
    assert.ok(hasClass(footer, 'reportFooter'), `${prefix}: measurement uses aligned footer`);
    const disclosures = flatten(card).filter((element) => element.type === 'details');
    const footerDisclosures = flatten(footer).filter((element) => element.type === 'details');
    assert.equal(disclosures.length, 1, `${prefix}: exactly one measurement disclosure`);
    assert.equal(footerDisclosures.length, 1, `${prefix}: disclosure is in footer, not chart body`);
    const disclosureLabel = find(footerDisclosures[0], (element) => element.type === 'summary');
    assert.equal(textContent(disclosureLabel), 'How it’s measured', `${prefix}: consistent measurement label`);
    assertClosedDetails(card);
  }
}

for (const [Component, props] of [
  [ReportNote, { children: 'Synthetic private report calculation' }],
  [BaseCaption, { summary: measure(), children: 'Synthetic private base calculation' }],
  [SegmentNote, { items: [segment('Synthetic segment')], children: 'Synthetic private segment calculation' }]
]) {
  const tree = resolve(Component(props));
  assertClosedDetails(tree);
  assert.doesNotMatch(textContent(tree, true), /Synthetic private/);
  assert.match(textContent(tree), /Synthetic private/, 'measurement explanation is retained');
}
const baseTree = resolve(BaseCaption({ summary: measure(), children: 'Synthetic base detail' }));
assert.match(textContent(baseTree, true), /8 answered \/ 10 respondents · 80\.0% coverage/);
assert.doesNotMatch(textContent(baseTree, true), /Coverage =|Missing 2|not counted as negative/);
assert.match(textContent(baseTree), /Missing 2 · Can't say 1 · Refused 1 · Uncoded 1/);
const sparseBase = resolve(BaseCaption({ summary: measure({ answerBase: 3, coveragePct: 30, suppressed: true }), children: 'Synthetic sparse base detail' }));
assert.match(textContent(sparseBase, true), /3 answered \/ 10 respondents · 30\.0% coverage · Withheld/);
assert.match(textContent(sparseBase), /answer partition and linked totals are withheld/);
const segmentTree = resolve(SegmentNote({ items: [segment('Synthetic segment')], children: 'Synthetic segment explanation' }));
const table = find(segmentTree, (element) => element.type === 'table');
assert.ok(table, 'segment denominator details remain available on demand');
assert.match(textContent(table), /Answer coverage by segment/);
assert.match(textContent(table), /8 \/ 10/);
assert.match(textContent(table), /80\.0%/);
assert.equal(find(table, (element) => element.type === 'th' && textContent(element) === 'Synthetic segment')?.props.scope, 'row');

const titles = {
  SUPER_ADMIN: 'Platform overview', ADMIN: 'Campaign administration',
  CAMPAIGN_MANAGER: 'Campaign command center', CAMPAIGNER: 'My survey work'
};
for (const role of Object.keys(titles)) {
  const tree = render({ role });
  const visible = textContent(tree, true);
  const allText = textContent(tree);
  assertClosedDetails(tree);
  assert.match(visible, new RegExp(titles[role]), `${role} retains its Dashboard title`);
  assert.match(visible, /Role-visible portfolio · operational totals/);
  assert.match(visible, /IN PROGRESS/);
  assert.match(visible, /Synthetic callback needs attention/);
  assert.match(visible, /Synthetic operational action remains visible/);
  assert.match(visible, /1\/3 Iterations complete/);
  assert.match(visible, /95\.0%/);
  assert.match(visible, /83\.3% attempt-to-connection rate/);
  assert.match(visible, /COMPLETED · 0 ready · 0 running/);
  for (const explanation of ['Synthetic role explanation', 'Synthetic responsibility explanation', 'Synthetic role boundary explanation', 'Counts use role-visible records', 'Campaign connection rate =']) {
    assert.ok(!visible.includes(explanation), `${role}: ${explanation} is initially hidden`);
    assert.ok(allText.includes(explanation), `${role}: ${explanation} is retained in its note`);
  }
  const privileged = role === 'SUPER_ADMIN' || role === 'ADMIN';
  assert.equal(links(tree).includes('/enterprise-dashboard'), privileged, `${role}: Amazon Quick link guard is retained`);
  assert.equal(links(tree).includes('/programs'), privileged, `${role}: Programs link guard is retained`);
  assert.equal(links(tree).includes('/analytics'), role !== 'CAMPAIGNER', `${role}: Analytics link guard is retained`);
  assert.ok(links(tree).includes('/calls') && links(tree).includes('/campaigns'));
  assert.equal(Boolean(find(tree, (element) => hasClass(element, 'intelligencePanel'))), role !== 'CAMPAIGNER');
  if (role === 'CAMPAIGNER') {
    assert.doesNotMatch(allText, /PROGRAM RESEARCH DASHBOARD|Synthetic score calculation|MANDAL HEATMAP|Research method/,
      'Campaigner never receives the research content, including hidden content');
    assert.equal(flatten(tree).filter((element) => element.type === 'select').length, 0);
    assert.ok(!find(tree, (element) => hasClass(element, 'reportGrid') || hasClass(element, 'reportCard')),
      'Campaigner never renders research report cards');
    continue;
  }
  assertReportCardStructure(tree, role);
  for (const label of ['Synthetic Program · all Campaigns · all Iterations · all Runs', 'Demo · Unweighted · Human review pending', 'Not measured', 'Projection unavailable', 'Full Iterations · all Runs', '8 answered / 10 respondents', '0.0% positive', 'Withheld', 'Recorded mentions · not vote intention']) {
    assert.ok(visible.includes(label), `${role}: ${label} remains visible`);
  }
  assert.doesNotMatch(visible, /synthetic-rule-hash|SYNTHETIC_CANDIDATE_IMPRESSION|Synthetic score calculation|Synthetic history calculation|Synthetic recorded questionnaire mismatch|Synthetic methodology explanation|Coverage =|Coverage by segment/);
  for (const explanation of ['synthetic-rule-hash', 'SYNTHETIC_CANDIDATE_IMPRESSION', 'Synthetic score calculation explanation', 'Synthetic history calculation explanation', 'Synthetic recorded questionnaire mismatch', 'Synthetic methodology explanation', 'Non-overlapping age bands: 18–29, 30–39, 40–49 and 50+']) {
    assert.ok(allText.includes(explanation), `${role}: ${explanation} remains available on demand`);
  }
  assert.equal(flatten(tree).filter((element) => element.type === 'select').length, 7);
  for (const label of ['Program', 'Campaign', 'Iteration', 'Mandal', 'Age', 'Gender', 'Sentiment measure']) {
    assert.ok(selectFor(tree, label), `${role}: ${label} filter is retained`);
  }
  const heatmap = find(tree, (element) => hasClass(element, 'heatmap'));
  assert.match(textContent(heatmap, true), /Synthetic Mandal8 answered \/ 10 respondents0%/);
  assert.match(textContent(heatmap, true), /Sparse synthetic Mandal3 answered \/ 4 respondents · Withheld—/);
}

// Missing ratings stay unavailable; a genuine zero is still a measured value.
const zeroTree = render({ data: dashboard('SUPER_ADMIN', { intelligence: {
  ...intelligence, rating: { ...intelligence.rating, value: 0, answeredBase: 8 },
  predictive: { ...intelligence.predictive, projectedNextRating: 0 }
} }) });
assert.match(textContent(zeroTree, true), /0\.0\/5/);
assert.match(textContent(zeroTree, true), /Indicative next-Iteration 0\.0\/5/);
const suppressedTree = render({ data: dashboard('SUPER_ADMIN', { intelligence: {
  ...intelligence, suppressed: true, respondentBase: null
} }) });
assert.match(textContent(suppressedTree, true), /Research result withheld/);
assert.match(textContent(suppressedTree, true), /Below 5 respondent observations/);
assert.doesNotMatch(textContent(suppressedTree, true), /DESCRIPTIVE CANDIDATE IMPRESSION|0\.0\/5/);
assert.match(textContent(suppressedTree), /Withheld values are unavailable, not zero/);
assert.ok(!find(suppressedTree, (element) => hasClass(element, 'reportGrid') || hasClass(element, 'reportCard')),
  'Withheld overall research result does not render individual report cards');

for (const variant of ['sparse', 'populated', 'withheld-partitions']) {
  const tree = render({ data: dashboard('SUPER_ADMIN', { intelligence: fixtureIntelligence(variant) }) });
  assertReportCardStructure(tree, `${variant} synthetic fixture`);
  assertClosedDetails(tree);
  if (variant === 'sparse') {
    assert.match(textContent(tree, true), /No reportable sentiment distribution|No demographic evidence/);
    assert.match(textContent(tree, true), /0 answered \/ 10 respondents · 0\.0% coverage · Withheld/);
  } else if (variant === 'withheld-partitions') {
    assert.match(textContent(tree, true), /Withheld answered \/ Withheld respondents · Withheld coverage/);
    assert.match(textContent(tree, true), /Withheld coded \/ 10 observations/);
    assert.doesNotMatch(textContent(tree, true), /0 answered|0 coded|NaN|null/);
  } else {
    assert.match(textContent(tree, true), /Synthetic candidate impression and recorded expectations/);
    assert.match(textContent(tree, true), /Indicative next-Iteration 3\.2\/5/);
  }
}

// No stale role/scope reports are exposed while a new request is being resolved.
for (const options of [
  { role: 'CAMPAIGNER', data: dashboard('SUPER_ADMIN') },
  { filters: ['another-program', '', '', '', '', '', 'candidate_impression'], loadedScope: JSON.stringify(['', '', '', '', '', '', 'candidate_impression']) },
  { loading: true }
]) {
  const tree = render(options);
  assert.match(textContent(tree, true), /Loading your Dashboard/);
  assert.ok(!find(tree, (element) => hasClass(element, 'intelligencePanel')));
  assert.ok(!find(tree, (element) => hasClass(element, 'metrics')));
}
for (const options of [{ loading: true }, { refreshing: true }]) {
  assert.equal(find(render(options), (element) => element.type === 'button')?.props.disabled, true, 'refresh busy guards are retained');
}
const errorTree = render({ data: null, error: 'Synthetic Dashboard unavailable' });
assert.match(textContent(errorTree, true), /Synthetic Dashboard unavailable/);
assert.ok(find(errorTree, (element) => element.props.role === 'alert'));
const noActions = render({ data: dashboard('SUPER_ADMIN', { actions: [] }) });
assert.match(textContent(noActions, true), /No action flags in your visible work/);
assert.doesNotMatch(textContent(noActions, true), /not a platform health or research-validation sign-off/);
assert.match(textContent(noActions), /not a platform health or research-validation sign-off/);

const initialFilters = ['selected-program', 'selected-campaign', 'selected-iteration', 'selected-mandal', 'selected-age', 'selected-gender', 'candidate_impression'];
for (const [label, expected] of [
  ['Program', ['next-value', '', '', '', '', '', 'candidate_impression']],
  ['Campaign', ['selected-program', 'next-value', '', '', '', '', 'candidate_impression']],
  ['Iteration', ['selected-program', 'selected-campaign', 'next-value', '', '', '', 'candidate_impression']],
  ['Mandal', ['selected-program', 'selected-campaign', 'selected-iteration', 'next-value', 'selected-age', 'selected-gender', 'candidate_impression']],
  ['Age', ['selected-program', 'selected-campaign', 'selected-iteration', 'selected-mandal', 'next-value', 'selected-gender', 'candidate_impression']],
  ['Gender', ['selected-program', 'selected-campaign', 'selected-iteration', 'selected-mandal', 'selected-age', 'next-value', 'candidate_impression']],
  ['Sentiment measure', ['selected-program', 'selected-campaign', 'selected-iteration', 'selected-mandal', 'selected-age', 'selected-gender', 'next-value']]
]) {
  const tree = render({ filters: [...initialFilters] });
  selectFor(tree, label).props.onChange({ target: { value: 'next-value' } });
  assert.deepEqual(hookStates.slice(4, 11), expected, `${label} retains its existing dependent-filter reset behavior`);
  const nextTree = renderCurrentState();
  assert.match(textContent(nextTree, true), /Loading your Dashboard/, `${label} change withholds the old scope`);
  assert.ok(!find(nextTree, (element) => hasClass(element, 'intelligencePanel')));
}
assert.equal(apiCalls, 0, 'rendering and filter interactions never make a live API request');
console.log('Regular Dashboard disclosures: nine uniform header/body/footer reports, closed accessible notes, retained calculations, roles, scope, bases, zero/withheld values, sparse/long-content fixtures, filters, guards and no live requests passed.');

// Optional browser review uses actual page/CSS with synthetic values only. Native
// details controls work without JavaScript; there are no live report iframes.
const previewArgument = process.argv.find((argument) => argument === '--serve-fixture' || argument.startsWith('--serve-fixture='));
if (previewArgument) {
  const port = Number(previewArgument.includes('=') ? previewArgument.split('=')[1] : 4177);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'fixture port must be valid');
  const css = (await readFile(new URL('../../src/app/dashboard.module.css', import.meta.url), 'utf8'))
    .replace(/\.([A-Za-z_][\w-]*)/g, (_, name) => `.${styles[name]}`);
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname !== '/') { response.writeHead(404); response.end('Not found'); return; }
    const role = url.searchParams.get('role') || 'SUPER_ADMIN';
    if (!(role in titles)) { response.writeHead(400); response.end('Unknown synthetic role'); return; }
    const variant = url.searchParams.get('fixture') || 'default';
    if (!fixtureVariants.includes(variant)) { response.writeHead(400); response.end('Unknown synthetic fixture'); return; }
    const markup = renderToStaticMarkup(render({ role, data: dashboard(role, { intelligence: fixtureIntelligence(variant) }) }));
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Regular Dashboard preview · synthetic data</title><style>
      *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.fixtureLabel{position:sticky;top:0;z-index:10;padding:12px 24px;background:#392b32;color:#fff;font-weight:700;line-height:1.5}
      /* Match the real AppShell's available content width without loading it. */
      .fixtureAppShell{margin-left:260px}@media(max-width:1024px){.fixtureAppShell{margin-left:220px}}@media(max-width:760px){.fixtureAppShell{margin-left:0}}
      ${css}</style></head><body><div class="fixtureLabel" data-show="synthetic-only">Local layout preview · synthetic data only<br><small>No real users, voters, survey results or API requests are loaded. Role: ${role} · Fixture: ${variant}</small></div>${markup}</body></html>`;
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    });
    response.end(html);
  });
  server.on('error', (reason) => {
    console.error(`Unable to start the synthetic fixture: ${reason.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Regular Dashboard preview · synthetic data only: http://127.0.0.1:${port}/`));
}
