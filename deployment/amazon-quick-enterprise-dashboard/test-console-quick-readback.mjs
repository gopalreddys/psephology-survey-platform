import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGovernedDefinition } from "./quick-publication-definition.mjs";
import {
  REPORTING_VIEWS, REQUIRED_SHEETS, prepareConsoleNamespacedCandidate,
  validatePublicationCandidate, validateServiceNormalizedPublicationReadback
} from "./quick-publication-plan.mjs";

// Offline identity review only: never calls AWS or changes a publication gate.
const bindings = Object.entries(REPORTING_VIEWS).map(([role, view]) => ({
  role, view, identifier: role, arn: `arn:aws:quicksight:ap-south-1:123456789012:dataset/${role}`
}));
const source = buildGovernedDefinition({ bindings,
  existingDefinition: { Sheets: REQUIRED_SHEETS.map((Name, index) => ({ SheetId: `fixture-${index}`, Name, Visuals: [] })),
    Options: { WeekStart: "SUNDAY", CustomActionDefaults: { highlightOperation: { Trigger: "DATA_POINT_CLICK" } } } },
  mapVisual: { GeospatialMapVisual: { VisualId: "saved-map", ChartConfiguration: {
    FieldWells: { GeospatialMapAggregatedFieldWells: { Geospatial: [{ GeospatialDimensionField: {
      FieldId: "saved-mandal", Column: { DataSetIdentifier: "geographic", ColumnName: "mandal_name" }
    } }] } }
  } } }
});
const original = structuredClone(source);
const dashboardId = "reviewed-dashboard";
const { candidate, receipt } = prepareConsoleNamespacedCandidate(source, dashboardId);
assert.deepEqual(source, original, "Source must remain immutable");
assert.equal(receipt.cloudChanges, false);
assert.equal(receipt.inverseWholeCandidateMatches, true);
assert.equal(receipt.sheets.length, 6);
assert.equal(receipt.visuals.length, 41);
assert.equal(validatePublicationCandidate(candidate).valid, true);
assert.deepEqual(candidate.definition.DataSetIdentifierDeclarations, source.definition.DataSetIdentifierDeclarations);
assert.deepEqual(candidate.definition.CalculatedFields, source.definition.CalculatedFields, "Formula names, expressions and dataset identities are exact");
assert.deepEqual(candidate.definition.Options, source.definition.Options);
assert.deepEqual(candidate.definition.Sheets.map((sheet) => sheet.TextBoxes), source.definition.Sheets.map((sheet) => sheet.TextBoxes), "Static text is not rewritten");
for (const [index, sheet] of candidate.definition.Sheets.entries()) {
  assert.equal(sheet.SheetId, `${dashboardId}_${source.definition.Sheets[index].SheetId}`);
  assert.equal(sheet.Name, source.definition.Sheets[index].Name);
  for (const [visualIndex, union] of (sheet.Visuals ?? []).entries()) {
    const visual = Object.values(union)[0];
    const old = Object.values(source.definition.Sheets[index].Visuals[visualIndex])[0];
    assert.equal(visual.VisualId, `${dashboardId}_${old.VisualId}`);
    assert.deepEqual(visual.ChartConfiguration, old.ChartConfiguration, "Chart wells, bases, axes, palettes and tooltips must remain exact");
  }
}
const readback = { ResourceStatus: "CREATION_SUCCESSFUL", Errors: [], Definition: structuredClone(candidate.definition) };
assert.equal(validateServiceNormalizedPublicationReadback(readback, candidate).valid, true);
assert.equal(validateServiceNormalizedPublicationReadback(readback, source).valid, false, "Namespacing needs an explicit reviewed expectation");
for (const [name, mutate] of [
  ["foreign sheet reference", (r) => { r.Definition.Sheets[0].SheetId = "foreign"; }],
  ["arbitrary visual prefix", (r) => { Object.values(r.Definition.Sheets[0].Visuals[0])[0].VisualId = "other_prefix"; }],
  ["weakened privacy guard", (r) => { r.Definition.FilterGroups[0].Filters[0].NumericRangeFilter.RangeMinimum.StaticValue = 4; }],
  ["changed calculation", (r) => { r.Definition.CalculatedFields[0].Expression = "0"; }],
  ["removed measurement action", (r) => { Object.values(r.Definition.Sheets[0].Visuals[0])[0].Actions = []; }],
  ["stale dataset", (r) => { r.Definition.DataSetIdentifierDeclarations[0].DataSetArn += "-stale"; }],
  ["missing click highlighting", (r) => { r.Definition.Options.CustomActionDefaults = undefined; }]
]) {
  const tampered = structuredClone(readback);
  mutate(tampered);
  assert.equal(validateServiceNormalizedPublicationReadback(tampered, candidate).valid, false, name);
}
for (const id of [undefined, "", "bad/path", "a".repeat(513), "a".repeat(512)]) {
  assert.throws(() => prepareConsoleNamespacedCandidate(source, id));
}
const unknown = structuredClone(source);
unknown.extra = { TargetSheetId: "unreviewed" };
assert.throws(() => prepareConsoleNamespacedCandidate(unknown, dashboardId), /Unreviewed console reference/);

const artifact = (name) => fileURLToPath(new URL(`../../../artifacts/${name}`, import.meta.url));
const savedCandidate = artifact("quick-insights-candidate-20261010-ui-reviewed-v2.json");
const savedReadback = artifact("quick-insights-published-v7-readback-20261010.json");
if (existsSync(savedCandidate) && existsSync(savedReadback)) {
  const bundle = JSON.parse(readFileSync(savedCandidate));
  const cloud = JSON.parse(readFileSync(savedReadback));
  assert.throws(() => prepareConsoleNamespacedCandidate({ ...bundle.manifest, definition: bundle.dashboardRequest.Definition }, bundle.dashboardRequest.DashboardId), /Whole-partition disclosure guard missing/,
    "Saved version 7 remains historical evidence, not a candidate satisfying the new disclosure policy");
  assert.equal(cloud.summary.Dashboard.Version.VersionNumber, 7);
  assert.equal(cloud.accessUnchanged, true);
  assert.deepEqual(cloud.definition.Errors ?? [], []);
  console.log("Saved version 7 evidence retained with unchanged access; historical disclosure policy is blocked from new promotion.");
}
console.log("Console Quick readback regression checks passed: reversible typed identity mapping and fail-closed content safeguards.");
