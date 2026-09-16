import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(
  path.join(here, "analytics-workspace.repository.js"),
  "utf8"
);
const routes = readFileSync(path.join(here, "analytics-workspace.routes.js"), "utf8");

assert.match(repository, /campaignReviewVisibilitySql/);
assert.match(repository, /CAMPAIGN_MANAGER/);
assert.match(repository, /callbackCoveragePct/);
assert.match(repository, /transcriptCoveragePct/);
assert.match(repository, /questionnaire_code/);
assert.match(repository, /campaign\.status <> 'ARCHIVED'/);
assert.match(routes, /requireRole\(\["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"\]\)/);
assert.match(routes, /"\/analytics"/);

console.log("Analytics workspace access and evidence tests passed.");
