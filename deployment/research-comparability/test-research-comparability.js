import assert from 'node:assert/strict';
import { loadIterationComparability, evaluateIterationComparison } from './research-comparability.repository.js';

const baseline = { iterationId: 'i1', campaignId: 'c1', iterationNumber: 1, previousIterationId: null, status: 'BASELINE', reasons: [], designDeclared: true };
const latest = { ...baseline, iterationId: 'i2', iterationNumber: 2, previousIterationId: 'i1', status: 'COMPARABLE' };
const gate = new Map([['i1', baseline], ['i2', latest]]);
const compare = () => evaluateIterationComparison('i1', 'i2', gate);
assert.equal(compare().status, 'COMPARABLE', 'a declared baseline may precede a comparable wave');
for (const change of [
  { status: 'NOT_COMPARABLE', reasons: ['Questionnaire identity changed'] },
  { designDeclared: false },
  { campaignId: 'c2' },
  { previousIterationId: 'intervening-wave' },
  { iterationNumber: 3 }
]) {
  gate.set('i2', { ...latest, ...change });
  assert.equal(compare().status, 'NOT_COMPARABLE');
  assert.ok(compare().reasons.length);
}
gate.set('i2', latest);
gate.set('i1', { ...baseline, designDeclared: false });
assert.equal(compare().status, 'NOT_COMPARABLE');
assert.equal(evaluateIterationComparison('i1', 'unknown', gate).status, 'NOT_COMPARABLE');
assert.equal(evaluateIterationComparison('i1', 'i1', gate).status, 'NOT_COMPARABLE');

let queries = 0;
assert.equal((await loadIterationComparability({ query() { queries++; } }, [])).size, 0);
assert.equal(queries, 0);
const loaded = await loadIterationComparability({ async query(sql, params) {
  assert.match(sql, /analytics_iteration_comparability_v1/);
  assert.match(sql, /ANY\(\$1::uuid\[\]\)/);
  assert.deepEqual(params, [['i1', 'i2']]);
  return { rows: [
    { iteration_id: 'i1', campaign_id: 'c1', iteration_number: '1', comparison_status: 'BASELINE', comparison_reasons: [], design_declared: true },
    { iteration_id: 'i2', campaign_id: 'c1', iteration_number: 2, previous_iteration_id: 'i1', comparison_status: 'COMPARABLE', comparison_reasons: [], design_declared: true }
  ] };
} }, ['i1', 'i2', 'i1']);
assert.equal(evaluateIterationComparison('i1', 'i2', loaded).status, 'COMPARABLE');
for (const code of ['42P01', '42703']) {
  const unavailable = await loadIterationComparability({ async query() { throw Object.assign(new Error('old schema'), { code }); } }, ['i1', 'i2']);
  const result = evaluateIterationComparison('i1', 'i2', unavailable);
  assert.equal(result.status, 'NOT_COMPARABLE');
  assert.ok(result.reasons.some((reason) => reason.includes('migration 029')));
}
await assert.rejects(loadIterationComparability({ async query() { throw Object.assign(new Error('connection failed'), { code: '08006' }); } }, ['i1']), /connection failed/);
console.log('Shared research comparison gate tests passed.');
