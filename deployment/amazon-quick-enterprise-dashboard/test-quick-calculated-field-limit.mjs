// Offline synthetic definitions only: no AWS calls, credentials or survey rows.
import assert from "node:assert/strict";
import { buildGovernedDefinition, pruneUnusedCalculatedFields } from "./quick-publication-definition.mjs";
import { calculatedFieldCounts, MAX_CALCULATED_FIELDS_PER_DATASET, REPORTING_VIEWS, REQUIRED_SHEETS,
  validatePublicationCandidate, validatePublicationReadback } from "./quick-publication-plan.mjs";
import { OUTPUT_KEYS, reportingCategoryLabels } from "../output-variable-standardization/output-normalization.repository.js";

const field = (DataSetIdentifier, Name, Expression) => ({ DataSetIdentifier, Name, Expression });
const graph = {
  CalculatedFields: [field("a", "shown", "{dependent} + 1"), field("a", "dependent", "{cycle}"),
    field("a", "cycle", "{dependent}"), field("a", "unused", "{raw}"),
    field("b", "dependent", "{other_raw}"), field("a", "shared_label", "{raw_label}"),
    field("b", "shared_label", "{other_label}"), field("b", "quoted_reference", '"{dependent}"')],
  Sheets: [{ SyntheticTypedColumn: { DataSetIdentifier: "a", ColumnName: "shown" } }],
  FilterGroups: [{ CrossDataset: "ALL_DATASETS", Filters: [{ CategoryFilter: {
    Column: { DataSetIdentifier: "a", ColumnName: "shared_label" }
  } }] }]
};
const graphBefore = structuredClone(graph);
const pruned = pruneUnusedCalculatedFields(graph);
assert.deepEqual(pruned.CalculatedFields.map((item) => `${item.DataSetIdentifier}.${item.Name}`),
  ["a.shown", "a.dependent", "a.cycle", "a.shared_label", "b.shared_label"],
  "Retain reachable transitive/cyclic dependencies and implicit cross-dataset filter targets; never cross-resolve expression dependencies");
assert.deepEqual(graph, graphBefore, "Pruning never mutates its saved source definition");
assert.throws(() => pruneUnusedCalculatedFields({ ...graph, CalculatedFields: [...graph.CalculatedFields, graph.CalculatedFields[0]] }), /Duplicate calculated-field identity/);
const expressionRoots = {
  CalculatedFields: [field("a", "non_column_calc", "{conditional_dependency} + 1"),
    field("a", "conditional_dependency", "{raw}"), field("b", "non_column_calc", "{other_raw}"),
    field("a", "text_interpolation_calc", "{raw}"), field("b", "text_interpolation_calc", "{other_raw}"),
    field("a", "scoped_calc", "{raw}"), field("b", "scoped_calc", "{other_raw}"), field("a", "unused", "1")],
  Sheets: [{ ConditionalFormatting: { CustomCondition: { Expression: "{non_column_calc} > 0" } },
    TextBoxes: [{ Content: "Recorded base: {text_interpolation_calc}" }],
    SyntheticDatasetScopedExpression: { DataSetIdentifier: "a", Expression: "{scoped_calc} > 0" } }]
};
assert.deepEqual(pruneUnusedCalculatedFields(expressionRoots).CalculatedFields.map((item) => `${item.DataSetIdentifier}.${item.Name}`),
  ["a.non_column_calc", "a.conditional_dependency", "b.non_column_calc", "a.text_interpolation_calc", "b.text_interpolation_calc", "a.scoped_calc"],
  "Non-column conditional formatting and text references retain their dependencies; unknown dataset context conservatively retains every matching field");

const bindings = Object.entries({ ...REPORTING_VIEWS, map: REPORTING_VIEWS.geographic }).map(([role, view]) => ({
  role, view, identifier: role, arn: `arn:aws:quicksight:ap-south-1:123456789012:dataset/fixture-${role}`
}));
const existingDefinition = { Sheets: REQUIRED_SHEETS.map((Name, index) => ({ Name, SheetId: `fixture-${index}`, Visuals: [] })),
  Options: { WeekStart: "MONDAY", QBusinessInsightsStatus: "DISABLED" } };
const mapVisual = { GeospatialMapVisual: { VisualId: "fixture-map", ChartConfiguration: {
  FieldWells: { GeospatialMapAggregatedFieldWells: { Geospatial: [{ GeospatialDimensionField: {
    FieldId: "fixture-latitude", Column: { DataSetIdentifier: "map", ColumnName: "latitude" }
  } }] } }
} } };
const candidate = buildGovernedDefinition({ bindings, existingDefinition, mapVisual });
const { definition } = candidate;
assert.equal(MAX_CALCULATED_FIELDS_PER_DATASET, 500);
assert.equal(calculatedFieldCounts(definition).get("enterprise"), 500);
assert.equal(definition.CalculatedFields.length, 514, "The limit is per dataset, not a combined-array limit");
assert.equal(candidate.reviewedVisualIds.length, 41);
assert.equal(definition.Sheets.length, 6);
assert.deepEqual(validatePublicationCandidate(candidate), { valid: true, errors: [] });
for (const name of ["quick_party_missing_key", "quick_party_missing_respondent_key", "quick_leadership_missing_key",
  "quick_leadership_missing_respondent_key", "quick_issue_missing_key", "quick_issue_missing_respondent_key"]) {
  assert.equal(definition.CalculatedFields.some((item) => item.DataSetIdentifier === "enterprise" && item.Name === name), false,
    `${name}: only unreachable expressions are removed`);
}
for (const name of ["quick_incumbent_missing_key", "quick_incumbent_missing_respondent_key", "quick_candidate_missing_key", "quick_candidate_missing_respondent_key"]) {
  assert.ok(definition.CalculatedFields.some((item) => item.DataSetIdentifier === "enterprise" && item.Name === name),
    `${name}: used missing-answer KPI sources must remain`);
}
for (const name of ["quick_iteration_label", "quick_party_label"]) assert.ok(definition.CalculatedFields.some((item) => item.DataSetIdentifier === "map" && item.Name === name),
  "Implicit map aliases used by ALL_DATASETS filters must remain");
const totalGuard = candidate.partitionGuards.find((guard) => guard.visualId === "quick-unique-respondents");
const evidenceGuard = candidate.partitionGuards.find((guard) => guard.visualId === "quick-evidence-observations");
assert.equal(evidenceGuard.column, totalGuard.column, "Only the two exactly-equivalent total-base guards share a numeric expression");
assert.notEqual(evidenceGuard.id, totalGuard.id, "Every visual retains its own filter identity and scope");
assert.equal(definition.CalculatedFields.some((item) => item.Name === "quick_partition_quick_evidence_observations_safe"), false);
for (const guard of [totalGuard, evidenceGuard]) {
  const group = definition.FilterGroups.find((item) => item.FilterGroupId === `${guard.id}-group`);
  assert.deepEqual(group.ScopeConfiguration.SelectedSheets.SheetVisualScopingConfigurations[0],
    { SheetId: guard.sheetId, Scope: "SELECTED_VISUALS", VisualIds: [guard.visualId] });
  assert.equal(group.Filters[0].NumericRangeFilter.Column.ColumnName, totalGuard.column);
  assert.equal(group.Filters[0].NumericRangeFilter.RangeMinimum.StaticValue, 5);
  assert.equal(group.Filters[0].NumericRangeFilter.AggregationFunction, undefined);
}
const shared = definition.CalculatedFields.find((item) => item.DataSetIdentifier === "enterprise" && item.Name === totalGuard.column);
const otherIndex = reportingCategoryLabels(OUTPUT_KEYS.leadership).indexOf("Other");
assert.ok(shared.Expression.includes(`{quick_partition_leadership_${otherIndex}_all_count}`), "The shared full-partition guard retains aided Other");

const overLimit = structuredClone(candidate);
overLimit.definition.CalculatedFields.push(field("enterprise", "unused_limit_probe", "1"));
assert.match(validatePublicationCandidate(overLimit).errors.join("\n"), /enterprise has 501; maximum 500 per dataset/,
  "Reject an oversized AWS payload before staging, even if its extra field is unused");
assert.equal(validatePublicationReadback({ ResourceStatus: "UPDATE_SUCCESSFUL", Definition: overLimit.definition }, overLimit).valid, false,
  "Readback cannot claim success for an over-limit candidate");
const perDataset = structuredClone(candidate);
for (let index = calculatedFieldCounts(definition).get("geographic"); index < 500; index++) perDataset.definition.CalculatedFields.push(field("geographic", `fixture_limit_${index}`, "1"));
assert.equal(validatePublicationCandidate(perDataset).valid, true, "Five hundred fields in two different datasets are allowed");
const duplicate = structuredClone(candidate);
duplicate.definition.CalculatedFields.push(structuredClone(definition.CalculatedFields.find((item) => item.DataSetIdentifier === "quality")));
assert.match(validatePublicationCandidate(duplicate).errors.join("\n"), /Duplicate calculated-field identity/);
const unsafe = structuredClone(candidate);
unsafe.definition.CalculatedFields.find((item) => item.Name === totalGuard.column).Expression = "5";
assert.equal(validatePublicationCandidate(unsafe).valid, false, "Exact guard expression is independently checked for both visuals; reuse never bypasses privacy validation");
const wrongAlias = structuredClone(candidate);
wrongAlias.partitionGuards.find((guard) => guard.visualId === evidenceGuard.visualId).column = "quick_partition_quick_leadership_count_safe";
assert.equal(validatePublicationCandidate(wrongAlias).valid, false, "A different construct's safe field is not an equivalent whole-partition alias");
const restored = JSON.parse(JSON.stringify(candidate));
assert.deepEqual(validatePublicationReadback({ ResourceStatus: "UPDATE_SUCCESSFUL", Errors: [], Definition: restored.definition }, restored), { valid: true, errors: [] },
  "Strict readback and serialized guard manifests still match without comparator exceptions");
console.log("Quick calculated-field regression passed: per-dataset 500 limit, dependency-safe pruning, exact full-partition alias, 41 visuals and unchanged strict privacy/readback gates.");
