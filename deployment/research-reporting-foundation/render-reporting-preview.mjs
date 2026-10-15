import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { syntheticContractCoverage, syntheticId, syntheticResearchReport } from './reporting-ui-fixtures.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const library = { exports: {}, require };
runInNewContext(await compile('../../src/lib/research-report.ts'), library);
const presets = { exports: {}, require };
runInNewContext(await compile('../../src/lib/reporting-presets.ts'), presets);
function renderComponent(code, props, values, detailsToOpen, prefix) {
  let stateIndex = 0;
  const react = { ...React, useState: (initial) => [stateIndex < values.length ? values[stateIndex++] : typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (current) => ({ current }), useCallback: (callback) => callback, useEffect: () => {} };
  const context = { exports: {}, Error, require: (id) => id === 'react' ? react
    : id === '@/lib/api' ? { apiFetch: () => { throw new Error('No live API is allowed in this static preview'); } }
      : id === '@/lib/research-report' ? library.exports
        : id === '@/lib/reporting-presets' ? presets.exports
        : id === './CallQualitySummary' ? { default: () => null }
        : id === './InterviewCompletionSummary' ? { default: () => null }
        : id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => `${prefix}-${String(key)}` }) } : require(id) };
  runInNewContext(code, context);
  const element = context.exports.default(props);
  // Alter only native disclosure state on the actual rendered React tree.
  // All card, form, table and field markup comes from the current components.
  function openDetails(node) {
    if (!React.isValidElement(node)) return node;
    const children = React.Children.toArray(node.props.children);
    const summary = children.find((child) => React.isValidElement(child) && child.type === 'summary');
    const text = (value) => Array.isArray(value) ? value.map(text).join('') : React.isValidElement(value) ? text(value.props.children) : typeof value === 'string' ? value : '';
    return React.cloneElement(node, node.type === 'details' && detailsToOpen.some((label) => text(summary).includes(label)) ? { open: true } : {}, ...children.map(openDetails));
  }
  return renderToStaticMarkup(openDetails(element));
}

const coverage = syntheticContractCoverage();
const editing = coverage.questions[3];
const draft = {
  reportKey: editing.contract.reportKey, outputVariables: editing.contract.outputVariables.join('\n'), valueType: editing.contract.valueType,
  allowedValues: editing.contract.allowedValues.join('\n'), targetType: editing.contract.target.type,
  targetId: editing.contract.target.id, targetName: editing.contract.target.name
};
const contractHtml = renderComponent(await compile('../../src/components/QuestionnaireReportingContracts.tsx'), { questionnaireId: syntheticId(10) },
  [coverage, false, false, null, null, editing.id, draft, null, false], ['Question 4'], 'contract');
const report = syntheticResearchReport();
const query = `iterationId=${syntheticId(2)}`;
const reportHtml = renderComponent(await compile('../../src/components/ResearchReportingPanel.tsx'), { campaignId: syntheticId(1), query },
  [report, JSON.stringify([syntheticId(1), query, 0]), null, 0], ['Report coverage and evidence', 'Contact cohort and response coverage'], 'report');
const contractCss = await readFile(new URL('../../src/components/questionnaire-reporting-contracts.module.css', import.meta.url), 'utf8');
const reportCss = await readFile(new URL('../../src/components/research-reporting-panel.module.css', import.meta.url), 'utf8');
const printable = library.exports.buildPrintableResearchReport(report);
const output = resolve(process.argv[2] || '/tmp/psephology-research-reporting-preview.html');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic reporting layout preview</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f6f8f7;color:#28423d}.preview{max-width:1150px;margin:auto;padding:26px}.previewBanner{padding:12px 18px;background:#fff6d8;border:1px solid #e8cf91;border-radius:12px;margin-bottom:24px;font-size:14px}.preview h1{font-size:26px}${contractCss.replaceAll(/\.([A-Za-z_][\w-]*)/g, '.contract-$1')}${reportCss.replaceAll(/\.([A-Za-z_][\w-]*)/g, '.report-$1')}@media(max-width:600px){.preview{padding:12px}.preview h1{font-size:22px}}</style></head><body><main class="preview"><aside class="previewBanner">Local layout preview · synthetic data only · no live API, voter records or cloud calls</aside><h1>Methodology and reporting foundation</h1><div class="contractScope">${contractHtml}</div><div class="reportScope">${reportHtml}</div></main></body></html>`;
await writeFile(output, html, { flag: 'wx' });
const printOutput = output.replace(/\.html$/, '-printable.html');
await writeFile(printOutput, printable, { flag: 'wx' });
console.log(`Actual React component preview: ${output}`);
console.log(`Portable printable report preview: ${printOutput}`);
