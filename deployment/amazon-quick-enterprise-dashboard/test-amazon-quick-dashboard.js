import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "024_amazon_quick_research_reporting.sql"), "utf8");
const geographicSql = readFileSync(path.join(here, "025_amazon_quick_geographic_heatmap.sql"), "utf8");
const boundarySql = readFileSync(path.join(here, "026_telangana_administrative_boundaries.sql"), "utf8");
const decisionSql = readFileSync(path.join(here, "027_psephology_decision_reporting.sql"), "utf8");
const comparabilitySql = readFileSync(path.join(here, "028_research_design_comparability.sql"), "utf8");
const sharedGateSql = readFileSync(path.join(here, "029_shared_comparison_gate.sql"), "utf8");
const normalizedSql = readFileSync(path.join(here, "030_normalized_output_reporting.sql"), "utf8");
const sentimentSql = readFileSync(path.join(here, "032_sentiment_construct_reporting.sql"), "utf8");
const migrationRunner = readFileSync(path.join(here, "migrate-amazon-quick-dashboard.js"), "utf8");
const boundarySync = readFileSync(path.join(here, "sync-telangana-boundaries.js"), "utf8");
const routes = readFileSync(path.join(here, "amazon-quick-dashboard.routes.js"), "utf8");
const installer = readFileSync(path.join(here, "install-amazon-quick-dashboard.js"), "utf8");
const blueprint = JSON.parse(readFileSync(path.join(here, "quick-dashboard-blueprint.json"), "utf8"));
const enterpriseUi = readFileSync(path.join(here, "../../src/app/enterprise-dashboard/page.tsx"), "utf8");

assert.match(sql, /analytics_research_enterprise_v1/);
for (const dimension of [
  "constituency_name", "mandal_name", "gender", "age_band", "party_salience",
  "candidate_name", "candidate_sentiment", "party_leadership", "direct_party_strength"
]) assert.match(sql, new RegExp(dimension));
assert.doesNotMatch(sql, /phone_number|full_name|epic_number|interaction_transcript\s+AS|response_variables\s+AS/);
assert.match(geographicSql, /analytics_research_geographic_v1/);
assert.match(geographicSql, /respondent_count\s*>=\s*5/);
assert.match(geographicSql, /latitude/);
assert.match(geographicSql, /longitude/);
assert.match(geographicSql, /party_name/);
assert.doesNotMatch(geographicSql, /phone_number|full_name|epic_number|transcript_text/);
assert.match(boundarySql, /analytics_geo_boundary_reference/);
for (const layer of ["STATE", "DISTRICT", "ASSEMBLY_CONSTITUENCY", "MANDAL"]) {
  assert.match(boundarySql, new RegExp(layer));
}
assert.doesNotMatch(boundarySql, /phone_number|full_name|epic_number|transcript_text/);
assert.match(decisionSql, /analytics_research_quality_v1/);
assert.match(decisionSql, /analytics_iteration_movement_v1/);
assert.match(decisionSql, /demographic_completeness_pct/);
assert.match(decisionSql, /DIRECTIONAL_NON_PROBABILITY/);
assert.match(decisionSql, /not statistical confidence/i);
assert.match(decisionSql, /positive_sentiment_change_pct/);
assert.doesNotMatch(decisionSql, /phone_number|full_name|epic_number|transcript_text/);
assert.match(comparabilitySql, /analytics_research_design_registry/);
assert.match(comparabilitySql, /analytics_iteration_comparability_v1/);
assert.match(comparabilitySql, /questionnaire_fingerprint/);
assert.match(comparabilitySql, /comparison_status/);
assert.match(comparabilitySql, /Movement suppressed/);
assert.equal(comparabilitySql.slice(comparabilitySql.indexOf('CREATE OR REPLACE VIEW analytics_iteration_comparability_v1')).trim(), sharedGateSql.slice(sharedGateSql.indexOf('CREATE OR REPLACE VIEW analytics_iteration_comparability_v1')).trim(), 'Replayable 028 and upgrade 029 keep identical view definitions');
assert.match(sharedGateSql, /previous_iteration_id/);
assert.match(sharedGateSql, /previous_evidence_iteration_id IS DISTINCT FROM/);
assert.match(sharedGateSql, /movement\.respondent_base < 5/);
assert.match(sharedGateSql, /previous_direct_measure_base >= 5/);
assert.match(sharedGateSql, /Frozen questionnaire identity is missing/);
assert.doesNotMatch(comparabilitySql, /phone_number|full_name|epic_number|transcript_text/);
assert.match(boundarySync, /tgrac\.telangana\.gov\.in/);
assert.match(boundarySync, /DEMO_CONSTITUENCY = "Serilingampally"/);
assert.match(boundarySync, /DEMO_CONSTITUENCY_NUMBER = "52"/);
assert.match(boundarySync, /startsWith\("serilingampall"\)/);
assert.match(boundarySync, /outSR: "4326"/);
assert.match(boundarySync, /process\.argv\.includes\("--apply"\)/);
assert.match(routes, /GenerateEmbedUrlForRegisteredUserCommand/);
assert.match(routes, /requireRole\(permittedRoles\)/);
assert.match(routes, /\["SUPER_ADMIN", "ADMIN"\]/);
assert.doesNotMatch(routes, /"CAMPAIGN_MANAGER"/);
assert.match(routes, /SessionLifetimeInMinutes: 120/);
assert.match(routes, /AllowedDomains/);
assert.match(routes, /enterprise-dashboard\/geography-boundaries/);
assert.match(routes, /enterprise-dashboard\/research-quality/);
assert.match(routes, /analytics_research_quality_v1/);
assert.match(routes, /analytics_iteration_movement_v2/);
assert.match(routes, /enterprise-dashboard\/research-designs\/\:iterationId/);
assert.match(routes, /saveResearchDesign/);
assert.match(routes, /analytics_research_design_registry_v2/);
assert.match(routes, /analytics_geo_boundary_reference/);
assert.match(installer, /AMAZON_QUICK_ENTERPRISE_DASHBOARD_V1/);
assert.match(installer, /027_psephology_decision_reporting\.sql/);
assert.match(installer, /028_research_design_comparability\.sql/);
assert.match(installer, /029_shared_comparison_gate\.sql/);
assert.match(installer, /030_normalized_output_reporting\.sql/);
assert.match(installer, /031_audited_research_methodology\.sql/);
assert.match(installer, /032_sentiment_construct_reporting\.sql/);
assert.match(migrationRunner, /"031_audited_research_methodology\.sql",\s*"032_sentiment_construct_reporting\.sql"/);
assert.match(routes, /sentimentValidation: getSentimentValidation\(\)/);
assert.match(routes, /Incumbent performance assessment only: incumbent_assessment/);
assert.match(enterpriseUi, /Human review pending/);
assert.match(enterpriseUi, /DEMO · TEST SURVEY EVIDENCE/);
assert.match(enterpriseUi, /Reporting capability preview, not population findings/);
for (const state of ["Not recorded", "Withheld", "Not comparable", "Technical error"]) {
  assert.ok(enterpriseUi.includes(`<dt>${state}</dt>`), `Demo preview explains ${state} separately`);
}
assert.match(enterpriseUi, /A chart design alone does not confirm that collection contract/);
assert.doesNotMatch(enterpriseUi, /Age histogram/);
assert.match(enterpriseUi, /quality\.sentimentValidation\.ruleHash/);
assert.doesNotMatch(enterpriseUi, /This is operational research confidence/);
assert.match(routes, /campaignReviewVisibilitySql/);
assert.match(routes, /declarationComplete/);
assert.match(enterpriseUi, /expectedRevision: editingRevision/);
assert.match(enterpriseUi, /I confirm these entries describe the actual fieldwork/);
assert.match(routes, /independent of embedded Amazon Quick filters/);
assert.match(routes, /positive_sentiment_pct === null \? null/);
assert.equal(blueprint.sheets.length, 5);
assert.equal(blueprint.qualityDatasetView, "analytics_research_quality_v1");
assert.equal(blueprint.datasetView, "analytics_research_enterprise_v2");
assert.equal(blueprint.movementDatasetView, "analytics_iteration_movement_v2");
assert.equal(blueprint.comparabilityDatasetView, "analytics_iteration_comparability_v1");
assert.ok(blueprint.globalFilters.includes("constituency_name"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "HEAT_TABLE"));
const ageBandVisual = blueprint.sheets.find((sheet) => sheet.name === "Demographic pulse").visuals.find((visual) => visual.type === "BAR" && visual.dimension === "age_band");
assert.ok(ageBandVisual, "Discrete age bands use a categorical bar, not a continuous-age histogram");
const partyMap = blueprint.sheets.find((sheet) => sheet.name === "Geographic intelligence").visuals.find((visual) => visual.type === "POINT_MAP");
assert.ok(partyMap, "Saved geographic template is a categorical point map");
assert.equal(partyMap.color, "party_name");
assert.equal(partyMap.size, "sum(respondent_count)");
assert.equal(partyMap.colorConvention, "partyColors");
assert.equal(partyMap.numericPartyStrengthDisplayed, false);
assert.deepEqual(blueprint.partyColors, { BRS: "#E91E8F", BJP: "#FF9933", Congress: "#138808" });
assert.doesNotMatch(JSON.stringify(blueprint.sheets), /HISTOGRAM|GEOSPATIAL_HEATMAP|party_pulse_score|party_strength_change|average_direct_party_strength|direct_party_strength/, "No ambiguous numeric party-strength claim in published visual definitions");
assert.equal(blueprint.governance.minimumCellSize, 5);
assert.ok(blueprint.sheets.find((sheet) => sheet.name === 'Iteration movement').unsupportedFilters.includes('gender'));
assert.equal(blueprint.governance.mapAggregationLevel, "MANDAL");
assert.equal(blueprint.governance.demoConstituency, "AC 52 · Serilingampally");
assert.match(blueprint.governance.qualityStatusMeaning, /not statistical confidence/i);
assert.match(normalizedSql, /analytics_normalize_output_v1/);
assert.match(normalizedSql, /analytics_research_enterprise_v2/);
assert.match(normalizedSql, /analytics_iteration_movement_v2/);
assert.match(normalizedSql, /analytics_research_geographic_v2/);
assert.match(normalizedSql, /sentiment_answer_base >= 5/);
assert.match(normalizedSql, /previous_sentiment_answer_base >= 5/);
assert.match(normalizedSql, /candidate_answer_base >= 5/);
assert.match(normalizedSql, /previous_candidate_answer_base >= 5/);
assert.doesNotMatch(normalizedSql, /AS (?:party_salience|party_leadership|candidate_name|issue_priority|respondent_sentiment)_raw/);
assert.match(normalizedSql, /Raw answers remain only in privileged call records/);
assert.match(normalizedSql, /respondent_sentiment_status/);
assert.match(normalizedSql, /No response/);
assert.doesNotMatch(normalizedSql, /CREATE OR REPLACE VIEW analytics_research_enterprise_v1/);
assert.match(routes, /sentimentAnswerBase: numeric\(row\.sentiment_answer_base\)/);
assert.match(routes, /candidateMissingCount: numeric\(row\.candidate_missing_count\)/);
assert.match(routes, /demographicFieldBase: totals\.respondentBase \* 3/);
assert.match(enterpriseUi, /answer base n=\{item\.sentimentAnswerBase\}/);
assert.match(enterpriseUi, /item\.sentimentMissingCount/);
assert.match(enterpriseUi, /item\.sentimentCantSayCount/);
assert.match(enterpriseUi, /item\.sentimentConstruct/);
assert.match(enterpriseUi, /item\.candidateConstruct/);
assert.equal(blueprint.governance.minimumAnswerBase, 5);
assert.equal(blueprint.governance.sentimentValidationStatus, "HUMAN_REVIEW_PENDING");
assert.equal(blueprint.governance.sentimentMethod, "EXPLICIT_LABEL_MAPPING");
assert.match(blueprint.governance.sentimentConstruct, /incumbent_assessment/);
assert.match(blueprint.governance.candidateConstruct, /Criterion fit is a separate suitability/);
assert.match(blueprint.governance.mixedValueRule, /Mixed is a separate coded category, not Neutral/);
assert.match(sentimentSql, /CREATE OR REPLACE FUNCTION analytics_select_output_v2/);
assert.match(sentimentSql, /ARRAY\['incumbent_assessment'\]\) AS sentiment_normalized/);
assert.match(sentimentSql, /ARRAY\['candidate_impression', 'candidate_sentiment', 'veeresh_impression'\]\) AS assessment_normalized/);
assert.doesNotMatch(sentimentSql, /ARRAY\['issue_sentiment'|ARRAY\['candidate_impression'[^\n]*criterion_fit/);
assert.match(sentimentSql, /contradictory/);
assert.match(sentimentSql, /human review pending/i);
assert.doesNotMatch(sentimentSql, /UPDATE calls|UPDATE program_iterations|UPDATE analytics_research_design_registry/);
for (const visual of blueprint.sheets.flatMap((sheet) => sheet.visuals)) {
  if ([visual.dimension, visual.color, visual.columns].includes("respondent_sentiment")) {
    assert.deepEqual(visual.sourceKeys, ["incumbent_assessment"]);
    assert.ok(visual.categories.includes("Mixed"));
  }
  if (visual.dimension === "candidate_sentiment") {
    assert.deepEqual(visual.sourceKeys, ["candidate_impression", "candidate_sentiment", "veeresh_impression"]);
    assert.ok(visual.categories.includes("Mixed"));
  }
}
assert.match(blueprint.governance.missingValueRule, /No response is distinct from Can't say/);
assert.match(blueprint.governance.nativeAssetPublication, /platform migrations do not refresh or publish Quick assets/);
assert.match(blueprint.governance.nativeAssetPublication, /separately publish the exact verified version/);
for (const sheet of blueprint.sheets.filter((entry) => ["Leadership overview", "Demographic pulse"].includes(entry.name))) {
  for (const visual of sheet.visuals.filter((entry) => ["party_salience", "party_leadership", "candidate_sentiment", "respondent_sentiment"].includes(entry.dimension || entry.color))) {
    assert.ok(visual.answerBase, `${visual.title} must declare the filtered answer denominator`);
    assert.equal(visual.showMissingSeparately, true);
  }
}
const mappingFunctions = routes.slice(routes.indexOf("function numeric("), routes.indexOf("function mapResearchDesign("));
const mapped = runInNewContext(`${mappingFunctions}\nmapMovement(row)`, { row: {
  respondent_base: "10", positive_sentiment_pct: "40.0", negative_sentiment_pct: null,
  candidate_positive_pct: null, average_direct_party_strength: null, party_strength_change: null,
  positive_sentiment_change_pct: "20.0", candidate_positive_change_pct: null,
  sentiment_answer_base: "5", sentiment_missing_count: "5", sentiment_uncoded_count: "1",
  sentiment_cant_say_count: "1", sentiment_refused_count: "0", candidate_answer_base: "4",
  candidate_missing_count: "6", candidate_uncoded_count: "0", candidate_cant_say_count: "0",
  candidate_refused_count: "0", previous_sentiment_answer_base: "5", previous_candidate_answer_base: null,
  percentage_basis: "Recorded answers", comparison_reasons: []
} });
assert.equal(mapped.positiveSentimentPct, 40);
assert.equal(mapped.candidatePositivePct, null, "withheld values never become numeric zero in API mapping");
assert.equal(mapped.negativeSentimentPct, null);
assert.equal(mapped.sentimentAnswerBase, 5);
assert.equal(mapped.sentimentMissingCount, 5);
assert.equal(mapped.sentimentUncodedCount, 1);
assert.equal(mapped.sentimentCantSayCount, 1);
assert.equal(mapped.candidateAnswerBase, 4);
assert.equal(mapped.previousSentimentAnswerBase, 5);
assert.equal(mapped.previousCandidateAnswerBase, null);
assert.equal(mapped.percentageBasis, "Recorded answers");
assert.deepEqual(blueprint.governance.administrativeBoundaryLayers, [
  "STATE", "DISTRICT", "ASSEMBLY_CONSTITUENCY", "MANDAL"
]);

// Exercise installation/reinstallation and the exact installed migration runner
// with a mock database. No live database, cloud assets or provider are contacted.
const runtime = await mkdtemp(path.join(os.tmpdir(), "quick-sentiment-install-"));
try {
  await mkdir(path.join(runtime, "src/db"), { recursive: true });
  await writeFile(path.join(runtime, "package.json"), '{"type":"module"}');
  await writeFile(path.join(runtime, "src/server.js"), 'import votersRoutes from "./routes/voters.routes.js";\napp.use("/api", votersRoutes);\n');
  await writeFile(path.join(runtime, "src/db/postgres.js"), "export async function getDb() { return globalThis.quickMigrationTestDb; }\n");
  const install = promisify(execFile);
  await install(process.execPath, [path.join(here, "install-amazon-quick-dashboard.js"), runtime]);
  await install(process.execPath, [path.join(here, "install-amazon-quick-dashboard.js"), runtime]);
  assert.equal(await readFile(path.join(runtime, "sql/032_sentiment_construct_reporting.sql"), "utf8"), sentimentSql);
  assert.equal(await readFile(path.join(runtime, "src/routes/amazon-quick-dashboard.routes.js"), "utf8"), routes);
  const server = await readFile(path.join(runtime, "src/server.js"), "utf8");
  assert.equal((server.match(/app\.use\("\/api", amazonQuickDashboardRoutes\)/g) || []).length, 1);
  assert.equal((await readdir(path.join(runtime, "src"))).filter((name) => name.includes(".bak-amazon-quick-")).length, 1);
  const queries = [];
  let ended = false;
  globalThis.quickMigrationTestDb = {
    async query(source) { queries.push(source); return { rows: [] }; },
    async end() { ended = true; }
  };
  await import(pathToFileURL(path.join(runtime, "src/db/migrate-amazon-quick-dashboard.js")).href);
  assert.equal(queries.length, 10, "nine ordered migrations plus shared normalizer definition are executed");
  assert.match(queries[6], /CREATE OR REPLACE FUNCTION analytics_normalize_output_v1/);
  assert.equal(queries.at(-2), await readFile(path.join(here, "031_audited_research_methodology.sql"), "utf8"));
  assert.equal(queries.at(-1), sentimentSql, "the sentiment correction always follows the audited methodology gate");
  assert.equal(ended, true);
} finally {
  delete globalThis.quickMigrationTestDb;
  await rm(runtime, { recursive: true, force: true });
}

console.log("Amazon Quick dataset, embed, sentiment construct, pending-review blueprint and installer/runner checks passed.");
