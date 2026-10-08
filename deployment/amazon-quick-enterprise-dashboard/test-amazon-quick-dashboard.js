import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "024_amazon_quick_research_reporting.sql"), "utf8");
const geographicSql = readFileSync(path.join(here, "025_amazon_quick_geographic_heatmap.sql"), "utf8");
const boundarySql = readFileSync(path.join(here, "026_telangana_administrative_boundaries.sql"), "utf8");
const decisionSql = readFileSync(path.join(here, "027_psephology_decision_reporting.sql"), "utf8");
const comparabilitySql = readFileSync(path.join(here, "028_research_design_comparability.sql"), "utf8");
const sharedGateSql = readFileSync(path.join(here, "029_shared_comparison_gate.sql"), "utf8");
const boundarySync = readFileSync(path.join(here, "sync-telangana-boundaries.js"), "utf8");
const routes = readFileSync(path.join(here, "amazon-quick-dashboard.routes.js"), "utf8");
const installer = readFileSync(path.join(here, "install-amazon-quick-dashboard.js"), "utf8");
const blueprint = JSON.parse(readFileSync(path.join(here, "quick-dashboard-blueprint.json"), "utf8"));

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
assert.match(routes, /analytics_iteration_movement_v1/);
assert.match(routes, /enterprise-dashboard\/research-designs\/\:iterationId/);
assert.match(routes, /permittedSamplingMethods/);
assert.match(routes, /analytics_iteration_comparability_v1/);
assert.match(routes, /analytics_geo_boundary_reference/);
assert.match(installer, /AMAZON_QUICK_ENTERPRISE_DASHBOARD_V1/);
assert.match(installer, /027_psephology_decision_reporting\.sql/);
assert.match(installer, /028_research_design_comparability\.sql/);
assert.match(installer, /029_shared_comparison_gate\.sql/);
assert.match(routes, /independent of embedded Amazon Quick filters/);
assert.match(routes, /positive_sentiment_pct === null \? null/);
assert.equal(blueprint.sheets.length, 5);
assert.equal(blueprint.qualityDatasetView, "analytics_research_quality_v1");
assert.equal(blueprint.movementDatasetView, "analytics_iteration_movement_v1");
assert.equal(blueprint.comparabilityDatasetView, "analytics_iteration_comparability_v1");
assert.ok(blueprint.globalFilters.includes("constituency_name"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "HEAT_TABLE"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "HISTOGRAM"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "GEOSPATIAL_HEATMAP"));
assert.equal(blueprint.governance.minimumCellSize, 5);
assert.ok(blueprint.sheets.find((sheet) => sheet.name === 'Iteration movement').unsupportedFilters.includes('gender'));
assert.equal(blueprint.governance.mapAggregationLevel, "MANDAL");
assert.equal(blueprint.governance.demoConstituency, "AC 52 · Serilingampally");
assert.match(blueprint.governance.qualityStatusMeaning, /not statistical confidence/i);
assert.deepEqual(blueprint.governance.administrativeBoundaryLayers, [
  "STATE", "DISTRICT", "ASSEMBLY_CONSTITUENCY", "MANDAL"
]);

console.log("Amazon Quick enterprise dashboard dataset, embed and blueprint checks passed.");
