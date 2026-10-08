import assert from "node:assert/strict";
import { fixtureState, fixtureDb, iteration, gateRow } from "../campaign-comparative-analysis/fixtures/analysis-fixtures.js";
import { loadTestRepositories } from "../campaign-comparative-analysis/fixtures/load-test-repositories.js";

const state = fixtureState();
const db = fixtureDb(state);
const { analytics } = await loadTestRepositories(db);
const actor = { id: "admin", role_code: "ADMIN" };
const filters = { gender: "Female", ageBand: "30–39", mandal: "North" };
const getAnalysis = (selection = {}) => analytics.getCampaignStrategicAnalytics("campaign", actor, selection);

const whole = await getAnalysis({ iterationId: "i2" });
const filtered = await getAnalysis({ iterationId: "i2", ...filters });
assert.equal(filtered.segment.respondentBase, 6);
assert.equal(filtered.comparison.status, "COMPARABLE");
assert.deepEqual(filtered.comparison.filters, filters);
assert.deepEqual(filtered.comparison.movements[0].respondentBases.map((base) => base.respondents), [6, 6], "identical gender, age and Mandal filters apply to both waves");
assert.equal(filtered.comparison.movements[0].largestShift.previousPercentage, 100);
assert.equal(filtered.comparison.movements[0].largestShift.latestPercentage, 50);
assert.notDeepEqual(filtered.comparison.movements, whole.comparison.movements, "unfiltered Campaign comparison data must not appear beside filtered distributions");

const run = await getAnalysis({ iterationId: "i2", runId: "run-a", ...filters });
assert.equal(run.scope.operations.callAttempts, 1);
assert.equal(run.scope.insightScope.iterationId, "i2");
assert.equal(run.scope.insightScope.runRestriction, null);
assert.deepEqual(run.scope.insightScope.filters, filters);
for (const key of ["segment", "issueAnalysis", "partyStrengthAnalysis", "sentimentAnalysis", "predictiveAnalysis", "comparison"]) {
  assert.deepEqual(run[key], filtered[key], `${key} remains full-Iteration evidence with active filters when a Run is selected`);
}
await assert.rejects(getAnalysis({ runId: "run-a" }), (error) => error.statusCode === 400 && /Iteration explicitly/.test(error.message));
await assert.rejects(getAnalysis({ iterationId: "i1", runId: "run-a" }), (error) => error.statusCode === 404);
await assert.rejects(getAnalysis({ iterationId: "missing" }), (error) => error.statusCode === 404);
const older = await getAnalysis({ iterationId: "i1" });
assert.equal(older.comparison.latestIteration.id, "i1", "explicit older wave never switches movement to the latest Campaign pair");
assert.equal(older.comparison.previousIteration, null);
assert.equal(older.comparison.status, "NOT_COMPARABLE");

state.gateRows[1] = gateRow(2, { comparison_status: "NOT_COMPARABLE", comparison_reasons: ["Collection mode changed"] });
let result = await getAnalysis({ iterationId: "i2", ...filters });
assert.equal(result.comparison.status, "NOT_COMPARABLE");
assert.equal(result.validity.ready, false);
assert.deepEqual(result.comparison.movements, []);
assert.ok(result.comparison.reasons.includes("Collection mode changed"));

state.gateRows[1] = gateRow(2);
state.records = state.records.filter((record) => !(record.iteration_id === "i1" && ["female-4", "female-5"].includes(record.voter_id)));
result = await getAnalysis({ iterationId: "i2", ...filters });
assert.equal(result.segment.suppressed, false, "latest cohort may be reportable while previous wave is too small");
assert.equal(result.comparison.status, "NOT_COMPARABLE");
assert.deepEqual(result.comparison.movements, [], "n<5 previous cohort suppresses movement");
state.records = state.records.filter((record) => !(record.iteration_id === "i2" && ["female-4", "female-5"].includes(record.voter_id)));
result = await getAnalysis({ iterationId: "i2", ...filters });
assert.equal(result.segment.suppressed, true);
assert.equal(result.segment.respondentBase, null);
assert.deepEqual(result.issueAnalysis.priorities, []);
assert.deepEqual(result.sentimentAnalysis.distribution, []);

state.iterations = [iteration(1), iteration(2, "ACTIVE"), iteration(3)];
state.gateRows.push(gateRow(3));
result = await getAnalysis({ iterationId: "i3" });
assert.equal(result.comparison.previousIteration.id, "i2", "selected wave compares with its actual predecessor");
assert.equal(result.comparison.status, "NOT_COMPARABLE");
assert.deepEqual(result.comparison.movements, []);
state.iterations = [iteration(1, "ACTIVE"), iteration(2, "ACTIVE")];
result = await getAnalysis();
assert.equal(result.scope.iteration, null, "default latest-completed selection does not silently fall back to an active wave");
assert.equal(result.latestIteration, null);
assert.deepEqual(result.issueAnalysis.priorities, []);
console.log("Analytics cohort, comparison and Run-scope fixture tests passed.");
