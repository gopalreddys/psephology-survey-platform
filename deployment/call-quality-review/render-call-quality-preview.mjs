import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const library = { exports: {}, require, Error };
runInNewContext(await compile('../../src/lib/call-quality-review.ts'), library);
const id = (number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fingerprint = 'a'.repeat(64);
const checks = Object.fromEntries(library.exports.qualityChecks.map(([key]) => [key, 'PASS']));
const review = (number) => ({ id: id(number), language: 'ENGLISH', checks, issueBuckets: [], note: 'Synthetic question delivery and output correspondence checked.', createdAt: '2026-10-12T05:00:00.000Z' });
const evidence = {
  schemaVersion: 1, executionId: id(1), campaignId: id(2), iterationId: id(3), runId: id(4), evidenceFingerprint: fingerprint,
  reviewable: true, approvalReady: false, blockedReasons: ['TWO_INDEPENDENT_REVIEWS_REQUIRED'],
  evidence: { transcript: [{ role: 'agent', text: 'Which local issue would you like the survey to record?' }, { role: 'respondent', text: 'Reliable drinking water.' }], outputs: { issue_priority: 'Drinking water' }, questions: [{ code: 'Q_ISSUE_PRIORITY', text: 'Which local issue would you like the survey to record?', order: 1, outputVariables: ['issue_priority'] }], agent: { appId: 'Synthetic-Preview-Agent', version: 5, basis: 'EXECUTION_REQUEST' }, frozenInstrumentHash: 'b'.repeat(64), normalizationRuleHash: 'c'.repeat(64) },
  permissions: { canReview: true, canDecide: false }, ownReview: null, reviews: [], counts: { currentReviews: 0, staleReviews: 0 }, decision: null, decisionRevision: 0
};
const reviewedEvidence = { ...evidence, approvalReady: true, blockedReasons: [], permissions: { canReview: false, canDecide: false }, ownReview: review(11), reviews: [review(12)], counts: { currentReviews: 2, staleReviews: 1 }, decisionRevision: 1,
  decision: { revision: 1, action: 'APPROVE_SAMPLE', reason: 'Synthetic decision covering only this reviewed call sample.', decidedAt: '2026-10-12T05:10:00.000Z', evidenceFingerprint: fingerprint } };
const summary = { schemaVersion: 1, campaignId: id(2), iterationId: id(3), status: 'CHANGES_REQUIRED', counts: { reviewableCalls: 18, reviewedCalls: 6, approvedCalls: 3, rejectedCalls: 1, staleCalls: 0 }, latestDecisionAt: '2026-10-12T05:10:00.000Z', limitations: ['Synthetic counts demonstrate the control layout only; they are not survey findings.', 'A reviewed sample is not whole-Iteration or sentiment certification.'] };
const props = { executionId: id(1), campaignId: id(2), iterationId: id(3), runId: id(4) };
function render(code, props, state, role, expanded = []) {
  let index = 0;
  const hooks = { ...React, useState: (initial) => [index < state.length ? state[index++] : typeof initial === 'function' ? initial() : initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {} };
  const context = { exports: {}, Error, require: (key) => key === 'react' ? hooks : key === '@/hooks/useCurrentUser' ? { useCurrentUser: () => ({ user: { id: id(99), role: { code: role } } }) }
    : key === '@/lib/api' ? { apiFetch: () => { throw new Error('No live API is allowed in this synthetic preview'); } }
      : key === '@/lib/call-quality-review' ? library.exports : key.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => `qa-${String(key)}` }) } : require(key) };
  runInNewContext(code, context);
  function expand(node) {
    if (!React.isValidElement(node)) return node;
    const children = React.Children.toArray(node.props.children);
    const label = (value) => React.isValidElement(value) ? label(value.props.children) : Array.isArray(value) ? value.map(label).join('') : typeof value === 'string' ? value : '';
    const summary = children.find((child) => React.isValidElement(child) && child.type === 'summary');
    return React.cloneElement(node, node.type === 'details' && expanded.some((item) => label(summary).includes(item)) ? { open: true } : {}, ...children.map(expand));
  }
  return renderToStaticMarkup(expand(context.exports.default(props)));
}
const reviewCode = await compile('../../src/components/CallQualityReview.tsx');
const reviewKey = JSON.stringify([id(1), id(2), id(3), id(4), id(99), 'ADMIN', true, 0]);
const draft = Object.fromEntries(library.exports.qualityChecks.map(([key]) => [key, '']));
const initialHtml = render(reviewCode, props, [evidence, reviewKey, null, null, 0, false, '', draft, [], '', '', false, false], 'ADMIN', ['Exact evidence']);
const reviewedHtml = render(reviewCode, props, [reviewedEvidence, reviewKey, null, null, 0, false, '', draft, [], '', '', false, false], 'ADMIN', ['Your recorded assessment']);
const summaryProps = { campaignId: id(2), iterationId: id(3), refreshKey: 'synthetic-report' };
const summaryKey = JSON.stringify([id(2), id(3), 'synthetic-report', 0, id(99), 'CAMPAIGN_MANAGER', true]);
const summaryHtml = render(await compile('../../src/components/CallQualitySummary.tsx'), summaryProps, [true, summary, summaryKey, false, 0], 'CAMPAIGN_MANAGER', ['Audited call-sample']);
const css = (await readFile(new URL('../../src/components/call-quality-review.module.css', import.meta.url), 'utf8')).replaceAll(/\.([A-Za-z_][\w-]*)/g, '.qa-$1');
const output = resolve(process.argv[2] || '/tmp/psephology-call-quality-preview.html');
await writeFile(output, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic call-quality controls</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f5f8f6;color:#31473d}main{max-width:1050px;padding:24px;margin:auto}.banner{padding:14px;background:#fff4d6;border:1px solid #e6ce92;border-radius:12px;font-size:14px}.previewSection{margin:28px 0}.previewSection>h2{font-size:20px}${css}@media(max-width:600px){main{padding:12px}}</style></head><body><main><p class="banner">Local visual QA — synthetic records only. No AWS, Sarvam, voter records or live API.</p><h1>Audited call-quality workflow</h1><section class="previewSection"><h2>Admin — deliberate independent review</h2>${initialHtml}</section><section class="previewSection"><h2>Admin — immutable recorded assessment</h2>${reviewedHtml}</section><section class="previewSection"><h2>Campaign Manager — aggregate Iteration summary</h2>${summaryHtml}</section></main></body></html>`, { flag: 'wx' });
console.log(`Synthetic actual-React call-quality preview: ${output}`);
