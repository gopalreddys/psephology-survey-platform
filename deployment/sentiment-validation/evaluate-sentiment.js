import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSentimentDataset } from './sentiment-evaluation.js';
import { SYNTHETIC_BENCHMARK } from './synthetic-fixtures.js';

export async function runEvaluationCli(arguments_, streams = { out: process.stdout, error: process.stderr }) {
  let inputPath = null, reportPath = null;
  for (let index = 0; index < arguments_.length; index++) {
    const option = arguments_[index];
    if (option === '--help') {
      streams.out.write('Usage: node evaluate-sentiment.js [--input manually-sanitized-review.json] [--report new-report.json]\nInputs are read-only. Reports are created exclusively; existing files are never overwritten. No database, model or network is used.\n');
      return 0;
    }
    if (!['--input', '--report'].includes(option) || !arguments_[index + 1] || arguments_[index + 1].startsWith('--')) throw new Error(`Unsupported or incomplete option: ${option}`);
    if (option === '--input') {
      if (inputPath) throw new Error('--input may be provided once');
      inputPath = path.resolve(arguments_[++index]);
    } else {
      if (reportPath) throw new Error('--report may be provided once');
      reportPath = path.resolve(arguments_[++index]);
    }
  }
  if (inputPath && inputPath === reportPath) throw new Error('The report path cannot be the input path');
  const dataset = inputPath ? JSON.parse(await readFile(inputPath, 'utf8')) : SYNTHETIC_BENCHMARK;
  const report = evaluateSentimentDataset(dataset);
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  streams.out.write(`${report.normalizationVersion} · ${report.totals.caseCount} checks · ${report.totals.mismatchCount} mismatches · engineering ${report.engineeringGate}\n`);
  streams.out.write(`Review: ${report.reviewStatus}. Deployment approval: ${report.deploymentApproval}.\n`);
  streams.out.write(`Stratified real-call review: ${report.stratifiedReviewStatus}; ${report.totals.realCallCoverageGapCount}/${report.strata.length} cells have no attested real-call reference.\n`);
  for (const item of report.strata) streams.out.write(`${item.language} / ${item.construct}: n=${item.caseCount}, coded=${item.outputStateCounts.CODED}, uncoded=${item.outputStateCounts.UNCODED}, uncertainty=${item.outputStateCounts.CANT_SAY}, refusal=${item.outputStateCounts.REFUSED}, missing=${item.outputStateCounts.MISSING}, synthetic matches=${item.syntheticContractMatches}/${item.syntheticCompared}, attested matches=${item.attestedReferenceMatches}/${item.attestedReferenceCompared}\n`);
  if (reportPath) streams.out.write(`Report: ${reportPath}\n`);
  // A pending real-call reference cannot silently pass an engineering invocation.
  return report.engineeringGate === 'FAIL' || report.totals.pendingSanitizedCallCount > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runEvaluationCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`Sentiment evaluation failed: ${error.message}\n`); process.exitCode = 1; }
}
