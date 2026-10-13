import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Exercise the actual client page and disclosure components without authentication,
// live survey data, a browser session or external requests.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = await readFile(new URL('../../src/app/enterprise-dashboard/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { MeasurementNote, SupportingPanel };`, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true
  }
}).outputText;

const styles = new Proxy({}, { get: (_, key) => `dashboardFixture_${String(key)}` });
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
  react: { ...React, useState, useRef: (value) => ({ current: value }), useCallback: (callback) => callback, useEffect: () => {} },
  'lucide-react': new Proxy({}, { get: () => Icon }),
  'next/link': defaultModule(({ children, ...props }) => React.createElement('a', props, children)),
  '@/components/AppShell': defaultModule(({ children }) => React.createElement('div', { className: 'fixtureAppShell' }, children)),
  '@/components/FeedbackMessage': defaultModule(({ message, tone }) => React.createElement('div', {
    role: 'alert', 'data-feedback-tone': tone
  }, message)),
  '@/hooks/useCurrentUser': { useCurrentUser: () => ({ user: currentUser }) },
  '@/lib/api': { apiFetch: () => { apiCalls++; throw new Error('Live API calls are prohibited in this local fixture'); } },
  './TelanganaBoundaryMap': defaultModule(() => React.createElement('section', {
    'data-boundary-fixture': true
  }, 'Boundary component placeholder · geographic reference only')),
  './QuickDashboardEmbed': defaultModule(() => React.createElement('div', {
    'data-sdk-report-fixture': true
  }, 'Embedding SDK placeholder · no live report')),
  './quick.module.css': defaultModule(styles)
};
const context = { exports: {}, require: (name) => name in mocks ? mocks[name] : require(name) };
runInNewContext(compiled, context);
const { default: Page, MeasurementNote, SupportingPanel } = context.exports;

const campaignId = 'synthetic-campaign';
const movement = (number, overrides = {}) => ({
  campaignId, campaignName: 'Synthetic test campaign', iterationId: `synthetic-iteration-${number}`,
  iterationNumber: number, iterationName: `Synthetic iteration ${number}`, respondentBase: 8,
  averageDirectPartyStrength: null, partyStrengthChange: null,
  positiveSentimentPct: null, positiveSentimentChangePct: null,
  candidatePositivePct: null, candidatePositiveChangePct: null,
  sentimentAnswerBase: 3, sentimentMissingCount: 1, sentimentUncodedCount: 1,
  sentimentCantSayCount: 2, sentimentRefusedCount: 1,
  candidateAnswerBase: 3, candidateMissingCount: 1, candidateUncodedCount: 1,
  candidateCantSayCount: 2, candidateRefusedCount: 1,
  previousSentimentAnswerBase: null, previousCandidateAnswerBase: null,
  percentageBasis: 'Synthetic fixture: coded answers only; unavailable answers remain distinct',
  sentimentConstruct: 'Synthetic fixture: explicit incumbent assessment',
  candidateConstruct: 'Synthetic fixture: explicit candidate impression',
  comparisonBasis: 'BASELINE', comparisonReasons: [], ...overrides
});
const quality = {
  sentimentValidation: {
    status: 'HUMAN_REVIEW_PENDING', method: 'EXPLICIT_LABELS', normalizationVersion: 'fixture-v1',
    ruleHash: 'synthetic-rule-hash-0123456789', message: 'Synthetic fixture: human review remains pending'
  },
  scope: {
    label: 'Whole portfolio; independent of embedded Amazon Quick filters',
    runScope: 'All Runs within each Iteration',
    movementScope: 'Full Iterations, not filtered by age, gender or Mandal'
  },
  portfolio: {
    campaignCount: 1, respondentBase: 8, callAttempts: 12, connectedCalls: 8,
    transcriptsCaptured: 8, responsesCaptured: 8, demographicFieldBase: 24,
    connectionRatePct: 66.7, transcriptCoveragePct: 100, responseCoveragePct: 100,
    demographicCompletenessPct: 75, evidenceQualityStatus: 'LIMITED'
  },
  methodology: {
    samplingDesign: 'Synthetic convenience fixture', weightingStatus: 'Unweighted',
    statisticalPrecision: 'Synthetic data has no inferential precision',
    comparisonRule: 'Recorded design and frozen questionnaire checks must match',
    sentimentConstruct: 'Explicit incumbent assessment only', candidateConstruct: 'Candidate impression only',
    sentimentCoding: 'Explicit coded labels only', assetPublication: 'Synthetic fixture is not a published asset',
    permittedUse: 'Local layout review', prohibitedUse: 'Population estimates or vote forecasts'
  },
  campaigns: [],
  movement: [
    movement(1),
    movement(2, { comparisonBasis: 'NOT_COMPARABLE', comparisonReasons: ['Synthetic questionnaire mismatch'],
      positiveSentimentPct: 50, candidatePositivePct: 60, sentimentAnswerBase: 8, candidateAnswerBase: 8,
      positiveSentimentChangePct: 98, candidatePositiveChangePct: 98 }),
    movement(3, { comparisonBasis: 'COMPARABLE', positiveSentimentPct: 50, candidatePositivePct: 50,
      sentimentAnswerBase: 8, candidateAnswerBase: 8, previousSentimentAnswerBase: 8, previousCandidateAnswerBase: 8 }),
    movement(4, { comparisonBasis: 'COMPARABLE', positiveSentimentPct: 0, candidatePositivePct: 0,
      positiveSentimentChangePct: 0, sentimentAnswerBase: 8, candidateAnswerBase: 8,
      previousSentimentAnswerBase: 8, previousCandidateAnswerBase: 8 }),
    movement(5, { comparisonBasis: 'COMPARABLE', positiveSentimentPct: 75, candidatePositivePct: 50,
      positiveSentimentChangePct: 25, sentimentAnswerBase: 8, candidateAnswerBase: 8,
      previousSentimentAnswerBase: 8, previousCandidateAnswerBase: 8 }),
    movement(6, { comparisonBasis: 'SUPPRESSED', respondentBase: 3,
      comparisonReasons: ['Synthetic adjacent wave has too few response records'], positiveSentimentChangePct: 99 })
  ],
  researchDesigns: [{
    campaignId, campaignName: 'Synthetic test campaign', iterationId: 'synthetic-iteration-1',
    iterationNumber: 1, iterationName: 'Synthetic iteration 1', targetPopulation: 'Not declared',
    sampleFrameName: '', samplingMethod: 'DIRECTIONAL_NON_PROBABILITY', selectionMethod: '',
    weightingStatus: 'NOT_CONFIGURED', weightingMethod: '', weightingVariables: [],
    fieldworkMode: 'AI_ASSISTED_OUTBOUND_VOICE', methodologyNotes: '', cohortDesign: 'NOT_DECLARED',
    revision: 0, declaredByUserId: null, declaredAt: null, declarationComplete: false,
    questionContentRecorded: false, frozenQuestionCount: 0, questionContentFingerprint: null,
    comparisonStatus: 'BASELINE', comparisonReasons: ['Synthetic methodology is undeclared']
  }]
};
const dashboard = {
  provider: 'AMAZON_QUICK_SIGHT', mode: 'ONE_CLICK', embedUrl: 'https://example.invalid/local-layout-fixture'
};

// Resolve the page's function components so tests inspect the rendered native tree,
// including the real disclosure markup and registry, rather than source strings.
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
function render({ role = 'ADMIN', report = dashboard, evidence = quality, loading = false,
  sessionError = null, qualityError = null, actorId = 'synthetic-user' } = {}) {
  currentUser = { id: 'synthetic-user', role: { code: role } };
  hookCursor = 0;
  hookStates = [report, evidence, loading, sessionError, qualityError, actorId];
  return resolve(Page());
}
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
const supportingPanel = (tree, title) => find(tree, (element) => element.type === 'details'
  && hasClass(element, 'supportingPanel') && textContent(element.props.children[0]).includes(title));
function assertClosedDetails(tree) {
  const disclosures = flatten(tree).filter((element) => element.type === 'details');
  assert.ok(disclosures.length, 'disclosure notes render');
  for (const disclosure of disclosures) {
    assert.ok(!disclosure.props.open, 'disclosures start closed');
    const firstChild = flatten(disclosure.props.children)[0];
    assert.equal(firstChild?.type, 'summary', 'native summary is the first child');
    assert.ok(textContent(firstChild).trim(), 'every disclosure has an accessible text label');
  }
}

const adminTree = render();
const staleActorTree = render({ actorId: 'another-user' });
assert.ok(!find(staleActorTree, (element) => element.props['data-sdk-report-fixture']), 'old actor session is hidden synchronously');
assert.ok(!supportingPanel(staleActorTree, 'Fieldwork summary'), 'old actor quality data is hidden synchronously');
const nodes = flatten(adminTree);
const reportIndex = nodes.findIndex((element) => element.props['data-sdk-report-fixture']);
assert.ok(reportIndex >= 0, 'successful session renders the report iframe');
const fieldworkIndex = nodes.findIndex((element) => hasClass(element, 'qualityPanel'));
assert.ok(fieldworkIndex > reportIndex, 'reports precede the fieldwork summary');
for (const title of ['Iteration comparisons', 'Research setup', 'Boundary explorer']) {
  const panel = supportingPanel(adminTree, title);
  assert.ok(panel, `${title} is available on demand`);
  assert.ok(nodes.indexOf(panel) > reportIndex, `reports precede ${title}`);
}
const registry = supportingPanel(adminTree, 'Research setup');
const boundary = find(adminTree, (element) => element.props['data-boundary-fixture']);
assert.ok(nodes.indexOf(registry) > reportIndex, 'reports precede the methodology editor');
assert.ok(nodes.indexOf(boundary) > reportIndex, 'reports precede the boundary component');
assertClosedDetails(adminTree);

for (const [Component, props] of [
  [MeasurementNote, { children: 'Private measurement detail' }],
  [SupportingPanel, { title: 'Fixture supporting panel', status: 'Fixture scope', children: 'Private supporting detail' }]
]) {
  const element = resolve(Component(props));
  assert.equal(element.type, 'details');
  assertClosedDetails(element);
  assert.doesNotMatch(textContent(element, true), /Private/);
  assert.match(textContent(element), /Private/);
}

const visible = textContent(adminTree, true);
for (const label of ['DEMO · TEST SURVEY EVIDENCE', 'Unweighted', 'Human review pending', 'Whole portfolio', 'all Runs', 'independent of report filters']) {
  assert.ok(visible.includes(label), `${label} stays visible without opening notes`);
}
assert.doesNotMatch(visible, /Technical error|Recorded design and frozen questionnaire|synthetic-rule-hash|I confirm these entries/,
  'long explanations and methodology editing start inside closed notes');
assert.match(textContent(adminTree), /Fewer than five distinct people/);
assert.match(textContent(adminTree), /Synthetic fixture: coded answers only/);
assert.match(textContent(adminTree), /Synthetic questionnaire mismatch/);
assert.match(visible, /Full Iterations · not filtered by age, gender or Mandal/);

const comparisons = supportingPanel(adminTree, 'Iteration comparisons');
const articles = flatten(comparisons).filter((element) => element.type === 'article');
assert.equal(articles.length, 6);
const articleText = articles.map((element) => textContent(element, true));
assert.match(articleText[0], /Incumbent positive: Withheld/);
assert.match(articleText[0], /Candidate positive: Withheld/);
assert.match(articleText[0], /Baseline — no earlier comparison/);
assert.doesNotMatch(articleText[0], /0%|pp/);
assert.match(articleText[1], /Not comparable — change withheld/);
assert.doesNotMatch(articleText[1], /98|pp/);
assert.match(articleText[2], /Change unavailable/);
assert.doesNotMatch(articleText[2], /pp/);
assert.match(articleText[3], /Incumbent positive: 0%/);
assert.match(articleText[3], /Candidate positive: 0%/);
assert.match(articleText[3], /\+0 pp/);
assert.match(articleText[4], /\+25 pp/);
assert.match(articleText[5], /Withheld — too few response records/);
assert.doesNotMatch(articleText[5], /Not comparable|99|pp/);
assert.match(textContent(articles[5]), /at least five response records are required in each adjacent wave/);

for (const role of ['SUPER_ADMIN', 'ADMIN']) {
  assert.ok(supportingPanel(render({ role }), 'Research setup'), `${role} can find canonical research setup links`);
}
for (const role of ['CAMPAIGN_MANAGER', 'CAMPAIGNER']) {
  const tree = render({ role });
  assert.ok(!supportingPanel(tree, 'Research setup'), `${role} does not receive the setup panel`);
  assert.ok(!find(tree, (element) => hasClass(element, 'designRegistry')), `${role} does not receive the registry`);
}

const errorTree = render({ report: null, evidence: null,
  sessionError: 'Synthetic session failure', qualityError: 'Synthetic quality failure' });
const visibleErrors = textContent(errorTree, true);
assert.match(visibleErrors, /Synthetic session failure/);
assert.match(visibleErrors, /Dashboard session unavailable/);
assert.match(visibleErrors, /Survey quality unavailable: Synthetic quality failure/);
assert.match(visibleErrors, /not a missing survey answer/);
assert.ok(find(errorTree, (element) => element.props.role === 'alert'
  && textContent(element).includes('Synthetic quality failure')), 'quality failure is an alert');
assert.ok(!find(errorTree, (element) => element.props['data-sdk-report-fixture']), 'failed session does not render an SDK report');
const partialTree = render({ evidence: null, qualityError: 'Synthetic quality failure' });
assert.ok(find(partialTree, (element) => element.props['data-sdk-report-fixture']), 'quality failure does not conceal a successful report session');
assert.match(textContent(partialTree, true), /Synthetic quality failure/);

const loadingTree = render({ loading: true });
assert.ok(find(loadingTree, (element) => element.props.role === 'status'
  && textContent(element).includes('Loading survey reports')), 'loading state is announced');
assert.ok(!find(loadingTree, (element) => element.props['data-sdk-report-fixture']), 'old SDK session is hidden during loading');
for (const options of [{ loading: true }]) {
  const refresh = find(render(options), (element) => element.type === 'button' && textContent(element).trim() === 'Refresh');
  assert.equal(refresh.props.disabled, true, 'refresh respects loading and registry busy state');
}
assert.equal(apiCalls, 0, 'fixture rendering never makes an API request');
console.log('Dashboard simplification UI: report ordering, closed disclosures, interpretation cues, scope, missing values, comparisons, roles and errors passed.');

// Optional visual review uses the same resolved page and actual CSS module styles.
// The remote report iframe is deliberately replaced with an explicit placeholder.
const previewArgument = process.argv.find((argument) => argument === '--preview' || argument.startsWith('--preview='));
if (previewArgument) {
  const previewPort = Number(previewArgument.includes('=') ? previewArgument.split('=')[1] : 4176);
  assert.ok(Number.isInteger(previewPort) && previewPort > 0 && previewPort < 65536, 'preview port must be valid');
  const css = (await readFile(new URL('../../src/app/enterprise-dashboard/quick.module.css', import.meta.url), 'utf8'))
    .replace(/\.([A-Za-z_][\w-]*)/g, (_, name) => `.${styles[name]}`);
  function previewTree(element) {
    if (Array.isArray(element)) return element.map(previewTree);
    if (!element || typeof element !== 'object') return element;
    if (element.props['data-sdk-report-fixture']) return React.createElement('div', { key: element.key, className: 'fixtureReportPlaceholder', role: 'note' },
      React.createElement('strong', null, 'Survey report iframe placeholder'),
      React.createElement('p', null, 'Live dashboards and survey results are not loaded in this local preview.'));
    const { children, ...props } = element.props;
    return React.createElement(element.type, { ...props, key: element.key }, previewTree(children));
  }
  const markup = renderToStaticMarkup(previewTree(adminTree));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local layout preview · synthetic data</title><style>
    :root{--background:#fff9f5;--platform-ink:#3f2f35;--platform-font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--platform-ink);font-family:var(--platform-font)}.fixtureLabel{padding:12px 20px;background:#392b32;color:white;font-weight:700;font-size:14px}
    .fixtureReportPlaceholder{display:grid;align-content:center;justify-items:center;min-height:780px;padding:32px;background:#f8faf9;color:#74656b;text-align:center;border-top:1px dashed #c8d8d3}.fixtureReportPlaceholder p{max-width:480px;line-height:1.5}
    ${css}</style></head><body><div class="fixtureLabel">Local layout preview · synthetic data<br><small>All displayed metrics are synthetic fixture values. No real survey results are loaded.</small></div>${markup}</body></html>`;
  const server = createServer((request, response) => {
    if (request.url !== '/') { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    });
    response.end(html);
  });
  server.on('error', (reason) => {
    console.error(`Unable to start the local preview: ${reason.message}`);
    process.exitCode = 1;
  });
  server.listen(previewPort, '127.0.0.1', () => console.log(`Local layout preview · synthetic data: http://127.0.0.1:${previewPort}/`));
}
