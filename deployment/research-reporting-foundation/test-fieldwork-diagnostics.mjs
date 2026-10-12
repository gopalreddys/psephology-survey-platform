import assert from 'node:assert/strict';
import { buildFieldworkDiagnostics, sanitizeFieldworkDiagnostics, unavailableFieldworkDiagnostics,
  FIELDWORK_OUTCOMES } from './fieldwork-diagnostics.js';
import { loadFieldworkDiagnostics } from './fieldwork-diagnostics.repository.js';

const scope = { campaignId: '00000000-0000-4000-8000-000000000001',
  iterationId: '00000000-0000-4000-8000-000000000002', filters: { gender: null, ageBand: null, mandal: null } };
function fixture() {
  return { scope_available: true, initial_run_count: 1, initial_contact_count: 50, initial_null_voter_count: 0,
    source_identity_conflicts: 0, source_status_conflicts: 0,
    selected_base: 50, attempted_base: 45, connected_base: 10, structured_base: 5, outside_initial_base: 0,
    observed_at: '2026-10-10T10:00:00Z', outcomes: FIELDWORK_OUTCOMES.map((row) => ({ key: row.key, participants: 5 })),
    demographics: { gender: [{ category: 'Female', selected: 25, structured: 5 }, { category: 'Male', selected: 25, structured: 0 }],
      ageBand: ['18–29', '30–39', '40–49', '50+', 'Unknown'].map((category, index) => ({ category, selected: 10, structured: index === 0 ? 5 : 0 })),
      mandal: [{ category: 'Serilingampally', selected: 25, structured: 5 }, { category: 'Another Mandal', selected: 25, structured: 0 }] } };
}
const build = (aggregate = fixture(), extras = {}) => buildFieldworkDiagnostics({ aggregate, scope, iterationCompleted: true,
  analysisRespondentBase: 5, ...extras });
let result = build();
assert.equal(result.status, 'AVAILABLE');
assert.equal(result.scope.campaignId, scope.campaignId);
assert.equal(result.coverage.selectedBase, 50);
assert.deepEqual(result.coverage.stages.map((row) => row.participants), [50, 45, 10, 5]);
assert.equal(result.coverage.yield.percentage, 10);
assert.equal(result.sources.analysisBaseAlignment, 'MATCHED');
assert.equal(result.demographics.gender.status, 'AVAILABLE');
assert.equal(result.demographics.gender.rows.find((row) => row.category === 'Male').structured, 0);
assert.equal(result.demographics.gender.rows.find((row) => row.category === 'Female').differencePp, 50);
assert.ok(result.limitations.some((note) => note.includes('not verified unique people')));
assert.ok(result.limitations.some((note) => note.includes('not an AAPOR')));
assert.equal(result.sources.surveyCompletion, 'UNAVAILABLE');
assert.deepEqual(sanitizeFieldworkDiagnostics(result, scope), result);
assert.equal(build(fixture(), { iterationCompleted: false }).status, 'IN_PROGRESS');
assert.equal(build(fixture(), { analysisRespondentBase: null }).sources.analysisBaseAlignment, 'NOT_ASSESSED');
const outside = fixture(); outside.outside_initial_base = 1;
result = build(outside, { analysisRespondentBase: 6 });
assert.equal(result.sources.outsideInitialCohort, 'OBSERVED');
assert.equal(result.sources.analysisBaseAlignment, 'MISMATCH');
assert.ok(!Object.hasOwn(result, 'outsideInitialCount'));
assert.ok(result.nextActions.some((note) => note.includes('unmatched')));
// A small outcome suppresses every complementary stage and demographic count.
const small = fixture(); small.outcomes[0].participants = 4; small.outcomes[1].participants = 6;
small.structured_base = 4;
for (const rows of Object.values(small.demographics)) rows.find((row) => row.structured === 5).structured = 4;
result = build(small);
assert.equal(result.status, 'WITHHELD');
assert.equal(result.coverage.selectedBase, null);
assert.equal(result.coverage.yield, null);
assert.ok(result.coverage.stages.every((row) => row.participants === null && row.percentage === null));
assert.ok(result.outcomes.rows.every((row) => row.participants === null && row.percentage === null));
assert.ok(Object.values(result.demographics).every((partition) => partition.rows.length === 0));
// Availability differences themselves are complementary cells.
const complement = fixture(); complement.connected_base = 44;
assert.equal(build(complement).status, 'WITHHELD');
// A demographic may be withheld independently while overall counts remain safe.
const smallGender = fixture(); smallGender.demographics.gender = [
  { category: 'Female', selected: 9, structured: 5 }, { category: 'Male', selected: 41, structured: 0 }];
result = build(smallGender);
assert.equal(result.coverage.status, 'AVAILABLE');
assert.equal(result.demographics.gender.status, 'WITHHELD');
assert.deepEqual(result.demographics.gender.rows, []);
assert.equal(result.demographics.ageBand.status, 'AVAILABLE');
// Invalid demographic sums, raw labels and PII are never exported.
for (const category of ['person@example.com', '+91 99999-99999', 'ABC1234567', scope.iterationId]) {
  const invalid = fixture(); invalid.demographics.mandal[0].category = category;
  result = build(invalid);
  assert.equal(result.demographics.mandal.status, 'NOT_AVAILABLE');
  assert.ok(!JSON.stringify(result.demographics).includes(category));
}
const empty = fixture();
Object.assign(empty, { selected_base: 0, attempted_base: 0, connected_base: 0, structured_base: 0, outcomes: [],
  demographics: { gender: [], ageBand: [], mandal: [] } });
result = build(empty, { analysisRespondentBase: 0 });
assert.equal(result.status, 'AVAILABLE');
assert.equal(result.coverage.selectedBase, 0);
assert.equal(result.coverage.yield, null);
assert.ok(result.outcomes.rows.every((row) => row.participants === 0 && row.percentage === null));
assert.ok(result.demographics.gender.rows.every((row) => row.selected === 0 && row.selectedPct === null));
const unknownFreshness = fixture(); unknownFreshness.observed_at = null;
assert.equal(build(unknownFreshness).observedAt, null);
for (const override of [{ initial_run_count: 0 }, { initial_run_count: 2 }, { initial_contact_count: 0 },
  { initial_null_voter_count: 1 }, { scope_available: false }]) {
  result = build({ ...fixture(), ...override });
  assert.equal(result.reason, 'INITIAL_COHORT_UNAVAILABLE');
  assert.equal(result.coverage.selectedBase, null);
  assert.deepEqual(result.scope, scope);
}
for (const key of ['source_identity_conflicts', 'source_status_conflicts']) {
  assert.equal(build({ ...fixture(), [key]: 1 }).reason, 'SOURCE_INTEGRITY_UNVERIFIED');
}
// Export boundaries do not trust caller claims or supplied percentages/messages.
const raw = build(); raw.phone_number = '9999999999'; raw.limitations.push('person@example.com');
raw.outcomes.rows[0].phone_number = '9999999999'; raw.coverage.yield.percentage = 99;
result = sanitizeFieldworkDiagnostics(raw, scope);
assert.equal(result.coverage.yield.percentage, 10);
assert.ok(!JSON.stringify(result).includes('9999999999'));
assert.ok(!JSON.stringify(result).includes('person@example.com'));
const forged = build(); forged.outcomes.rows[0].participants = 1; forged.outcomes.rows[1].participants = 9;
forged.coverage.stages[3].participants = 1;
for (const partition of Object.values(forged.demographics)) {
  partition.structuredBase = 1;
  partition.rows.find((row) => row.structured === 5).structured = 1;
}
result = sanitizeFieldworkDiagnostics(forged, scope);
assert.equal(result.status, 'WITHHELD');
assert.equal(result.outcomes.base, null);
const inconsistent = build(); inconsistent.coverage.stages[0].participants = 49;
assert.equal(sanitizeFieldworkDiagnostics(inconsistent, scope).status, 'NOT_AVAILABLE');
const otherScope = { ...scope, iterationId: '00000000-0000-4000-8000-000000000003' };
assert.equal(sanitizeFieldworkDiagnostics(build(), otherScope).reason, 'SCOPE_MISMATCH');
assert.deepEqual(sanitizeFieldworkDiagnostics(build(), otherScope).scope, otherScope);
const filteredScope = { ...scope, filters: { ...scope.filters, gender: 'Male' } };
assert.equal(sanitizeFieldworkDiagnostics(build(), filteredScope).reason, 'SCOPE_MISMATCH');
assert.equal(sanitizeFieldworkDiagnostics(build()).reason, 'SCOPE_MISMATCH');
assert.equal(unavailableFieldworkDiagnostics('SOURCE_SCHEMA_UNAVAILABLE', scope).scope.iterationId, scope.iterationId);
// Repository dependency seam has no auth, secret or external-service calls.
let queried = false;
const missing = await loadFieldworkDiagnostics({ query: async () => { queried = true; throw new Error('Must not query'); } }, { campaignId: scope.campaignId });
assert.equal(missing.reason, 'NO_SELECTED_ITERATION'); assert.equal(queried, false);
for (const code of ['42P01', '42703']) {
  result = await loadFieldworkDiagnostics({ query: async () => { throw Object.assign(new Error('Missing schema'), { code }); } }, scope);
  assert.equal(result.reason, 'SOURCE_SCHEMA_UNAVAILABLE'); assert.deepEqual(result.scope, scope);
}
await assert.rejects(() => loadFieldworkDiagnostics({ query: async () => { throw Object.assign(new Error('Access denied'), { code: '42501' }); } }, scope), /Access denied/);
console.log('Fieldwork diagnostic cohort, availability, privacy, scope, suppression, complement and source-schema tests passed.');
