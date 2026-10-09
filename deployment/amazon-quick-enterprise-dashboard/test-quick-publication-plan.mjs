import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  PARTY_COLORS, SENTIMENT_COLORS, REPORTING_VIEWS, REQUIRED_SHEETS, reportingSelect,
  enterpriseEvidenceSelect, minimumCellFilter, visualPartitionColumns, uniquePersonWindowExpression, partyPalette, applyPartyColors,
  sentimentPalette, applySentimentColors,
  datasetUpdateRequest, validatePublicationCandidate, validatePublicationReadback, executePublication, quickInputColumns, stagedDatasetRequest
} from "./quick-publication-plan.mjs";
import { buildGovernedDefinition, quickTextBoxContent } from "./quick-publication-definition.mjs";

const bindings = Object.entries(REPORTING_VIEWS).map(([role, view]) => ({ role, view, identifier: role, arn: `arn:aws:quicksight:ap-south-1:123456789012:dataset/${role}` }));
function fixture() {
  const definition = {
    DataSetIdentifierDeclarations: bindings.map((item) => ({ Identifier: item.identifier, DataSetArn: item.arn })),
    Sheets: REQUIRED_SHEETS.map((Name, index) => ({ SheetId: `sheet-${index}`, Name, Visuals: [] })),
    FilterGroups: [], CalculatedFields: [{ DataSetIdentifier: "enterprise", Name: "fixture_person_count", Expression: "distinctCountOver({respondent_key}, [{party_salience}], PRE_AGG)" }]
  };
  definition.Sheets[0].Visuals.push({ BarChartVisual: {
    VisualId: "party-count", ChartConfiguration: { FieldWells: { BarChartAggregatedFieldWells: {
      Category: [{ CategoricalDimensionField: { FieldId: "party-dimension", Column: { DataSetIdentifier: "enterprise", ColumnName: "party_salience" } } }],
      Values: [{ CategoricalMeasureField: { FieldId: "observation-count", Column: { DataSetIdentifier: "enterprise", ColumnName: "evidence_key" }, AggregationFunction: "DISTINCT_COUNT" } }]
    } } }
  } });
  const guard = { datasetIdentifier: "enterprise", sheetId: "sheet-0", visualId: "party-count", id: "party-count-min5", column: "fixture_person_count", aggregation: "NONE", sourceKey: "respondent_key", partitions: ["party_salience"] };
  definition.FilterGroups.push(minimumCellFilter(guard));
  return { definition, bindings, guards: [guard], reviewedVisualIds: ["party-count"] };
}

assert.deepEqual(PARTY_COLORS, { BRS: "#E91E8F", BJP: "#FF9933", Congress: "#138808" });
assert.equal(quickTextBoxContent("Words & <value>"), '<text-box><inline font-size="16px">Words &amp; &lt;value&gt;</inline></text-box>', "Use verified AWS textbox tags and escape the literal content");
assert.deepEqual(SENTIMENT_COLORS, { Positive: "#2F7D55", Neutral: "#64748B", Negative: "#C74B50", Mixed: "#805AD5", "Can't say": "#B7791F", "Declined to answer": "#94A3B8", "Uncoded response": "#475569" });
assert.ok(Object.values(SENTIMENT_COLORS).every((value) => !Object.values(PARTY_COLORS).includes(value)), "Party and sentiment colors must remain distinct");
const schema = [{ name: "campaign_id", data_type: "uuid" }, { name: "iteration_id", data_type: "uuid" }, { name: "respondent_key", data_type: "text" }, { name: "party_salience", data_type: "text" }];
assert.match(reportingSelect(REPORTING_VIEWS.enterprise, schema), /"campaign_id"::text AS "campaign_id"/);
assert.match(enterpriseEvidenceSelect(schema), /campaign_id::text \|\| ':' \|\| iteration_id::text \|\| ':' \|\| respondent_key\) AS evidence_key/);
assert.throws(() => reportingSelect("voter_master", schema), /governed/);
assert.throws(() => reportingSelect(REPORTING_VIEWS.enterprise, [{ name: "transcript_text", data_type: "text" }]), /Privileged/);
assert.throws(() => reportingSelect(REPORTING_VIEWS.enterprise, [{ name: "a;DROP", data_type: "text" }]), /Unsafe/);
assert.throws(() => enterpriseEvidenceSelect(schema.filter((item) => item.name !== "iteration_id")), /missing/);

const palette = partyPalette("p", { ChartColor: "#112233", ColorMap: [{ Element: { FieldId: "p", FieldValue: "BRS" }, Color: "#FFFFFF" }, { Element: { FieldId: "other", FieldValue: "BRS" }, Color: "#444444" }] });
assert.equal(palette.ChartColor, "#112233");
assert.equal(palette.ColorMap.length, 4);
assert.equal(palette.ColorMap.find((entry) => entry.Element.FieldId === "p" && entry.Element.FieldValue === "BRS").Color, "#E91E8F");
assert.equal(palette.ColorMap.find((entry) => entry.Element.FieldId === "other").Color, "#444444");
assert.deepEqual(partyPalette("p", palette), palette, "Color patches are idempotent");
const sentimentColors = sentimentPalette("sentiment", { ColorMap: [{ Element: { FieldId: "sentiment", FieldValue: "Positive" }, Color: PARTY_COLORS.Congress }] });
assert.equal(sentimentColors.ColorMap.find((entry) => entry.Element.FieldValue === "Positive").Color, SENTIMENT_COLORS.Positive);
assert.deepEqual(sentimentPalette("sentiment", sentimentColors), sentimentColors, "Sentiment patches are idempotent");
const original = fixture();
const colored = applyPartyColors(original.definition);
assert.equal(colored.colored.length, 1);
assert.equal(original.definition.Sheets[0].Visuals[0].BarChartVisual.ChartConfiguration.VisualPalette, undefined, "The backup object must not be mutated");

const dataset = {
  DataSetId: "same-dataset", Name: "Existing research", ImportMode: "SPICE", Arn: "read-only",
  PhysicalTableMap: { source: { CustomSql: { DataSourceArn: "same-data-source", Name: "old", SqlQuery: "SELECT * FROM analytics_research_enterprise_v1", Columns: [] } } },
  LogicalTableMap: { projection: { Alias: "Original alias", Source: { PhysicalTableId: "source" }, DataTransforms: [{ ProjectOperation: { ProjectedColumns: ["campaign_id"] } }] } },
  RowLevelPermissionDataSet: { Arn: "retain-security", PermissionPolicy: "GRANT_ACCESS", FormatVersion: "VERSION_1" }
};
const update = datasetUpdateRequest({ awsAccountId: "123456789012", dataset, view: REPORTING_VIEWS.enterprise, columns: schema, inputColumns: schema.map((item) => ({ Name: item.name, Type: "STRING" })) });
assert.equal(update.DataSetId, dataset.DataSetId);
assert.equal(update.RowLevelPermissionDataSet.Arn, "retain-security");
assert.equal(update.PhysicalTableMap.source.CustomSql.DataSourceArn, "same-data-source");
assert.ok(update.PhysicalTableMap.source.CustomSql.Columns.some((column) => column.Name === "evidence_key"));
assert.ok(update.LogicalTableMap.projection.DataTransforms[0].ProjectOperation.ProjectedColumns.includes("evidence_key"));
assert.equal(update.Arn, undefined);
assert.equal(dataset.PhysicalTableMap.source.CustomSql.Name, "old");
assert.throws(() => datasetUpdateRequest({ awsAccountId: "123456789012", dataset: { ...dataset, DataPrepConfiguration: {} }, view: REPORTING_VIEWS.enterprise, columns: schema, inputColumns: [] }), /Data Prep/);
const newPrepDataset = { ...structuredClone(dataset), LogicalTableMap: undefined,
  DataPrepConfiguration: { SourceTableMap: { s: { PhysicalTableId: "source" } }, TransformStepMap: { t: { ImportTableStep: { Alias: "Keep source", Source: { SourceTableId: "s" } } } }, DestinationTableMap: { d: { Alias: "Keep destination", Source: { TransformOperationId: "t" } } } },
  SemanticModelConfiguration: { TableMap: { semantic: { Alias: "Keep semantic", DestinationTableId: "d" } } }
};
newPrepDataset.PhysicalTableMap.source.CustomSql.Columns = schema.map((item) => ({ Name: item.name, Type: "STRING", Id: `keep-${item.name}` }));
const newPrepUpdate = datasetUpdateRequest({ awsAccountId: "123456789012", dataset: newPrepDataset, view: REPORTING_VIEWS.enterprise, columns: schema, inputColumns: quickInputColumns(schema) });
assert.deepEqual(newPrepUpdate.DataPrepConfiguration, newPrepDataset.DataPrepConfiguration);
assert.deepEqual(newPrepUpdate.SemanticModelConfiguration, newPrepDataset.SemanticModelConfiguration);
assert.equal(newPrepUpdate.PhysicalTableMap.source.CustomSql.Columns[0].Id, "keep-campaign_id");
assert.equal(newPrepUpdate.LogicalTableMap, undefined);
assert.equal(newPrepUpdate.PhysicalTableMap.source.CustomSql.Columns.at(-1).Id, "quick-v2-evidence-key");
assert.throws(() => quickInputColumns([{ name: "x", data_type: "geometry" }]), /Unsupported/);
const staged = stagedDatasetRequest({ awsAccountId: "123456789012", dataset: newPrepDataset, view: REPORTING_VIEWS.enterprise, columns: schema, newDataSetId: "explicit-staged-enterprise-v2" });
assert.equal(staged.DataSetId, "explicit-staged-enterprise-v2");
assert.equal(newPrepDataset.DataSetId, "same-dataset", "Staging must not mutate the source used by published v1 assets");
assert.throws(() => stagedDatasetRequest({ dataset, newDataSetId: dataset.DataSetId }), /distinct/);

assert.equal(validatePublicationCandidate(fixture()).valid, true);
for (const mutate of [
  (candidate) => { candidate.definition.Sheets.pop(); },
  (candidate) => { candidate.bindings[0].view = "analytics_research_enterprise_v1"; },
  (candidate) => { candidate.definition.FilterGroups[0].Status = "DISABLED"; },
  (candidate) => { candidate.definition.FilterGroups[0].Filters[0].NumericRangeFilter.RangeMinimum.StaticValue = 4; },
  (candidate) => { candidate.definition.FilterGroups[0].Filters[0].NumericRangeFilter.AggregationFunction = {}; },
  (candidate) => { candidate.reviewedVisualIds = []; },
  (candidate) => { candidate.definition.FilterGroups = []; },
  (candidate) => { candidate.definition.FilterGroups.push(structuredClone(candidate.definition.FilterGroups[0])); },
  (candidate) => { candidate.percentagePolicies = [{ visualId: "party-count", basis: "VISIBLE_CELLS", answerBaseVisualId: "party-count", renormalizeVisibleCells: true }]; }
]) {
  const candidate = fixture(); candidate.bindings = structuredClone(bindings); mutate(candidate);
  assert.equal(validatePublicationCandidate(candidate).valid, false, "Publication rejects a broken candidate");
}
assert.throws(() => minimumCellFilter({ datasetIdentifier: "x", sheetId: "s", visualId: "v", id: "g", minimum: 4 }), /lower than five/);
assert.throws(() => minimumCellFilter({ datasetIdentifier: "x", sheetId: "s", visualId: "v", id: "g", column: "respondent_key", aggregation: "DISTINCT_COUNT" }), /numeric.*string/);

const candidate = fixture();
const request = { AwsAccountId: "123456789012", DashboardId: "preserved-dashboard", Name: "Leadership", Definition: candidate.definition };
const stagedUpdate = { ...update, DataSetId: "enterprise" };
const publishedDefinition = { DataSetIdentifierDeclarations: [{ Identifier: "Published enterprise", DataSetArn: "arn:aws:quicksight:ap-south-1:123456789012:dataset/published-enterprise" }] };
const calls = [];
const api = async (name, payload) => {
  calls.push({ name, payload });
  if (name === "UpdateDashboard") return { VersionArn: "arn:aws:quicksight:ap-south-1:123456789012:dashboard/preserved-dashboard/version/12" };
  if (name === "DescribeDashboardDefinition" && payload.VersionNumber) return { ResourceStatus: "CREATION_SUCCESSFUL", Errors: [], Definition: candidate.definition };
  if (name === "DescribeDashboardDefinition" && payload.AliasName === "$PUBLISHED") return { ResourceStatus: "CREATION_SUCCESSFUL", Errors: [], Definition: publishedDefinition };
  return { Status: 200 };
};
let backups = 0;
const backup = async (_snapshot, plan) => { backups++; return { durable: true, path: "/backup/frozen-definitions.json", sha256: plan.sha256 }; };
const verify = async ({ versionNumber }) => ({ status: "VERIFIED", versionNumber });
const dryRun = await executePublication({ request, candidate, datasets: [stagedUpdate], api, backup, verify, expectedDashboardId: request.DashboardId });
assert.equal(dryRun.mode, "DRY_RUN"); assert.equal(calls.length, 0); assert.equal(backups, 0);
await assert.rejects(() => executePublication({ request, candidate, apply: true, api, verify, backup: async () => ({ durable: false }), expectedDashboardId: request.DashboardId }), /durable backup/);
assert.equal(calls.some((call) => call.name.startsWith("Update")), false, "No mutation when backup failed");
calls.length = 0;
const unpublished = await executePublication({ request, candidate, datasets: [stagedUpdate], apply: true, api, backup, verify, expectedDashboardId: request.DashboardId });
assert.equal(unpublished.status, "VERIFIED_UNPUBLISHED");
assert.deepEqual(calls.map((call) => call.name), ["DescribeDashboard", "DescribeDashboardDefinition", "DescribeDataSet", "UpdateDataSet", "UpdateDashboard", "DescribeDashboardDefinition"]);
calls.length = 0;
const published = await executePublication({ request, candidate, apply: true, publish: true, api, backup, verify, expectedDashboardId: request.DashboardId });
assert.equal(published.versionNumber, 12);
assert.equal(calls.at(-1).name, "UpdateDashboardPublishedVersion");
assert.equal(calls.at(-1).payload.DashboardId, "preserved-dashboard");
assert.equal(calls.at(-1).payload.VersionNumber, 12);
calls.length = 0;
await assert.rejects(() => executePublication({ request, candidate, apply: true, publish: true, api, backup, verify: async () => ({ status: "FAILED", versionNumber: 12 }), expectedDashboardId: request.DashboardId }), /Live verification/);
assert.equal(calls.some((call) => call.name === "UpdateDashboardPublishedVersion"), false);
await assert.rejects(() => executePublication({ request, candidate, expectedDashboardId: "another-dashboard" }), /identity/);
const staleReadback = { ResourceStatus: "CREATION_SUCCESSFUL", Definition: structuredClone(candidate.definition), Errors: [{ Type: "COLUMN_NOT_FOUND" }] };
staleReadback.Definition.DataSetIdentifierDeclarations[0].DataSetArn = "arn:old-dataset";
assert.equal(validatePublicationReadback(staleReadback, candidate).valid, false, "Build success must not hide column errors or stale bindings");
calls.length = 0;
await assert.rejects(() => executePublication({ request, candidate, apply: true, publish: true, backup, verify, expectedDashboardId: request.DashboardId,
  api: async (name, payload) => name === "DescribeDashboardDefinition" && payload.VersionNumber ? staleReadback : api(name, payload)
}), /Dashboard readback rejected/);
assert.equal(calls.some((call) => call.name === "UpdateDashboardPublishedVersion"), false, "Never publish a version with failed readback, even when the verification callback says VERIFIED");

for (const mutation of [
  (definition) => { definition.FilterGroups[0].Status = "DISABLED"; },
  (definition) => { definition.FilterGroups[0].Filters[0].NumericRangeFilter.RangeMinimum.StaticValue = 4; },
  (definition) => { definition.CalculatedFields[0].Expression = "1"; },
  (definition) => { definition.Sheets[0].Visuals[0].BarChartVisual.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Values[0].CategoricalMeasureField.AggregationFunction = "COUNT"; },
  (definition) => { [definition.DataSetIdentifierDeclarations[0].DataSetArn, definition.DataSetIdentifierDeclarations[1].DataSetArn] = [definition.DataSetIdentifierDeclarations[1].DataSetArn, definition.DataSetIdentifierDeclarations[0].DataSetArn]; }
]) {
  const actual = structuredClone(candidate.definition); mutation(actual);
  const readback = { ResourceStatus: "CREATION_SUCCESSFUL", Errors: [], Definition: actual };
  assert.equal(validatePublicationReadback(readback, candidate).valid, false, "Matching IDs cannot hide altered bindings, formulas or safeguards");
  calls.length = 0;
  await assert.rejects(() => executePublication({ request, candidate, apply: true, publish: true, backup, verify, expectedDashboardId: request.DashboardId,
    api: async (name, payload) => name === "DescribeDashboardDefinition" && payload.VersionNumber ? readback : api(name, payload)
  }), /Dashboard readback rejected/);
  assert.equal(calls.some((call) => call.name === "UpdateDashboardPublishedVersion"), false);
}
for (const unsafeUpdate of [update, { ...stagedUpdate, AwsAccountId: "999999999999" }]) {
  calls.length = 0;
  await assert.rejects(() => executePublication({ request, candidate, datasets: [unsafeUpdate], apply: true, api, backup, verify, expectedDashboardId: request.DashboardId }), /Staged dataset update/);
  assert.equal(calls.some((call) => call.name.startsWith("Update")), false);
}
calls.length = 0;
await assert.rejects(() => executePublication({ request, candidate, datasets: [stagedUpdate], apply: true, api: async (name, payload) => {
  if (name === "DescribeDashboardDefinition" && payload.AliasName === "$PUBLISHED") return { Definition: candidate.definition };
  return api(name, payload);
}, backup, verify, expectedDashboardId: request.DashboardId }), /Cannot mutate a dataset used by the published dashboard/);
assert.equal(calls.some((call) => call.name.startsWith("Update")), false, "A failed staging attempt cannot alter the published version's source datasets");

const generated = buildGovernedDefinition({ bindings, existingDefinition: fixture().definition });
const alteredAnswerCalculation = structuredClone(generated.definition);
alteredAnswerCalculation.CalculatedFields.find((field) => field.Name === "quick_incumbent_answer_key").Expression = "{evidence_key}";
assert.equal(validatePublicationReadback({ ResourceStatus: "CREATION_SUCCESSFUL", Errors: [], Definition: alteredAnswerCalculation }, generated).valid, false, "Missing answers cannot be included through an altered same-name calculation");
const badTextBox = structuredClone(generated);
badTextBox.definition.Sheets[0].TextBoxes[0].Content = "<text><p>Incorrect root</p></text>";
assert.equal(validatePublicationCandidate(badTextBox).valid, false, "The service-rejected text root must not recur");
assert.equal(generated.definition.Options.QBusinessInsightsStatus, "DISABLED", "Absent insights configuration cannot default-enable unrelated features");
const savedOptions = { WeekStart: "SUNDAY", QBusinessInsightsStatus: "DISABLED", ExcludedDataSetArns: ["arn:excluded"], CustomActionDefaults: { highlightOperation: { Trigger: "DATA_POINT_CLICK" } } };
const optionsFixture = fixture().definition;
optionsFixture.Options = structuredClone(savedOptions);
const optionsCandidate = buildGovernedDefinition({ bindings, existingDefinition: optionsFixture });
assert.deepEqual(optionsCandidate.definition.Options, savedOptions, "Saved insight, action and exclusion options are preserved exactly");
assert.deepEqual(optionsFixture.Options, savedOptions, "Saved backup options are not mutated");
assert.equal(validatePublicationCandidate(generated).valid, true, JSON.stringify(validatePublicationCandidate(generated).errors));
assert.equal(generated.definition.Sheets.length, 5);
assert.equal(generated.definition.Sheets[0].SheetId, "sheet-0");
const generatedGroupIds = generated.definition.FilterGroups.map((group) => group.FilterGroupId);
const generatedFilterIds = generated.definition.FilterGroups.flatMap((group) => group.Filters.map((filter) => Object.values(filter)[0].FilterId));
assert.equal(new Set(generatedGroupIds).size, generatedGroupIds.length, "Filter group IDs must be globally unique");
assert.equal(new Set(generatedFilterIds).size, generatedFilterIds.length, "Filter IDs must be globally unique");
for (const visualId of ["quick-incumbent-movement", "quick-candidate-movement"]) {
  const movementGuards = generated.guards.filter((guard) => guard.visualId === visualId);
  assert.equal(movementGuards.length, 2);
  assert.notEqual(movementGuards[0].id, movementGuards[1].id, "Current and previous answer-base guards cannot reuse an ID");
  assert.ok(movementGuards.every((guard) => guard.id.includes(guard.column)));
}
const assertNonMissingMapFilter = (candidate, visualId, dataset) => {
  const group = candidate.definition.FilterGroups.find((item) => item.ScopeConfiguration?.SelectedSheets?.SheetVisualScopingConfigurations?.some((scope) => scope.VisualIds?.includes(visualId)) && item.Filters?.some((filter) => filter.CategoryFilter?.Column.ColumnName === "party_answer_status"));
  assert.ok(group, `Missing-answer safeguard is required for ${visualId}`);
  assert.equal(group.Status, "ENABLED"); assert.equal(group.CrossDataset, "SINGLE_DATASET");
  const filter = group.Filters.find((item) => item.CategoryFilter)?.CategoryFilter;
  assert.equal(filter.Column.DataSetIdentifier, dataset);
  assert.deepEqual(filter.Configuration, { CustomFilterConfiguration: { MatchOperator: "DOES_NOT_EQUAL", CategoryValue: "MISSING", NullOption: "NON_NULLS_ONLY" } }, "Use the service-supported custom equality filter; exclude only missing, never uncertainty/refusal/uncoded categories");
};
assertNonMissingMapFilter(generated, "quick-map-evidence-table", "geographic");
const rejectedListVariant = structuredClone(generated);
const rejectedCategory = rejectedListVariant.definition.FilterGroups.flatMap((group) => group.Filters).find((filter) => filter.CategoryFilter?.Column.ColumnName === "party_answer_status").CategoryFilter;
rejectedCategory.Configuration = { FilterListConfiguration: { MatchOperator: "DOES_NOT_EQUAL", CategoryValues: ["MISSING"], NullOption: "NON_NULLS_ONLY" } };
assert.equal(validatePublicationCandidate(rejectedListVariant).valid, false, "SDK enum support does not override the actual service list-operator restriction");
const missingStatusGuard = structuredClone(generated);
missingStatusGuard.definition.FilterGroups = missingStatusGuard.definition.FilterGroups.filter((group) => !group.Filters.some((filter) => filter.CategoryFilter?.Column.ColumnName === "party_answer_status"));
assert.equal(validatePublicationCandidate(missingStatusGuard).valid, false, "Geographic missing-answer protection cannot be silently dropped");
assert.ok(generated.reviewedVisualIds.includes("quick-comparability-registry"));
assert.equal(generated.definition.CalculatedFields.find((field) => field.Name === "quick_declaration_status").Expression, "ifelse({design_declared} = 1, 'Declared', 'Undeclared')", "SPICE-promoted Boolean declarations use explicit integer comparison, never infer declaration from sampling labels");
assert.ok(generated.definition.CalculatedFields.some((item) => item.Expression === "distinctCountOver({quick_incumbent_answer_key}, [], PRE_AGG)"));
assert.ok(generated.definition.CalculatedFields.some((item) => item.Name === "quick_connection_pct" && item.Expression.includes("sum({connected_calls}) / sum({call_attempts})")));
assert.ok(generated.definition.CalculatedFields.every((item) => !item.Expression.includes("PRE_FILTER")), "Filtered bases cannot use a pre-filter denominator");
const incumbentPie = generated.definition.Sheets[0].Visuals.find((union) => union.PieChartVisual?.VisualId === "quick-incumbent-count").PieChartVisual;
assert.deepEqual(incumbentPie.ChartConfiguration.VisualPalette.ColorMap.map((entry) => [entry.Element.FieldValue, entry.Color]), Object.entries(SENTIMENT_COLORS));
assert.ok(generated.sentimentColoredVisuals.some((item) => item.visualId === "quick-candidate-count"));
assert.ok(generated.sentimentColoredVisuals.some((item) => item.visualId === "quick-age-incumbent"));
assert.equal(generated.coloredVisuals.some((item) => item.visualId === "quick-incumbent-count"), false, "Party palette cannot leak into incumbent sentiment");
assert.deepEqual(applySentimentColors(generated.definition).definition, generated.definition, "A generated sentiment palette is stable on reapplication");
assert.equal(incumbentPie.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.Values[0].CategoricalMeasureField.Column.ColumnName, "quick_incumbent_answer_key", "Missing answers cannot inflate a construct distribution");
const incumbentGuard = generated.guards.find((guard) => guard.visualId === "quick-incumbent-count");
assert.equal(incumbentGuard.sourceKey, "quick_incumbent_respondent_key", "Privacy is based on distinct people, not repeated-wave observations");
assert.equal(incumbentGuard.aggregation, "NONE", "Filter operates on the numeric PRE_AGG window, not a STRING key aggregation");
const enterpriseGuards = generated.guards.filter((guard) => guard.datasetIdentifier === "enterprise");
for (const guard of enterpriseGuards) {
  const visual = generated.definition.Sheets.find((sheet) => sheet.SheetId === guard.sheetId).Visuals.map((union) => Object.values(union)[0]).find((item) => item.VisualId === guard.visualId);
  assert.deepEqual(guard.partitions, visualPartitionColumns(visual, "enterprise"));
  assert.equal(generated.definition.CalculatedFields.find((field) => field.Name === guard.column).Expression, uniquePersonWindowExpression(guard.sourceKey, guard.partitions));
  assert.match(guard.sourceKey, /respondent_key$/);
  assert.doesNotMatch(guard.sourceKey, /evidence|answer_key/);
  const filter = generated.definition.FilterGroups.flatMap((group) => group.Filters).find((item) => item.NumericRangeFilter?.FilterId === guard.id).NumericRangeFilter;
  assert.equal(filter.AggregationFunction, undefined);
}
for (const [visualId, partitions] of [
  ["quick-unique-respondents", []], ["quick-incumbent-count", ["respondent_sentiment"]],
  ["quick-age-incumbent", ["age_band", "respondent_sentiment"]],
  ["quick-gender-party", ["gender", "party_salience"]],
  ["quick-mandal-party-heat", ["mandal_name", "party_salience"]],
  ["quick-constituency-incumbent", ["constituency_name", "respondent_sentiment"]]
]) assert.deepEqual(enterpriseGuards.find((guard) => guard.visualId === visualId).partitions, partitions);
for (const [visualId, observationKey] of [
  ["quick-unique-respondents", "respondent_key"], ["quick-evidence-observations", "evidence_key"],
  ["quick-incumbent-answer-base", "quick_incumbent_answer_key"], ["quick-candidate-answer-base", "quick_candidate_answer_key"],
  ["quick-incumbent-missing", "quick_incumbent_missing_key"], ["quick-candidate-missing", "quick_candidate_missing_key"]
]) {
  const visual = generated.definition.Sheets[0].Visuals.find((union) => union.KPIVisual?.VisualId === visualId).KPIVisual;
  const guard = enterpriseGuards.find((item) => item.visualId === visualId);
  const value = visual.ChartConfiguration.FieldWells.Values[0].NumericalMeasureField;
  assert.ok(value, "Suppressed KPI uses a nullable numeric measure, not COUNT of an empty set");
  assert.equal(value.AggregationFunction.SimpleNumericalAggregation, "MIN");
  assert.equal(generated.definition.CalculatedFields.find((field) => field.Name === value.Column.ColumnName).Expression, `ifelse({${guard.column}} >= 5, distinctCountOver({${observationKey}}, [], PRE_AGG), NULL)`);
}
const protectedKpiReference = (people, observations) => people >= 5 ? observations : null;
assert.equal(protectedKpiReference(0, 0), null);
assert.equal(protectedKpiReference(4, 12), null, "Four people in repeated waves must not turn withholding into zero or 12");
assert.equal(protectedKpiReference(17, 17), 17);
assert.equal(protectedKpiReference(17, 48), 48, "Unique respondent and respondent–Iteration counts remain distinct");
for (const mutate of [
  (candidate, value) => { candidate.definition.CalculatedFields.find((field) => field.Name === value.Column.ColumnName).Expression = candidate.definition.CalculatedFields.find((field) => field.Name === value.Column.ColumnName).Expression.replace("NULL)", "0)"); },
  (_candidate, value) => { value.AggregationFunction.SimpleNumericalAggregation = "SUM"; }
]) {
  const candidate = structuredClone(generated);
  const value = candidate.definition.Sheets[0].Visuals.find((union) => union.KPIVisual?.VisualId === "quick-incumbent-answer-base").KPIVisual.ChartConfiguration.FieldWells.Values[0].NumericalMeasureField;
  mutate(candidate, value);
  assert.equal(validatePublicationCandidate(candidate).valid, false, "Protected KPIs cannot reintroduce zero substitution or sum duplicated window values");
}
for (const mutate of [
  (candidate, guard) => { candidate.definition.CalculatedFields.find((field) => field.Name === guard.column).Expression = uniquePersonWindowExpression("evidence_key", guard.partitions); },
  (candidate, guard) => { candidate.definition.CalculatedFields.find((field) => field.Name === guard.column).Expression = uniquePersonWindowExpression(guard.sourceKey, guard.partitions).replace("PRE_AGG", "PRE_FILTER"); },
  (candidate, guard) => { guard.partitions = []; candidate.definition.CalculatedFields.find((field) => field.Name === guard.column).Expression = uniquePersonWindowExpression(guard.sourceKey, []); },
  (candidate, guard) => { candidate.definition.CalculatedFields.find((field) => field.Name === guard.sourceKey).Expression = "{respondent_key}"; }
]) {
  const candidate = structuredClone(generated);
  mutate(candidate, candidate.guards.find((guard) => guard.visualId === "quick-age-incumbent"));
  assert.equal(validatePublicationCandidate(candidate).valid, false, "Reject observation keys, pre-filter/pool leakage and missing-answer source leakage");
}
const repeatedWaves = [1, 2, 3].flatMap((iteration) => ["person-a", "person-b"].map((person) => ({ evidence_key: `${iteration}:${person}`, respondent_key: person })));
assert.equal(new Set(repeatedWaves.map((item) => item.evidence_key)).size, 6);
assert.equal(new Set(repeatedWaves.map((item) => item.respondent_key)).size >= 5, false, "Two respondents in three waves cannot meet a five-person cell guard");
const referenceCellPeople = (rows, guard) => {
  const groups = new Map();
  for (const row of rows) {
    const cell = JSON.stringify(guard.partitions.map((column) => row[column]));
    if (!groups.has(cell)) groups.set(cell, new Set());
    if (row[guard.sourceKey] !== null && row[guard.sourceKey] !== undefined) groups.get(cell).add(row[guard.sourceKey]);
  }
  return [...groups.values()].map((people) => people.size);
};
const ageGuard = enterpriseGuards.find((guard) => guard.visualId === "quick-age-incumbent");
const splitCategoryPeople = Array.from({ length: 6 }, (_, index) => ({ age_band: "30–39", respondent_sentiment: index < 3 ? "Positive" : "Negative", quick_incumbent_respondent_key: `person-${index}` }));
assert.deepEqual(referenceCellPeople(splitCategoryPeople, ageGuard), [3, 3], "Six people across two color cells cannot expose two three-person cells");
const missingAnswers = Array.from({ length: 5 }, (_, index) => ({ respondent_sentiment: "No response", respondent_key: `person-${index}`, quick_incumbent_respondent_key: null }));
assert.deepEqual(referenceCellPeople(missingAnswers, incumbentGuard), [0], "Null conditional keys produce zero, not a reportable No response distribution");
const missingCardGuard = enterpriseGuards.find((guard) => guard.visualId === "quick-incumbent-missing");
assert.equal(missingCardGuard.sourceKey, "quick_incumbent_missing_respondent_key");
assert.deepEqual(missingCardGuard.partitions, [], "Separate missing card counts missing people across the selected scope only");
assert.ok(generated.coloredVisuals.some((item) => item.visualId === "quick-party-count"));
assert.equal(generated.filterScopes.some((scope) => scope.sheetId === "sheet-3" && ["gender", "age_band", "mandal_name", "quick_party_label"].includes(scope.column)), false);
assert.equal(generated.filterScopes.some((scope) => scope.sheetId === "sheet-4" && !["campaign_name", "program_name"].includes(scope.column)), false);
assert.equal(generated.filterScopes.some((scope) => scope.sheetId === "sheet-2" && ["gender", "age_band"].includes(scope.column)), false);
const qualityProgramScope = generated.filterScopes.find((scope) => scope.sheetId === "sheet-4" && scope.column === "program_name");
assert.equal(qualityProgramScope.crossDataset, "SINGLE_DATASET");
assert.equal(qualityProgramScope.visualIds.includes("quick-comparability-registry"), false, "A missing Program field cannot silently pretend to filter comparability");
assert.doesNotMatch(JSON.stringify(generated.definition), /party_pulse_score|party_strength_change|average_direct_party_strength|sampling_design|VALUE_AND_PERCENT/);
for (const sheet of generated.definition.Sheets) {
  const layout = sheet.Layouts[0].Configuration.GridLayout.Elements;
  for (const [index, control] of sheet.FilterControls.entries()) {
    const element = layout.find((item) => item.ElementId === control.Dropdown.FilterControlId);
    assert.deepEqual([element.ColumnIndex, element.ColumnSpan, element.RowIndex, element.RowSpan], [(index % 3) * 12, 12, Math.floor(index / 3) * 4, 4], "Three full-height controls per row avoid ContainerTooSmall");
  }
  const disclosureLayout = layout.find((item) => item.ElementType === "TEXT_BOX");
  assert.equal(disclosureLayout.ColumnSpan, 36);
  assert.ok(disclosureLayout.RowSpan >= 10, "The complete methodology/privacy disclosure must be visible, not clipped to one line");
  assert.equal(disclosureLayout.RowIndex, Math.ceil(sheet.FilterControls.length / 3) * 4);
  for (const union of sheet.Visuals) {
    const kind = Object.keys(union)[0], visual = union[kind];
    const element = layout.find((item) => item.ElementId === visual.VisualId);
    assert.ok(element.RowSpan >= (kind === "KPIVisual" ? 10 : 16), "Titles, captions and KPI values/chart bodies need separate legible space");
    assert.equal(element.ColumnSpan, kind === "TableVisual" ? 36 : 18);
  }
  for (const [index, current] of layout.entries()) for (const other of layout.slice(index + 1)) {
    const horizontal = current.ColumnIndex < other.ColumnIndex + other.ColumnSpan && other.ColumnIndex < current.ColumnIndex + current.ColumnSpan;
    const vertical = current.RowIndex < other.RowIndex + other.RowSpan && other.RowIndex < current.RowIndex + current.RowSpan;
    assert.equal(horizontal && vertical, false, `Layout collision: ${current.ElementId}/${other.ElementId}`);
  }
  assert.match(sheet.TextBoxes[0].Content, /HUMAN_REVIEW_PENDING/);
  assert.match(sheet.TextBoxes[0].Content, /^<text-box><inline font-size="16px">[\s\S]+<\/inline><\/text-box>$/);
  assert.doesNotMatch(sheet.TextBoxes[0].Content, /<text>|<p>/);
  for (const visual of sheet.Visuals) if (visual.PieChartVisual) assert.equal(visual.PieChartVisual.ChartConfiguration.DataLabels.LabelContent, "VALUE");
  // AWS BarChartConfiguration API uses BarsArrangement, not Type.
  // https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BarChartConfiguration.html
  for (const { BarChartVisual: bar } of sheet.Visuals) if (bar) {
    assert.equal(Object.hasOwn(bar.ChartConfiguration, "Type"), false);
    assert.ok(["CLUSTERED", "STACKED", "STACKED_PERCENT"].includes(bar.ChartConfiguration.BarsArrangement));
    assert.equal(bar.ChartConfiguration.BarsArrangement, bar.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Colors?.[0]?.CategoricalDimensionField.Column.ColumnName === "campaign_name" || !bar.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Colors?.length ? "CLUSTERED" : "STACKED");
  }
  for (const visual of sheet.Visuals) if (visual.TableVisual || visual.HeatMapVisual) assert.equal(Object.values(visual)[0].ChartConfiguration.VisualPalette, undefined, "No unsupported categorical palette on tables or intensity heat maps");
}
const liveBackupFile = new URL("../../../artifacts/quick-backup-bundle-20261009.json", import.meta.url);
if (existsSync(liveBackupFile)) {
  const live = JSON.parse(readFileSync(liveBackupFile, "utf8"));
  const actualMap = live.dashboard.Definition.Sheets.flatMap((sheet) => sheet.Visuals).find((union) => union.GeospatialMapVisual);
  assert.ok(actualMap, "Actual saved cloud map template is present");
  const liveBindings = bindings.map((binding) => ({ ...binding, ...(binding.role === "enterprise" ? { arn: live.enterprise.DataSet.Arn } : binding.role === "geographic" ? { arn: live.geographic.DataSet.Arn } : {}) }));
  liveBindings.push({ role: "map", identifier: "map", view: REPORTING_VIEWS.geographic, arn: live.map.DataSet.Arn });
  const liveCandidate = buildGovernedDefinition({ bindings: liveBindings, existingDefinition: live.dashboard.Definition, mapVisual: actualMap });
  assert.deepEqual(liveCandidate.definition.Options, live.dashboard.Definition.Options, "Saved live security/action options survive the five-sheet rebuild");
  assert.equal(validatePublicationCandidate(liveCandidate).valid, true);
  assertNonMissingMapFilter(liveCandidate, "quick-mandal-party-map", "map");
  assertNonMissingMapFilter(liveCandidate, "quick-map-evidence-table", "geographic");
  assert.deepEqual(liveCandidate.definition.Sheets.slice(0, 4).map((sheet) => sheet.SheetId), live.dashboard.Definition.Sheets.map((sheet) => sheet.SheetId));
  const map = liveCandidate.definition.Sheets.flatMap((sheet) => sheet.Visuals).find((union) => union.GeospatialMapVisual).GeospatialMapVisual;
  const wells = map.ChartConfiguration.FieldWells.GeospatialMapAggregatedFieldWells;
  assert.equal(wells.Geospatial.length, 2);
  assert.equal(wells.Values[0].NumericalMeasureField.Column.ColumnName, "respondent_count");
  assert.equal(wells.Values[0].NumericalMeasureField.Column.DataSetIdentifier, "map");
  assert.equal(map.ChartConfiguration.Tooltip.FieldBasedTooltip, undefined, "Old tooltip field IDs cannot refer to replaced value/color wells");
  assert.equal(map.ChartConfiguration.VisualPalette.ColorMap.find((entry) => entry.Element.FieldValue === "BRS").Color, PARTY_COLORS.BRS);
  console.log("Saved live map definition regression passed (read-only local snapshot; no cloud operations).");
}
console.log("Quick publication plan regressions passed (offline only; no cloud operations).");
