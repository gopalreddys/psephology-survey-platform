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
assert.match(repository, /getCampaignStrategicAnalytics/);
assert.match(repository, /MLC_QUESTION_CATALOG/);
assert.match(repository, /TRANSCRIPT_THEMES/);
assert.match(repository, /directionalOnly: true/);
assert.match(repository, /loadRunCatalog/);
assert.match(repository, /Run results support execution-quality and retry-cohort diagnosis/);
assert.match(repository, /latestRespondents\(records, selectedIteration\.id, selectedRun\?\.id/);
assert.match(repository, /roleAwareness/);
assert.match(repository, /incumbentAssessment/);
assert.match(repository, /buildIterationDashboard/);
assert.match(repository, /candidateSentiment/);
assert.match(repository, /partyAttention/);
assert.match(repository, /predictiveAssessment/);
assert.match(repository, /Do not infer individual vote choice/);
assert.match(routes, /req\.query\.iterationId/);
assert.match(routes, /req\.query\.runId/);
assert.match(routes, /requireRole\(\["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"\]\)/);
assert.match(routes, /"\/analytics"/);
assert.match(routes, /"\/analytics\/campaigns\/:campaignId"/);

console.log("Analytics workspace access and evidence tests passed.");
