#!/usr/bin/env node
// Offline definition preparation only. Reuse verified staging datasets; never
// create another dataset generation, refresh data, publish or change permissions.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildGovernedDefinition } from "./quick-publication-definition.mjs";
import { validatePublicationCandidate } from "./quick-publication-plan.mjs";

const [previousPath, outputPath] = process.argv.slice(2);
if (!previousPath || !outputPath || previousPath === outputPath) throw new Error("Usage: node prepare-quick-insights.mjs PREVIOUS_STAGED_BUNDLE_JSON NEW_OUTPUT_JSON");
const previous = JSON.parse(readFileSync(previousPath, "utf8"));
if (!previous.analysisRequest?.AnalysisId || !previous.dashboardRequest?.DashboardId || !previous.manifest?.bindings) throw new Error("Exact saved analysis, dashboard and staged bindings are required");
const existingDefinition = previous.analysisRequest.Definition;
const mapVisual = existingDefinition.Sheets.flatMap((sheet) => sheet.Visuals ?? []).find((visual) => visual.GeospatialMapVisual);
if (!mapVisual) throw new Error("Verified existing geographic map template is required");
const candidate = buildGovernedDefinition({ bindings: previous.manifest.bindings, existingDefinition, mapVisual });
const validation = validatePublicationCandidate(candidate);
if (!validation.valid) throw new Error(`Candidate rejected: ${validation.errors.join("; ")}`);
const bundle = {
  mode: "PREPARED_NOT_APPLIED", datasetRequests: [],
  analysisRequest: { ...previous.analysisRequest, Definition: candidate.definition },
  dashboardRequest: { ...previous.dashboardRequest, Definition: candidate.definition, VersionDescription: "Deeper aggregate survey insights and on-demand measurement guide" },
  manifest: { ...candidate, definition: undefined, validation }
};
writeFileSync(outputPath, JSON.stringify(bundle, null, 2), { flag: "wx" });
console.log(JSON.stringify({ mode: bundle.mode, newDatasets: 0, sheets: candidate.definition.Sheets.map((sheet) => sheet.Name), visuals: candidate.reviewedVisualIds.length, sha256: createHash("sha256").update(readFileSync(outputPath)).digest("hex"), outputPath }, null, 2));
