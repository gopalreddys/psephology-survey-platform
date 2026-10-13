// Offline CLI serialization regression. Synthetic metadata only; no AWS/RDS.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPORTING_VIEWS, REQUIRED_SHEETS, validatePublicationCandidate,
  validatePublicationReadback } from "./quick-publication-plan.mjs";
import { DISCLOSURE_POLICY_VERSION } from "../output-variable-standardization/output-normalization.repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const accountId = "123456789012";
const source = (role) => ({ DataSet: {
  DataSetId: `synthetic-source-${role}`, Name: `Synthetic ${role}`, ImportMode: "SPICE",
  PhysicalTableMap: { source: { CustomSql: {
    DataSourceArn: `arn:aws:quicksight:ap-south-1:${accountId}:datasource/synthetic-source`,
    Name: "Synthetic source", SqlQuery: "SELECT 1", Columns: []
  } } }
} });
const map = { GeospatialMapVisual: {
  VisualId: "synthetic-map-template",
  ChartConfiguration: { FieldWells: { GeospatialMapAggregatedFieldWells: {
    Geospatial: ["latitude", "longitude"].map((name) => ({ GeospatialDimensionField: {
      FieldId: `synthetic-${name}`, Column: { DataSetIdentifier: "synthetic-map", ColumnName: name }
    } })), Colors: [], Values: []
  } } }
} };
const definition = { Sheets: REQUIRED_SHEETS.map((Name, index) => ({
  SheetId: `synthetic-sheet-${index}`, Name,
  Visuals: index === 2 ? [map] : []
})), Options: { QBusinessInsightsStatus: "DISABLED" } };
const backup = {
  dashboard: { DashboardId: "synthetic-existing-dashboard", Name: "Synthetic dashboard", Definition: definition },
  analysis: { AnalysisId: "synthetic-existing-analysis", Name: "Synthetic analysis" },
  enterprise: source("enterprise"), geographic: source("geographic"), map: source("map")
};
// These deliberately minimal schemas cover offline source preparation, not a
// claim of live column compatibility. AWS schema/readback checks remain required.
const schema = [...new Set(Object.values(REPORTING_VIEWS))].flatMap((table_name) => [
  { table_name, name: "campaign_id", data_type: "uuid" },
  { table_name, name: "iteration_id", data_type: "uuid" },
  { table_name, name: "respondent_key", data_type: "text" }
]);
const directory = await mkdtemp(path.join(tmpdir(), "quick-publication-serialization-"));
try {
  const backupPath = path.join(directory, "synthetic-backup.json");
  const schemaPath = path.join(directory, "synthetic-schema.json");
  const outputPath = path.join(directory, "candidate.json");
  await writeFile(backupPath, JSON.stringify(backup));
  await writeFile(schemaPath, JSON.stringify(schema));
  execFileSync(process.execPath, [path.join(here, "prepare-quick-publication.mjs"),
    backupPath, schemaPath, outputPath, "20261013", accountId], { stdio: "pipe" });
  const bundle = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(bundle.mode, "PREPARED_NOT_APPLIED");
  assert.equal(bundle.manifest.disclosurePolicy, DISCLOSURE_POLICY_VERSION);
  assert.ok(bundle.manifest.partitionGuards.length > 0,
    "The saved manifest must retain whole-partition guards, not merely an earlier validation result");
  assert.equal(bundle.dashboardRequest.DashboardId, backup.dashboard.DashboardId);
  assert.equal(bundle.analysisRequest.AnalysisId, backup.analysis.AnalysisId);
  const restored = { definition: bundle.dashboardRequest.Definition, ...bundle.manifest };
  assert.deepEqual(validatePublicationCandidate(restored), { valid: true, errors: [] },
    "A downstream consumer must independently revalidate the serialized bundle");
  assert.equal(validatePublicationReadback({ ResourceStatus: "CREATION_SUCCESSFUL", Errors: [],
    Definition: bundle.dashboardRequest.Definition }, restored).valid, true);
  const incomplete = structuredClone(restored);
  delete incomplete.partitionGuards;
  assert.equal(validatePublicationCandidate(incomplete).valid, false,
    "Retaining an earlier validation receipt cannot replace missing partition metadata");
  const wrongPolicy = structuredClone(restored);
  wrongPolicy.disclosurePolicy = "UNREVIEWED_POLICY";
  assert.equal(validatePublicationCandidate(wrongPolicy).valid, false);
  assert.deepEqual(JSON.parse(await readFile(backupPath, "utf8")), backup,
    "Preparing a candidate never changes the saved recovery input");
  console.log("Prepared Quick bundle retains whole-partition metadata and revalidates after JSON round-trip (offline synthetic inputs only).");
} finally {
  await rm(directory, { recursive: true, force: true });
}
