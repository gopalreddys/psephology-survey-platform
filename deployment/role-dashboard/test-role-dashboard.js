import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(path.join(here, "dashboard.repository.js"), "utf8");
const routes = readFileSync(path.join(here, "dashboard.routes.js"), "utf8");
const installer = readFileSync(path.join(here, "install-role-dashboard.js"), "utf8");

assert.match(routes, /requireAuth/);
assert.match(routes, /requireRole\(\["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"\]\)/);
assert.match(routes, /"\/dashboard"/);
assert.match(repository, /campaignReviewVisibilitySql\(actor, "campaign", 1\)/);
assert.match(repository, /permitted\.campaigner_user_id = \$1/);
assert.match(repository, /permitted\.iteration_id = iteration\.id OR permitted\.iteration_id IS NULL/);
assert.match(repository, /permitted\.status <> 'REASSIGNED'/);
assert.match(repository, /stale_callbacks/);
assert.match(repository, /missing_transcripts/);
assert.match(repository, /missing_responses/);
assert.match(repository, /iteration\.runs\.length >= 3/);
assert.match(repository, /run\.number === Math\.max\(\.\.\.iteration\.runs/);
assert.doesNotMatch(repository, /phone_number|interaction_transcript\s+AS/);
assert.match(installer, /ROLE_DASHBOARD_V1/);
assert.match(installer, /\.bak-role-dashboard-/);

console.log("Role Dashboard scope, exception and installer checks passed.");
