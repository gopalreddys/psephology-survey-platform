// Optional isolated SQL regression. Set PGLITE_MODULE_PATH as for
// test-shared-comparison-gate-sql.js; no live database is contacted.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureState, fixtureDb } from "../campaign-comparative-analysis/fixtures/analysis-fixtures.js";
import { loadTestRepositories, loadTestProgramRepository } from "../campaign-comparative-analysis/fixtures/load-test-repositories.js";

const modulePath = process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : "@electric-sql/pglite");
const engine = new PGlite();
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const waveIds = [uuid(1), uuid(2)];
const voterIds = Array.from({ length: 5 }, (_, index) => uuid(20 + index));
const state = fixtureState();
state.iterations.forEach((iteration, index) => { iteration.id = waveIds[index]; });
state.gateRows.forEach((row, index) => {
  row.iteration_id = waveIds[index];
  row.previous_iteration_id = index ? waveIds[index - 1] : null;
});
const mock = fixtureDb(state);
const evidenceQueries = [];
const db = {
  async query(sql, values) {
    if (/\bSELECT\s+(?:call_record\.)?id\s+AS\s+call_id\b/i.test(sql)) {
      const result = await engine.query(sql, values);
      evidenceQueries.push({ sql, rows: result.rows });
      return result;
    }
    if (sql.includes("FROM survey_studies program")) return { rowCount: 1, rows: [{ id: "program", study_code: "P1", study_name: "Program", status: "ACTIVE" }] };
    if (sql.includes("WITH campaign_set AS")) return { rows: [{
      id: "campaign", campaign_code: "C1", campaign_name: "Campaign", status: "ACTIVE",
      campaign_manager_user_id: "manager", iteration_count: 2, completed_iteration_count: 2,
      configured_questionnaire_count: 2, run_count: 2, closed_run_count: 2
    }] };
    if (sql.includes("SELECT link.campaign_id, iteration.id")) return { rows: waveIds.map((id, index) => ({
      campaign_id: "campaign", id, iteration_number: index + 1, effective_status: "COMPLETED"
    })) };
    if (sql.includes("FROM operational_lifecycle_events event")) return { rows: [] };
    return mock.query(sql, values);
  }
};

try {
  // These are the columns used by evidence queries in the deployed schema.
  // calls intentionally has first_seen_at and no created_at.
  await engine.exec(`
    CREATE TABLE calls (
      id uuid PRIMARY KEY, attempt_id text, iteration_id uuid, run_id uuid, voter_id uuid,
      response_variables jsonb, interaction_transcript jsonb, connectivity_status text,
      duration_seconds numeric, updated_at timestamptz, first_seen_at timestamptz
    );
    CREATE TABLE program_iterations (id uuid PRIMARY KEY, iteration_number integer, iteration_name text);
    CREATE TABLE campaign_runs (id uuid PRIMARY KEY, run_number integer, run_name text);
    CREATE TABLE voter_master (id uuid PRIMARY KEY, is_demo_contact boolean, gender text, age integer, mandal_name_source text);
    CREATE TABLE call_executions (id uuid PRIMARY KEY, provider_attempt_id text, updated_at timestamptz);
  `);
  for (const [index, id] of waveIds.entries()) await engine.query(
    "INSERT INTO program_iterations VALUES ($1, $2, $3)", [id, index + 1, `Wave ${index + 1}`]);
  for (const id of voterIds) await engine.query(
    "INSERT INTO voter_master VALUES ($1, false, 'Female', 35, 'North')", [id]);
  const add = (id, iterationId, voterId, value, updatedAt, firstSeenAt, connectivity = "connected") => engine.query(`
    INSERT INTO calls (id, iteration_id, voter_id, response_variables, connectivity_status, updated_at, first_seen_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
  [uuid(id), iterationId, voterId, JSON.stringify(value), connectivity, updatedAt, firstSeenAt]);
  for (const [waveIndex, waveId] of waveIds.entries()) {
    for (const [voterIndex, voterId] of voterIds.entries()) await add(
      100 + waveIndex * 10 + voterIndex, waveId, voterId, { graduate_issue_priority: "jobs" },
      "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
  }
  await add(500, waveIds[1], voterIds[0], { graduate_issue_priority: "later first seen" }, "2026-01-04T00:00:00Z", "2026-01-03T00:00:00Z");
  await add(501, waveIds[1], voterIds[0], { graduate_issue_priority: "earlier first seen" }, "2026-01-04T00:00:00Z", "2026-01-01T00:00:00Z");
  await add(502, waveIds[1], voterIds[0], {}, "2026-01-06T00:00:00Z", "2026-01-06T00:00:00Z");
  await add(503, waveIds[1], voterIds[0], { graduate_issue_priority: "disconnected" }, "2026-01-07T00:00:00Z", "2026-01-07T00:00:00Z", "disconnected");
  await add(504, waveIds[1], voterIds[0], ["array"], "2026-01-08T00:00:00Z", "2026-01-08T00:00:00Z");
  await add(600, waveIds[1], voterIds[1], { graduate_issue_priority: "lower UUID" }, "2026-01-05T00:00:00Z", "2026-01-04T00:00:00Z");
  await add(601, waveIds[1], voterIds[1], { graduate_issue_priority: "higher UUID" }, "2026-01-05T00:00:00Z", "2026-01-04T00:00:00Z");
  await add(700, waveIds[1], voterIds[2], { graduate_issue_priority: "older fallback" }, null, "2026-01-06T00:00:00Z");
  await add(701, waveIds[1], voterIds[2], { graduate_issue_priority: "later fallback" }, null, "2026-01-07T00:00:00Z");

  const { campaign, analytics } = await loadTestRepositories(db);
  const program = await loadTestProgramRepository(db, campaign);
  const actor = { id: "admin", role_code: "ADMIN" };
  await campaign.getCampaignAnalysis("campaign", actor);
  await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: waveIds[1] });
  await program.getProgramDashboard("program", actor);
  assert.ok(evidenceQueries.some(({ sql }) => sql.includes("execution.id AS execution_id")), "Analytics SQL executes against the real column shape");
  assert.ok(evidenceQueries.some(({ sql }) => /SELECT\s+id\s+AS\s+call_id/i.test(sql)), "Program SQL executes against the real column shape");
  assert.ok(evidenceQueries.some(({ sql }) => sql.includes("SELECT call_record.id AS call_id, call_record.iteration_id")), "Campaign SQL executes against the real column shape");
  for (const { rows } of evidenceQueries) {
    const latest = campaign.latestStructuredRespondents(rows, waveIds[1]);
    assert.equal(latest.length, 5, "retries preserve one eligible structured response per voter");
    assert.equal(latest.find((row) => row.voter_id === voterIds[0]).call_id, uuid(500), "first_seen_at breaks equal updated_at timestamps");
    assert.equal(latest.find((row) => row.voter_id === voterIds[1]).call_id, uuid(601), "UUID breaks ties in both persisted timestamps");
    assert.equal(latest.find((row) => row.voter_id === voterIds[2]).call_id, uuid(701), "first_seen_at orders calls with missing updated_at");
    assert.equal(rows.some((row) => [502, 503, 504].some((id) => row.call_id === uuid(id))), false, "SQL excludes later empty, disconnected and array responses");
  }
  await assert.rejects(engine.query("SELECT created_at FROM calls"), (error) => error.code === "42703");
  console.log("Campaign, Analytics and Program evidence SQL passed against deployed calls timestamps and retry ordering.");
} finally {
  await engine.close();
}
