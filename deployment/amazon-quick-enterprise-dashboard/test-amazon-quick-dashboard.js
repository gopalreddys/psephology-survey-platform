import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "024_amazon_quick_research_reporting.sql"), "utf8");
const geographicSql = readFileSync(path.join(here, "025_amazon_quick_geographic_heatmap.sql"), "utf8");
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
assert.match(routes, /GenerateEmbedUrlForRegisteredUserCommand/);
assert.match(routes, /requireRole\(permittedRoles\)/);
assert.match(routes, /\["SUPER_ADMIN", "ADMIN"\]/);
assert.doesNotMatch(routes, /"CAMPAIGN_MANAGER"/);
assert.match(routes, /SessionLifetimeInMinutes: 120/);
assert.match(routes, /AllowedDomains/);
assert.match(installer, /AMAZON_QUICK_ENTERPRISE_DASHBOARD_V1/);
assert.equal(blueprint.sheets.length, 4);
assert.ok(blueprint.globalFilters.includes("constituency_name"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "HEAT_TABLE"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "HISTOGRAM"));
assert.ok(blueprint.sheets.flatMap((sheet) => sheet.visuals).some((visual) => visual.type === "GEOSPATIAL_HEATMAP"));
assert.equal(blueprint.governance.minimumCellSize, 5);
assert.equal(blueprint.governance.mapAggregationLevel, "MANDAL");

console.log("Amazon Quick enterprise dashboard dataset, embed and blueprint checks passed.");
