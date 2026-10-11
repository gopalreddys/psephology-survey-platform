import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { remapHistoricalQuickIdentifiers } from "./remap-historical-quick-identifiers.mjs";
import { validatePublicationCandidate } from "./quick-publication-plan.mjs";

const roles = ["enterprise", "geographic", "movement", "quality", "comparability", "map"];
function fixture() {
  const bindings = roles.map((role) => ({ role, identifier: `Governed ${role}`, arn: `current:${role}`, view: `reviewed:${role}` }));
  const definition = {
    DataSetIdentifierDeclarations: bindings.map(({ identifier, arn }) => ({ Identifier: identifier, DataSetArn: arn })),
    CalculatedFields: bindings.map(({ identifier }) => ({ DataSetIdentifier: identifier, Name: identifier, Expression: `literal '${identifier}'` })),
    Sheets: [{ SheetId: "keep", Name: "Governed enterprise", Visuals: [{ BarChartVisual: { VisualId: "keep", Column: { DataSetIdentifier: "Governed map", ColumnName: "keep" } } }] }],
    Options: { CustomActionDefaults: { highlightOperation: { Trigger: "DATA_POINT_CLICK" } } }
  };
  const bundle = { mode: "PREPARED_NOT_APPLIED", datasetRequests: [],
    analysisRequest: { AnalysisId: "keep-analysis", Definition: structuredClone(definition) },
    dashboardRequest: { DashboardId: "keep-dashboard", VersionDescription: "Keep Governed enterprise", Definition: structuredClone(definition) },
    manifest: { bindings, guards: [{ datasetIdentifier: "Governed enterprise", sourceKey: "respondent_key", partitions: ["gender"], minimum: 5 }],
      filterScopes: [{ dataset: "Governed geographic", column: "campaign_name" }], answerStatusFilters: [{ dataset: "Governed map", excluded: ["MISSING"] }],
      answerBaseGuards: [{ column: "keep" }], measurementNotes: [{ title: "Keep this note" }] }
  };
  const backup = { dashboard: { Definition: { DataSetIdentifierDeclarations: [] } } };
  for (const role of ["enterprise", "geographic", "map"]) {
    backup[role] = { DataSet: { Arn: `historical:${role}` } };
    backup.dashboard.Definition.DataSetIdentifierDeclarations.push({ Identifier: `Historical ${role}`, DataSetArn: `historical:${role}` });
  }
  return { bundle, backup };
}

const { bundle, backup } = fixture();
const originalBundle = structuredClone(bundle), originalBackup = structuredClone(backup);
const result = remapHistoricalQuickIdentifiers(bundle, backup);
assert.deepEqual(bundle, originalBundle, "Input bundle must remain immutable");
assert.deepEqual(backup, originalBackup, "Historical backup must remain immutable");
assert.equal(result.receipt.inverseWholeBundleMatches, true);
assert.equal(result.receipt.cloudChanges, false);
assert.match(result.receipt.inputCanonicalSha256, /^[a-f0-9]{64}$/);
assert.notEqual(result.receipt.inputCanonicalSha256, result.receipt.outputCanonicalSha256);
assert.deepEqual(result.bundle.manifest.bindings.map(({ arn }) => arn), bundle.manifest.bindings.map(({ arn }) => arn));
assert.deepEqual(result.bundle.manifest.bindings.map(({ identifier }) => identifier), ["Historical enterprise", "Historical geographic", "Governed movement", "Governed quality", "Governed comparability", "Historical map"]);
assert.equal(result.bundle.analysisRequest.Definition.CalculatedFields[0].DataSetIdentifier, "Historical enterprise");
assert.equal(result.bundle.analysisRequest.Definition.CalculatedFields[0].Name, "Governed enterprise", "Only typed references may change");
assert.equal(result.bundle.analysisRequest.Definition.CalculatedFields[0].Expression, "literal 'Governed enterprise'", "Formula strings must be preserved");
assert.equal(result.bundle.analysisRequest.Definition.Sheets[0].Name, "Governed enterprise", "Literal titles must be preserved");
assert.equal(result.bundle.dashboardRequest.VersionDescription, "Keep Governed enterprise");
assert.equal(result.bundle.manifest.guards[0].datasetIdentifier, "Historical enterprise");
assert.equal(result.bundle.manifest.filterScopes[0].dataset, "Historical geographic");
assert.equal(result.bundle.manifest.answerStatusFilters[0].dataset, "Historical map");
assert.deepEqual(result.bundle.analysisRequest.Definition.Options, bundle.analysisRequest.Definition.Options);
assert.deepEqual(result.bundle.analysisRequest.Definition, result.bundle.dashboardRequest.Definition, "Both request definitions must retain exact parity");

const automatic = fixture();
automatic.bundle.analysisRequest.Definition.QueryExecutionOptions = { QueryExecutionMode: "AUTO" };
const automaticBefore = structuredClone(automatic.bundle);
const automaticResult = remapHistoricalQuickIdentifiers(automatic.bundle, automatic.backup);
assert.deepEqual(automaticResult.bundle.analysisRequest.Definition.QueryExecutionOptions, { QueryExecutionMode: "AUTO" }, "Approved analysis-only query mode must be preserved");
assert.equal(Object.hasOwn(automaticResult.bundle.dashboardRequest.Definition, "QueryExecutionOptions"), false);
assert.equal(automaticResult.receipt.inverseWholeBundleMatches, true);
assert.deepEqual(automatic.bundle, automaticBefore, "Analysis-only query mode must not weaken input immutability");

for (const [description, mutate] of [
  ["mismatched historical ARN", (_bundle, saved) => { saved.enterprise.DataSet.Arn = "wrong"; }],
  ["ambiguous historical declaration", (_bundle, saved) => { saved.dashboard.Definition.DataSetIdentifierDeclarations.push(structuredClone(saved.dashboard.Definition.DataSetIdentifierDeclarations[0])); }],
  ["alias collision", (_bundle, saved) => { saved.dashboard.Definition.DataSetIdentifierDeclarations[0].Identifier = "Governed movement"; }],
  ["wrong current binding ARN", (draft) => { draft.analysisRequest.Definition.DataSetIdentifierDeclarations[0].DataSetArn = "historical:enterprise"; }],
  ["request-definition parity mismatch", (draft) => { draft.dashboardRequest.Definition.Sheets[0].Name = "Tampered dashboard only"; }],
  ["dashboard query option even AUTO", (draft) => { draft.dashboardRequest.Definition.QueryExecutionOptions = { QueryExecutionMode: "AUTO" }; }],
  ["query option on both definitions", (draft) => {
    for (const request of ["analysisRequest", "dashboardRequest"]) draft[request].Definition.QueryExecutionOptions = { QueryExecutionMode: "AUTO" };
  }],
  ["unapproved analysis MANUAL query mode", (draft) => { draft.analysisRequest.Definition.QueryExecutionOptions = { QueryExecutionMode: "MANUAL" }; }],
  ["extra analysis query option", (draft) => { draft.analysisRequest.Definition.QueryExecutionOptions = { QueryExecutionMode: "AUTO", Unreviewed: true }; }],
  ["missing analysis query mode", (draft) => { draft.analysisRequest.Definition.QueryExecutionOptions = {}; }],
  ["unknown typed reference", (draft) => {
    for (const request of ["analysisRequest", "dashboardRequest"]) draft[request].Definition.CalculatedFields[0].DataSetIdentifier = "unknown";
  }],
  ["unknown metadata reference", (draft) => { draft.manifest.guards[0].datasetIdentifier = "unknown"; }],
  ["unreviewed metadata reference location", (draft) => { draft.manifest.answerBaseGuards[0].datasetIdentifier = "Governed enterprise"; }],
  ["unreviewed metadata alias value", (draft) => { draft.manifest.extra = { source: "Governed enterprise" }; }],
  ["unreviewed metadata array alias value", (draft) => { draft.manifest.extra = ["Governed enterprise"]; }],
  ["unreviewed metadata key even with unknown alias", (draft) => { draft.manifest.extra = { dataset: "unknown" }; }],
  ["duplicate binding role", (draft) => { draft.manifest.bindings[1].role = "enterprise"; }],
  ["duplicate current ARN", (draft) => { draft.manifest.bindings[1].arn = draft.manifest.bindings[0].arn; }],
  ["missing declaration", (draft) => { draft.dashboardRequest.Definition.DataSetIdentifierDeclarations.pop(); }],
  ["missing metadata collection", (draft) => { delete draft.manifest.answerStatusFilters; }],
  ["dataset mutation payload", (draft) => { draft.datasetRequests.push({ operation: "UpdateDataSet" }); }]
]) {
  const { bundle: draft, backup: saved } = fixture();
  mutate(draft, saved);
  const before = structuredClone(draft);
  assert.throws(() => remapHistoricalQuickIdentifiers(draft, saved), undefined, description);
  assert.deepEqual(draft, before, `Rejected ${description} must not mutate input`);
}

const directory = mkdtempSync(join(tmpdir(), "quick-alias-test-"));
const candidatePath = join(directory, "candidate.json"), backupPath = join(directory, "backup.json"), outputPath = join(directory, "remapped.json");
const candidateBytes = JSON.stringify(bundle), backupBytes = JSON.stringify(backup);
writeFileSync(candidatePath, candidateBytes, { flag: "wx" });
writeFileSync(backupPath, backupBytes, { flag: "wx" });
const script = fileURLToPath(new URL("./remap-historical-quick-identifiers.mjs", import.meta.url));
const run = (out) => spawnSync(process.execPath, [script, "--candidate", candidatePath, "--backup", backupPath, "--out", out], { encoding: "utf8" });
const first = run(outputPath);
assert.equal(first.status, 0, first.stderr);
const cliReceipt = JSON.parse(first.stdout);
assert.equal(cliReceipt.cloudChanges, false);
assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), result.bundle);
const outputBytes = readFileSync(outputPath, "utf8");
assert.notEqual(run(outputPath).status, 0, "Existing output must never be overwritten");
assert.equal(readFileSync(outputPath, "utf8"), outputBytes);
assert.notEqual(run(candidatePath).status, 0, "Input overwrite must be rejected");
assert.equal(readFileSync(candidatePath, "utf8"), candidateBytes);
assert.equal(readFileSync(backupPath, "utf8"), backupBytes);

const realCandidatePath = new URL("../../../artifacts/quick-insights-candidate-20261010-friendly-axes.json", import.meta.url);
const realBackupPath = new URL("../../../artifacts/quick-backup-bundle-20261009.json", import.meta.url);
if (existsSync(realCandidatePath) && existsSync(realBackupPath)) {
  const realCandidate = JSON.parse(readFileSync(realCandidatePath, "utf8")), realBackup = JSON.parse(readFileSync(realBackupPath, "utf8"));
  const remapped = remapHistoricalQuickIdentifiers(realCandidate, realBackup);
  assert.deepEqual(remapped.receipt.changes.map(({ to }) => to), ["Psephology Enterprise Research", "Psephology Geographic Party Pulse", "Psephology Geographic Party Pulse Map"]);
  assert.equal(remapped.receipt.inverseWholeBundleMatches, true);
  assert.deepEqual(remapped.bundle.manifest.bindings.map(({ arn }) => arn), realCandidate.manifest.bindings.map(({ arn }) => arn));
  const validation = validatePublicationCandidate({ ...remapped.bundle.manifest, definition: remapped.bundle.dashboardRequest.Definition });
  assert.equal(validation.valid, true, validation.errors.join("; "));
  console.log("Real friendly-axes fixture: six ARNs retained; historical alias inverse verified.");
}
console.log("Historical Quick identifier helper: immutable remap, fail-closed references, inverse proof and exclusive CLI output passed.");
