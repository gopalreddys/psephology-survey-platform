import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, "023_quicksight_campaign_reporting.sql"), "utf8");

assert.match(sql, /analytics_campaign_run_dashboard_v1/);
assert.match(sql, /campaign_manager_user_id/);
assert.match(sql, /connection_rate_pct/);
assert.match(sql, /transcript_coverage_pct/);
assert.match(sql, /response_coverage_pct/);
assert.doesNotMatch(sql, /phone_number|full_name|interaction_transcript\s+AS|response_variables\s+AS/);

console.log("Aggregate Analytics reporting view privacy checks passed.");
