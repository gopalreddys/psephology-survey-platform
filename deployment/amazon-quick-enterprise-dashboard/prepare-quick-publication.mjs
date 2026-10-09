#!/usr/bin/env node
// Offline payload preparation only. This script never connects to AWS/RDS.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildGovernedDefinition } from "./quick-publication-definition.mjs";
import { REPORTING_VIEWS, stagedDatasetRequest, validatePublicationCandidate } from "./quick-publication-plan.mjs";

const [backupPath, schemaPath, outputPath, releaseTag, awsAccountId] = process.argv.slice(2);
if (!backupPath || !schemaPath || !outputPath || !/^\d{8}$/.test(releaseTag ?? "") || !/^\d{12}$/.test(awsAccountId ?? "")) {
  throw new Error("Usage: node prepare-quick-publication.mjs BACKUP_JSON LIVE_SCHEMA_JSON OUTPUT_JSON YYYYMMDD AWS_ACCOUNT_ID");
}
const backup = JSON.parse(readFileSync(backupPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
if (!backup.dashboard?.DashboardId || !backup.analysis?.AnalysisId) throw new Error("Exact dashboard and analysis backups are required");
const roles = [...Object.entries(REPORTING_VIEWS), ["map", REPORTING_VIEWS.geographic]];
const datasetRequests = roles.map(([role, view]) => {
  const columns = schema.filter((column) => column.table_name === view);
  if (columns.length === 0) throw new Error(`Live schema missing ${view}`);
  const source = backup[role === "map" ? "map" : role === "geographic" ? "geographic" : "enterprise"]?.DataSet;
  if (!source) throw new Error(`Dataset source snapshot missing ${role}`);
  const request = stagedDatasetRequest({
    awsAccountId, dataset: source, view, columns,
    newDataSetId: `psephology-governed-${role}-${releaseTag}`,
    name: `Psephology ${role} · governed ${releaseTag}`
  });
  return { role, sourceDataSetId: source.DataSetId, operation: "CreateDataSet", request };
});
const bindings = datasetRequests.map(({ role, request }) => ({
  role, view: role === "map" ? REPORTING_VIEWS.geographic : REPORTING_VIEWS[role],
  identifier: `Governed ${role}`,
  arn: `arn:aws:quicksight:ap-south-1:${awsAccountId}:dataset/${request.DataSetId}`
}));
const mapVisual = backup.dashboard.Definition.Sheets.flatMap((sheet) => sheet.Visuals ?? []).find((visual) => visual.GeospatialMapVisual);
if (!mapVisual) throw new Error("Verified saved geographic map template is required");
const candidate = buildGovernedDefinition({ bindings, existingDefinition: backup.dashboard.Definition, mapVisual });
const validation = validatePublicationCandidate(candidate);
if (!validation.valid) throw new Error(`Candidate rejected: ${validation.errors.join("; ")}`);
const common = { AwsAccountId: awsAccountId, Definition: candidate.definition };
const publishOptions = {
  ...backup.dashboard.DashboardPublishOptions,
  AdHocFilteringOption: { AvailabilityStatus: "DISABLED" },
  ExportToCSVOption: { AvailabilityStatus: "DISABLED" },
  ExportWithHiddenFieldsOption: { AvailabilityStatus: "DISABLED" },
  VisualMenuOption: { AvailabilityStatus: "DISABLED" },
  DataQAEnabledOption: { AvailabilityStatus: "DISABLED" },
  QuickSuiteActionsOption: { AvailabilityStatus: "DISABLED" },
  DataStoriesSharingOption: { AvailabilityStatus: "DISABLED" },
  ExecutiveSummaryOption: { AvailabilityStatus: "DISABLED" },
  SheetControlsOption: { VisibilityState: "EXPANDED" }
};
const bundle = {
  mode: "PREPARED_NOT_APPLIED", releaseTag, datasetRequests,
  analysisRequest: { ...common, AnalysisId: backup.analysis.AnalysisId, Name: backup.analysis.Name, ...(backup.analysis.ThemeArn ? { ThemeArn: backup.analysis.ThemeArn } : {}) },
  dashboardRequest: { ...common, DashboardId: backup.dashboard.DashboardId, Name: backup.dashboard.Name,
    ...(backup.dashboard.ThemeArn ? { ThemeArn: backup.dashboard.ThemeArn } : {}),
    DashboardPublishOptions: publishOptions,
    VersionDescription: `Governed Steps 1–4, distinct-person suppression, fixed constructs and party colors · ${releaseTag}`
  },
  manifest: { bindings, guards: candidate.guards, answerBaseGuards: candidate.answerBaseGuards,
    filterScopes: candidate.filterScopes, coloredVisuals: candidate.coloredVisuals,
    sentimentColoredVisuals: candidate.sentimentColoredVisuals,
    reviewedVisualIds: candidate.reviewedVisualIds, validation }
};
writeFileSync(outputPath, JSON.stringify(bundle, null, 2));
console.log(JSON.stringify({ mode: bundle.mode, datasets: datasetRequests.length,
  sheets: candidate.definition.Sheets.map((sheet) => sheet.Name),
  visuals: candidate.reviewedVisualIds.length,
  sha256: createHash("sha256").update(readFileSync(outputPath)).digest("hex"), outputPath }, null, 2));
