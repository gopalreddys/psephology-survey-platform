import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertCallsSchema } from "../campaign-comparative-analysis/fixtures/analysis-fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = await mkdtemp(path.join(os.tmpdir(), "program-comparability-test-"));
try {
  await mkdir(path.join(runtime, "src/repositories"), { recursive: true });
  await mkdir(path.join(runtime, "src/db"), { recursive: true });
  await writeFile(path.join(runtime, "package.json"), '{"type":"module"}');
  await writeFile(path.join(runtime, "src/db/postgres.js"), "export async function getDb() { return globalThis.programComparabilityTestDb; }\n");
  await writeFile(path.join(runtime, "src/repositories/lifecycle-audit.repository.js"), "export async function recordLifecycleEvent() {}\n");
  for (const [source, name] of [
    ["program-dashboard.repository.js", "program-dashboard.repository.js"],
    ["../campaign-draft-privacy/campaign-visibility.repository.js", "campaign-visibility.repository.js"],
    ["../research-comparability/research-comparability.repository.js", "research-comparability.repository.js"],
    ["../campaign-comparative-analysis/campaign-analysis.repository.js", "campaign-analysis.repository.js"],
    ["../output-variable-standardization/output-normalization.repository.js", "output-normalization.repository.js"],
    ["../output-variable-standardization/normalization-rules.json", "normalization-rules.json"]
  ]) await copyFile(path.resolve(here, source), path.join(runtime, "src/repositories", name));

  const { buildProgramComparisonReadiness, getProgramDashboard } = await import(path.join(runtime, "src/repositories/program-dashboard.repository.js"));
  const iteration = (number, completed = true, campaignId = "campaign-visible") => ({
    id: `${campaignId}-wave-${number}`, number, completed,
    questionnaireId: "matching-questionnaire", researchPhase: "PULSE", sampleDesign: "PURPOSIVE"
  });
  const waves = [iteration(1), iteration(2), iteration(3)];
  const metadata = new Map(waves.map((wave, index) => [wave.id, {
    iterationId: wave.id, campaignId: "campaign-visible", iterationNumber: wave.number,
    previousIterationId: index ? waves[index - 1].id : null,
    status: index ? "COMPARABLE" : "BASELINE", reasons: [], designDeclared: true
  }]));
  const respondents = (wave, size, overrides = {}) => Array.from({ length: size }, (_, index) => ({
    call_id: `${wave.id}-call-${index}`, iteration_id: wave.id, voter_id: `voter-${index}`,
    connectivity_status: "connected", response_variables: { issue_priority: "jobs" },
    first_seen_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z", ...overrides
  }));
  const fivePerWave = [...respondents(waves[0], 5), ...respondents(waves[1], 5)];
  const ready = buildProgramComparisonReadiness(waves.slice(0, 2), fivePerWave, metadata);
  assert.equal(ready.comparisonReady, true);
  assert.equal(ready.comparisonStatus, "COMPARABLE");
  assert.equal(ready.comparisonPreviousBase, 5);
  assert.equal(ready.comparisonLatestBase, 5);
  assert.deepEqual(ready.comparisonReasons, []);

  const absent = buildProgramComparisonReadiness(waves.slice(0, 2), fivePerWave, new Map());
  assert.equal(absent.comparisonReady, false, "matching instruments and shared variables cannot replace the authoritative gate");
  assert.match(absent.comparisonReasons.join(" "), /metadata.*unavailable/);
  for (const wave of waves.slice(0, 2)) {
    const undeclared = new Map(metadata);
    undeclared.set(wave.id, { ...metadata.get(wave.id), designDeclared: false });
    assert.equal(buildProgramComparisonReadiness(waves.slice(0, 2), fivePerWave, undeclared).comparisonReady, false, "both waves require declared design");
  }
  const unknown = new Map(metadata);
  unknown.set(waves[1].id, { ...metadata.get(waves[1].id), status: "UNKNOWN" });
  assert.equal(buildProgramComparisonReadiness(waves.slice(0, 2), fivePerWave, unknown).comparisonReady, false);
  const failed = new Map(metadata);
  failed.set(waves[1].id, { ...metadata.get(waves[1].id), status: "NOT_COMPARABLE", reasons: ["Geography changed."] });
  assert.deepEqual(buildProgramComparisonReadiness(waves.slice(0, 2), fivePerWave, failed).comparisonReasons, ["Geography changed."]);

  for (const smallWave of [0, 1]) {
    const records = [0, 1].flatMap((index) => respondents(waves[index], index === smallWave ? 4 : 5));
    const small = buildProgramComparisonReadiness(waves.slice(0, 2), records, metadata);
    assert.equal(small.comparisonReady, false, "four respondents in either wave cannot enable comparison");
    assert.match(small.comparisonReasons.join(" "), /five answered respondents/);
  }
  const incompleteAnswers = buildProgramComparisonReadiness(waves.slice(0, 2), [
    ...respondents(waves[0], 4), ...respondents(waves[0], 1, { voter_id: "different-output", response_variables: { other_output: "water" } }),
    ...respondents(waves[1], 5)
  ], metadata);
  assert.equal(incompleteAnswers.comparisonPreviousBase, 5);
  assert.equal(incompleteAnswers.comparisonReady, false, "the shared question requires five answers, not merely five structured respondents");
  const technicalOnly = buildProgramComparisonReadiness(waves.slice(0, 2), [
    ...respondents(waves[0], 5, { response_variables: { questionnaire_code: "Q1" } }),
    ...respondents(waves[1], 5, { response_variables: { questionnaire_code: "Q1" } })
  ], metadata);
  assert.equal(technicalOnly.comparisonReady, false, "technical context variables are not a reportable shared output");

  const retries = fivePerWave.flatMap((record) => [
    { ...record, call_id: `${record.call_id}-older`, updated_at: "2026-08-31T10:00:00Z" },
    record,
    { ...record, call_id: `${record.call_id}-disconnected`, connectivity_status: "disconnected", updated_at: "2026-09-02T10:00:00Z" },
    { ...record, call_id: `${record.call_id}-empty`, response_variables: {}, updated_at: "2026-09-03T10:00:00Z" }
  ]);
  const retryReady = buildProgramComparisonReadiness(waves.slice(0, 2), retries, metadata);
  assert.equal(retryReady.comparisonReady, true, "later empty or disconnected attempts do not erase eligible structured responses");
  assert.equal(retryReady.comparisonPreviousBase, 5);
  assert.equal(retryReady.comparisonLatestBase, 5);
  const inflatedAttempts = [...respondents(waves[0], 4), ...respondents(waves[0], 4), ...respondents(waves[1], 5)];
  const deduplicated = buildProgramComparisonReadiness(waves.slice(0, 2), inflatedAttempts, metadata);
  assert.equal(deduplicated.comparisonPreviousBase, 4);
  assert.equal(deduplicated.comparisonReady, false, "retries cannot inflate four respondents above the threshold");

  const activeMiddle = buildProgramComparisonReadiness([waves[0], { ...waves[1], completed: false }, waves[2]], [...fivePerWave, ...respondents(waves[2], 5)], metadata);
  assert.equal(activeMiddle.comparisonPreviousIterationId, waves[1].id);
  assert.equal(activeMiddle.comparisonLatestIterationId, waves[2].id);
  assert.equal(activeMiddle.comparisonReady, false, "a completed latest wave cannot bypass its active predecessor");
  assert.match(activeMiddle.comparisonReasons.join(" "), /must be completed/);
  const activeTail = buildProgramComparisonReadiness([waves[0], waves[1], { ...waves[2], completed: false }], fivePerWave, metadata);
  assert.equal(activeTail.comparisonReady, true, "readiness refers to the latest completed pair, matching Campaign Analysis");
  assert.equal(activeTail.comparisonLatestIterationId, waves[1].id);
  const missingWave = buildProgramComparisonReadiness([waves[0], waves[2]], [...respondents(waves[0], 5), ...respondents(waves[2], 5)], metadata);
  assert.equal(missingWave.comparisonReady, false);
  assert.match(missingWave.comparisonReasons.join(" "), /missing|consecutive/);
  assert.equal(buildProgramComparisonReadiness([waves[0]], respondents(waves[0], 5), metadata).comparisonReady, false);
  assert.equal(buildProgramComparisonReadiness([], [], metadata).comparisonReady, false);

  // Exercise authorization and batching through the actual Program repository.
  const requests = [];
  const actor = { id: "admin-1", role_code: "ADMIN" };
  const campaignRow = (id, managerId, creatorId, overrides = {}) => ({
    id, campaign_name: id, campaign_code: id, campaign_manager_user_id: managerId,
    created_by_user_id: creatorId, status: "ACTIVE", iteration_count: 3,
    completed_iteration_count: 3, configured_questionnaire_count: 3,
    run_count: 3, closed_run_count: 3, selected_voters: 15, successful_voters: 15,
    ...overrides
  });
  const secondWaves = [iteration(1, true, "campaign-own"), iteration(2, true, "campaign-own")];
  const ownMetadata = secondWaves.map((wave, index) => ({
    iterationId: wave.id, campaignId: "campaign-own", iterationNumber: wave.number,
    previousIterationId: index ? secondWaves[index - 1].id : null,
    status: index ? "COMPARABLE" : "BASELINE", reasons: [], designDeclared: true
  }));
  const sqlMetadata = [...metadata.values(), ...ownMetadata].map((item) => ({
    iteration_id: item.iterationId, campaign_id: item.campaignId,
    iteration_number: item.iterationNumber, previous_iteration_id: item.previousIterationId,
    comparison_status: item.status, comparison_reasons: item.reasons, design_declared: item.designDeclared
  }));
  let missingSchema = false;
  let noVisibleCampaigns = false;
  globalThis.programComparabilityTestDb = {
    async query(sql, values) {
      assertCallsSchema(sql);
      requests.push({ sql, values });
      if (sql.includes("FROM survey_studies program")) return { rowCount: 1, rows: [{ id: "program-1", study_code: "P1", study_name: "Study", status: "ACTIVE" }] };
      if (sql.includes("WITH campaign_set AS")) return { rows: noVisibleCampaigns
        ? [campaignRow("campaign-private", null, "another-admin")]
        : [campaignRow("campaign-visible", "manager-1", "another-admin"), campaignRow("campaign-own", null, actor.id, { iteration_count: 2, completed_iteration_count: 2 }), campaignRow("campaign-private", null, "another-admin")] };
      if (sql.includes("SELECT link.campaign_id, iteration.id")) return { rows: [...waves, ...secondWaves].map((wave) => ({ id: wave.id, campaign_id: wave.id.startsWith("campaign-own") ? "campaign-own" : "campaign-visible", iteration_number: wave.number, effective_status: "COMPLETED" })) };
      if (sql.includes("FROM analytics_iteration_comparability_v1")) {
        if (missingSchema) throw Object.assign(new Error("missing gate"), { code: "42P01" });
        return { rows: sqlMetadata.filter((item) => values[0].includes(item.iteration_id)) };
      }
      if (sql.includes("SELECT id AS call_id")) return { rows: [...respondents(waves[1], 5), ...respondents(waves[2], 5), ...secondWaves.flatMap((wave) => respondents(wave, 5))] };
      if (sql.includes("FROM operational_lifecycle_events event")) return { rows: [] };
      throw new Error(`Unexpected test query: ${sql}`);
    }
  };
  await assert.rejects(() => getProgramDashboard("program-1", { ...actor, role_code: "CAMPAIGN_MANAGER" }), { statusCode: 403 });
  assert.equal(requests.length, 0, "roles without Program oversight cannot load any data");
  const dashboard = await getProgramDashboard("program-1", actor);
  assert.deepEqual(dashboard.campaigns.map((campaign) => campaign.id), ["campaign-visible", "campaign-own"]);
  assert.equal(dashboard.evidence.comparisonReadyCampaignCount, 2);
  const iterationRequest = requests.find(({ sql }) => sql.includes("SELECT link.campaign_id, iteration.id"));
  assert.deepEqual(iterationRequest.values, [["campaign-visible", "campaign-own"]], "only visible Campaign IDs are used to load Iterations");
  const gateRequests = requests.filter(({ sql }) => sql.includes("FROM analytics_iteration_comparability_v1"));
  const responseRequests = requests.filter(({ sql }) => sql.includes("SELECT id AS call_id"));
  assert.equal(gateRequests.length, 1);
  assert.equal(responseRequests.length, 1);
  assert.deepEqual(gateRequests[0].values, [[waves[1].id, waves[2].id, ...secondWaves.map((wave) => wave.id)]], "the shared gate is loaded once for only each visible Campaign's actual pair");
  assert.deepEqual(responseRequests[0].values, gateRequests[0].values, "response loading uses the same batched pair IDs");
  const lifecycleRequest = requests.find(({ sql }) => sql.includes("FROM operational_lifecycle_events event"));
  assert.deepEqual(lifecycleRequest.values, ["program-1", ["campaign-visible", "campaign-own"]]);
  missingSchema = true;
  assert.equal((await getProgramDashboard("program-1", actor)).evidence.comparisonReadyCampaignCount, 0, "missing migration never falls back to shared output keys");
  noVisibleCampaigns = true;
  const countBeforeEmpty = requests.length;
  const empty = await getProgramDashboard("program-1", actor);
  assert.equal(empty.evidence.comparisonReadyCampaignCount, 0);
  assert.equal(requests.slice(countBeforeEmpty).some(({ sql }) => sql.includes("analytics_iteration_comparability_v1") || sql.includes("SELECT link.campaign_id, iteration.id") || sql.includes("SELECT id AS call_id")), false, "an empty authorized portfolio does not query private comparison evidence");

  // Verify that a runtime installation carries every imported comparison module.
  await writeFile(path.join(runtime, "src/server.js"), 'import campaignsRoutes from "./routes/campaigns.routes.js";\napp.use("/api", campaignsRoutes);\n');
  const runInstaller = promisify(execFile);
  await runInstaller(process.execPath, [path.join(here, "install-program-dashboard.js"), runtime]);
  for (const name of ["research-comparability.repository.js", "campaign-analysis.repository.js"]) {
    const sourceRoot = name.startsWith("research") ? "../research-comparability" : "../campaign-comparative-analysis";
    assert.equal(await readFile(path.join(runtime, "src/repositories", name), "utf8"), await readFile(path.resolve(here, sourceRoot, name), "utf8"));
  }
  await runInstaller(process.execPath, [path.join(here, "install-program-dashboard.js"), runtime]);
  assert.equal(((await readFile(path.join(runtime, "src/server.js"), "utf8")).match(/app\.use\("\/api", programDashboardRoutes\)/g) || []).length, 1, "installer registers the Program route once");
} finally {
  delete globalThis.programComparabilityTestDb;
  await rm(runtime, { recursive: true, force: true });
}

console.log("Program comparison readiness, reporting bases, retries, consecutive pairs, authorization, batched loading and installer behavior passed.");
