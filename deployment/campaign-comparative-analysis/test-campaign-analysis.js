import assert from "node:assert/strict";
import { fixtureState, fixtureDb, iteration, gateRow, response } from "./fixtures/analysis-fixtures.js";
import { loadTestRepositories } from "./fixtures/load-test-repositories.js";

const state = fixtureState();
const db = fixtureDb(state);
const { campaign } = await loadTestRepositories(db);
const admin = { id: "admin", role_code: "ADMIN" };
const getAnalysis = () => campaign.getCampaignAnalysis("campaign", admin);

const eligible = campaign.latestStructuredRespondents(state.records, "i2");
assert.equal(eligible.length, 12, "one connected nonempty structured response per identified voter");
assert.equal(eligible.find((record) => record.voter_id === "female-0").response_variables.graduate_issue_priority, "jobs", "newer ineligible calls do not erase the latest eligible answer");
const subsecond = campaign.latestStructuredRespondents([
  response("i2", "v", "older", { call_id: "z", updated_at: new Date("2026-01-02T00:00:00.100Z") }),
  response("i2", "v", "latest", { call_id: "a", updated_at: new Date("2026-01-02T00:00:00.900Z") })
], "i2");
assert.equal(subsecond[0].response_variables.graduate_issue_priority, "latest", "PostgreSQL Date values preserve millisecond ordering");
const sameUpdate = campaign.latestStructuredRespondents([
  response("i2", "v", "older", { call_id: "z", created_at: "2026-01-01T00:00:00Z" }),
  response("i2", "v", "latest", { call_id: "a", created_at: "2026-01-02T00:00:00Z" })
], "i2");
assert.equal(sameUpdate[0].response_variables.graduate_issue_priority, "latest", "creation time breaks equal update timestamps before UUID");
let result = await getAnalysis();
assert.equal(result.readiness.ready, true);
assert.equal(result.comparison.status, "COMPARABLE");
assert.equal(result.comparison.questions[0].iterations[1].totalRespondents, 12, "duplicate attempts cannot increase an answer base");
assert.ok(result.comparison.questions[0].largestShift);

state.gateRows[1] = gateRow(2, { comparison_status: "NOT_COMPARABLE", comparison_reasons: ["Sampling method changed"] });
result = await getAnalysis();
assert.equal(result.readiness.ready, false, "same questionnaire ID and output key cannot bypass the methods gate");
assert.equal(result.readiness.comparableQuestionCount, 0);
assert.equal(result.readiness.researchDesign, "NOT_ESTABLISHED");
assert.deepEqual(result.comparison.questions[0].movements, []);
assert.equal(result.comparison.questions[0].largestShift, null);
assert.match(result.comparison.questions[0].suppressionReason, /Sampling method changed/);

state.gateRows[1] = gateRow(2);
state.iterations = [iteration(1), iteration(2, "ACTIVE"), iteration(3)];
state.gateRows.push(gateRow(3));
result = await getAnalysis();
assert.equal(result.comparison.previousIteration.id, "i2", "do not skip an unfinished predecessor to compare i1 to i3");
assert.equal(result.comparison.status, "NOT_COMPARABLE");
assert.equal(result.readiness.ready, false);

state.iterations = [iteration(1), iteration(3)];
state.gateRows[2] = gateRow(3, { previous_iteration_id: "i1" });
result = await getAnalysis();
assert.equal(result.comparison.status, "NOT_COMPARABLE", "a missing numeric wave cannot be bridged");
assert.ok(result.comparison.reasons.some((reason) => /missing|gap/.test(reason)));

state.iterations = [iteration(1), iteration(2)];
state.gateRows = [gateRow(1), gateRow(2)];
state.records = ["i1", "i2"].flatMap((id) => Array.from({ length: 4 }, (_, index) => response(id, `voter-${index}`, "jobs")));
result = await getAnalysis();
assert.equal(result.readiness.ready, false, "movement needs n=5 answers in each wave");
assert.equal(result.comparison.questions[0].largestShift, null);
assert.deepEqual(result.comparison.questions[0].iterations[0].values, []);

state.missingGate = true;
result = await getAnalysis();
assert.equal(result.readiness.ready, false, "old schemas fail closed");
assert.equal(result.comparison.questions[0].comparable, false);
assert.ok(result.comparison.reasons.some((reason) => reason.includes("migration 029")));

const queryCount = db.queries.length;
await assert.rejects(campaign.getCampaignAnalysis("campaign", { id: "campaigner", role_code: "CAMPAIGNER" }), (error) => error.statusCode === 403);
assert.equal(db.queries.length, queryCount, "excluded role cannot read campaign evidence");
await assert.rejects(campaign.getCampaignAnalysis("campaign", { id: "outsider", role_code: "CAMPAIGN_MANAGER" }), (error) => error.statusCode === 404);
assert.equal(db.queries.length, queryCount + 1, "unassigned manager cannot read iteration evidence");
console.log("Campaign analysis fixture behavior tests passed.");
