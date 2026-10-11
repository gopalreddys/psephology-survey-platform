import assert from "node:assert/strict";
import { buildGovernedDefinition } from "./quick-publication-definition.mjs";
import {
  REPORTING_VIEWS, REQUIRED_SHEETS, validatePublicationCandidate,
  visualPartitionColumns, privacyPartitionColumns, uniquePersonWindowExpression
} from "./quick-publication-plan.mjs";
import {
  ADDITIONAL_INSIGHT_VISUALS, EXISTING_VISUAL_NOTES, ANSWER_STATE_LABELS
} from "./quick-insight-catalog.mjs";

// Entirely offline: no production definitions, credentials, or cloud calls.
const bindings = Object.entries(REPORTING_VIEWS).map(([role, view]) => ({
  role, view, identifier: role,
  arn: `arn:aws:quicksight:ap-south-1:123456789012:dataset/fixture-${role}`
}));
const existingDefinition = {
  Sheets: REQUIRED_SHEETS.map((Name, index) => ({ SheetId: `fixture-sheet-${index}`, Name, Visuals: [] })),
  Options: { WeekStart: "MONDAY", QBusinessInsightsStatus: "DISABLED" }
};
const mapVisual = { GeospatialMapVisual: {
  VisualId: "fixture-map",
  ChartConfiguration: { FieldWells: { GeospatialMapAggregatedFieldWells: {
    Geospatial: [{ GeospatialDimensionField: {
      FieldId: "fixture-mandal", Column: { DataSetIdentifier: "geographic", ColumnName: "mandal_name" }
    } }]
  } } }
} };
const candidate = buildGovernedDefinition({ bindings, existingDefinition, mapVisual });
const { definition } = candidate;
const visuals = new Map(definition.Sheets.flatMap((sheet) => (sheet.Visuals ?? []).map((union) => {
  const body = Object.values(union)[0];
  return [body.VisualId, { sheet, kind: Object.keys(union)[0], body }];
})));
const calculation = (name) => definition.CalculatedFields.find((field) => field.DataSetIdentifier === "enterprise" && field.Name === name);
const numericGuard = (guard) => definition.FilterGroups.flatMap((group) => group.Filters).find((filter) => filter.NumericRangeFilter?.FilterId === guard.id)?.NumericRangeFilter;
const guide = definition.Sheets.find((sheet) => sheet.Name === "Measurement guide");
const readableText = (value) => value.replace(/<[^>]*>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const guideText = (guide?.TextBoxes ?? []).map((box) => readableText(box.Content ?? "")).join("\n");
const walk = (value, visit) => {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
};
const countField = (body) => {
  const values = body.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells?.Values
    ?? body.ChartConfiguration.FieldWells.HeatMapAggregatedFieldWells?.Values;
  assert.equal(values?.length, 1, `${body.VisualId}: an aggregate insight has one count measure`);
  return values[0].CategoricalMeasureField;
};
const outcomeContract = {
  issue_priority: "issue", candidate_sentiment: "candidate", respondent_sentiment: "incumbent"
};
const stableIds = [
  "quick-issue-age", "quick-issue-gender", "quick-issue-mandal-heat",
  "quick-candidate-age", "quick-candidate-gender", "quick-candidate-mandal-heat",
  "quick-mandal-incumbent-heat", "quick-age-gender-coverage",
  "quick-mandal-wave-coverage", "quick-issue-answer-state"
];

assert.deepEqual(ADDITIONAL_INSIGHT_VISUALS.map((item) => item.id), stableIds);
assert.equal(Object.keys(EXISTING_VISUAL_NOTES).length, 31);
assert.equal(visuals.size, 41, "All original visuals, including the saved map, plus ten aggregate insights are retained");
assert.ok(guide, "Measurement explanations have a dedicated native guide sheet");
assert.equal(definition.Sheets.length, 6);
assert.equal(guide.Visuals?.length ?? 0, 0, "The guide contains explanations, not respondent details");
assert.ok(guide.TextBoxes.length <= 100, "The measurement guide obeys the AWS SheetDefinition text-box limit");
for (const sheet of definition.Sheets) {
  const layout = sheet.Layouts[0].Configuration.GridLayout.Elements;
  for (const element of layout) {
    assert.ok(element.RowSpan >= 1 && element.RowSpan <= 21, `${element.ElementId}: AWS GridLayoutElement limits a cell height to 21 rows`);
    assert.ok(element.ColumnSpan >= 1 && element.ColumnSpan <= 36);
  }
}
assert.equal(validatePublicationCandidate(candidate).valid, true, JSON.stringify(validatePublicationCandidate(candidate).errors));
assert.deepEqual(existingDefinition.Options, { WeekStart: "MONDAY", QBusinessInsightsStatus: "DISABLED" });

const expectedAxisLabels = {
  age_band: "Age group", gender: "Gender", mandal_name: "Mandal",
  iteration_number: "Iteration", campaign_name: "Campaign",
  party_salience: "Party attention", party_leadership: "Party perceived as responsive",
  candidate_sentiment: "Candidate impression", respondent_sentiment: "Incumbent assessment",
  issue_priority: "Issue priority", quick_issue_answer_state: "Answer status",
  evidence_key: "Survey observations",
  quick_incumbent_answer_key: "Recorded answers", quick_candidate_answer_key: "Recorded answers",
  quick_party_answer_key: "Recorded answers", quick_leadership_answer_key: "Recorded answers",
  quick_issue_answer_key: "Recorded answers",
  positive_sentiment_change_pct: "Change (percentage points)",
  candidate_positive_change_pct: "Change (percentage points)"
};
const bars = [...visuals.values()].filter((visual) => visual.kind === "BarChartVisual");
assert.equal(bars.length, 15, "Every generated bar receives human-readable axes, including movement charts");
for (const { body } of bars) {
  const config = body.ChartConfiguration;
  const wells = config.FieldWells.BarChartAggregatedFieldWells;
  for (const [option, fields] of [["CategoryLabelOptions", wells.Category], ["ColorLabelOptions", wells.Colors], ["ValueLabelOptions", wells.Values]]) {
    if (!fields?.length) {
      assert.equal(config[option], undefined, `${body.VisualId}: no label is attached to an absent color field`);
      continue;
    }
    assert.equal(config[option].Visibility, "VISIBLE");
    assert.equal(config[option].AxisLabelOptions.length, fields.length);
    fields.forEach((field, index) => {
      const reference = Object.values(field)[0];
      const label = config[option].AxisLabelOptions[index];
      assert.deepEqual(label.ApplyTo, { Column: reference.Column, FieldId: reference.FieldId }, `${body.VisualId}: axis labels target actual field wells`);
      assert.equal(label.CustomLabel, expectedAxisLabels[reference.Column.ColumnName]);
      assert.ok(label.CustomLabel.length <= 40, `${body.VisualId}: the axis caption remains concise`);
      assert.doesNotMatch(label.CustomLabel, /_|Count distinct|\bkey\b/i, `${body.VisualId}: internal identifiers never become display captions`);
    });
  }
  const value = Object.values(wells.Values[0])[0];
  if (body.VisualId.endsWith("-movement")) {
    assert.equal(config.ValueLabelOptions.AxisLabelOptions[0].CustomLabel, "Change (percentage points)");
    assert.equal(value.AggregationFunction.SimpleNumericalAggregation, "MIN", "Movement units stay percentage-point change, not a response count or share");
  } else {
    assert.equal(value.AggregationFunction, "DISTINCT_COUNT", "Friendly count labels must not alter counting semantics");
    assert.equal(config.ValueLabelOptions.AxisLabelOptions[0].CustomLabel, value.Column.ColumnName === "evidence_key" ? "Survey observations" : "Recorded answers");
  }
}

for (const spec of ADDITIONAL_INSIGHT_VISUALS) {
  const actual = visuals.get(spec.id);
  assert.ok(actual, `${spec.id}: the richer insight is generated`);
  assert.equal(actual.kind, spec.kind === "BAR" ? "BarChartVisual" : "HeatMapVisual");
  const roleSheet = { leadership: "Leadership overview", demographic: "Demographic pulse", geographic: "Geographic intelligence" }[spec.sheetRole];
  assert.equal(actual.sheet.Name, roleSheet, `${spec.id}: keep the relevant question and evidence together`);

  const target = spec.color ?? spec.column ?? spec.category;
  const construct = outcomeContract[target];
  const expectedCountKey = construct ? `quick_${construct}_answer_key` : "evidence_key";
  const expectedPersonKey = construct ? `quick_${construct}_respondent_key` : "respondent_key";
  const measure = countField(actual.body);
  assert.equal(measure?.Column.ColumnName, expectedCountKey, `${spec.id}: missing outcomes must not inflate the distribution`);
  assert.equal(measure.AggregationFunction, "DISTINCT_COUNT");

  const guards = candidate.guards.filter((guard) => guard.visualId === spec.id);
  assert.equal(guards.length, 1, `${spec.id}: every displayed cell has a privacy guard`);
  const [guard] = guards;
  assert.equal(guard.sourceKey, expectedPersonKey, `${spec.id}: distinct people, not repeated observations, qualify a cell`);
  assert.equal(guard.aggregation, "NONE");
  const displayedDimensions = visualPartitionColumns(actual.body, "enterprise");
  const rawDimensions = privacyPartitionColumns(actual.body, "enterprise");
  assert.deepEqual(guard.partitions, rawDimensions, `${spec.id}: all raw row and outcome/color dimensions qualify independently`);
  if (spec.id !== "quick-issue-answer-state") {
    assert.deepEqual(displayedDimensions, [...new Set([spec.row ?? spec.category, spec.column ?? spec.color].filter(Boolean))].sort());
  }
  assert.equal(calculation(guard.column)?.Expression, uniquePersonWindowExpression(expectedPersonKey, rawDimensions));
  const range = numericGuard(guard);
  assert.ok(range, `${spec.id}: the privacy window actually filters the visual`);
  assert.ok(range.RangeMinimum.StaticValue >= 5);
  assert.equal(range.IncludeMinimum, true);
  assert.equal(range.NullOption, "NON_NULLS_ONLY");
  assert.equal(range.AggregationFunction, undefined);

  if (construct) {
    assert.equal(calculation(expectedCountKey)?.Expression, `ifelse({${target}_status} <> 'MISSING', {evidence_key}, NULL)`);
    assert.equal(calculation(expectedPersonKey)?.Expression, `ifelse({${target}_status} <> 'MISSING', {respondent_key}, NULL)`);
    assert.ok(spec.answerBase, `${spec.id}: outcome comparisons retain their complete row answer base`);
    assert.equal(calculation(spec.answerBase)?.Expression, uniquePersonWindowExpression(expectedCountKey, spec.answerBasePartitions));
    const baseGuard = candidate.answerBaseGuards.find((item) => item.visualId === spec.id);
    assert.equal(baseGuard?.column, spec.answerBase);
    const baseRange = definition.FilterGroups.flatMap((group) => group.Filters).find((filter) => filter.NumericRangeFilter?.Column.ColumnName === spec.answerBase)?.NumericRangeFilter;
    assert.ok(baseRange?.RangeMinimum.StaticValue >= 5);
    const tooltip = actual.body.ChartConfiguration.Tooltip;
    assert.equal(tooltip?.SelectedTooltipType, "DETAILED");
    const tooltipBase = tooltip.FieldBasedTooltip?.TooltipFields?.find((field) => field.ColumnTooltipItem?.Column.ColumnName === spec.answerBase)?.ColumnTooltipItem;
    assert.ok(tooltipBase, `${spec.id}: analyst can inspect the complete row answer base`);
    assert.equal(tooltipBase.Column.DataSetIdentifier, "enterprise");
    assert.equal(tooltipBase.Aggregation.NumericalAggregationFunction.SimpleNumericalAggregation, "MIN", `${spec.id}: repeated base windows must not be summed`);
  } else {
    assert.equal(candidate.answerBaseGuards.some((item) => item.visualId === spec.id), false, `${spec.id}: evidence/missing coverage must not depend on a non-missing outcome base`);
  }
}

// Sparse data and repeated waves are part of the demo. They must not expose
// small people cells simply because the chart has many observations.
const cellPersonCounts = (rows, guard) => {
  const cells = new Map();
  for (const row of rows) {
    const key = JSON.stringify(guard.partitions.map((column) => row[column]));
    if (!cells.has(key)) cells.set(key, new Set());
    if (row[guard.sourceKey] != null) cells.get(key).add(row[guard.sourceKey]);
  }
  return [...cells.values()].map((people) => people.size);
};
for (const spec of ADDITIONAL_INSIGHT_VISUALS) {
  const guard = candidate.guards.find((item) => item.visualId === spec.id);
  const repeated = [1, 2, 3].flatMap((wave) => ["person-a", "person-b"].map((person) => ({
    ...Object.fromEntries(guard.partitions.map((column) => [column, "same-cell"])),
    respondent_key: person, evidence_key: `${wave}:${person}`, [guard.sourceKey]: person
  })));
  assert.equal(new Set(repeated.map((row) => row.evidence_key)).size, 6);
  assert.deepEqual(cellPersonCounts(repeated, guard), [2], `${spec.id}: two people across three waves remain suppressed`);
  const firstDimension = guard.partitions[0];
  const split = Array.from({ length: 6 }, (_, index) => ({
    ...Object.fromEntries(guard.partitions.map((column) => [column, "same-cell"])),
    [firstDimension]: index < 3 ? "first-cell" : "second-cell", [guard.sourceKey]: `person-${index}`
  }));
  assert.deepEqual(cellPersonCounts(split, guard), [3, 3], `${spec.id}: a pooled six-person base must not reveal two three-person cells`);
}

const issueCoverage = visuals.get("quick-issue-answer-state").body;
const statusDimension = visualPartitionColumns(issueCoverage, "enterprise")[0];
const statusExpression = calculation(statusDimension)?.Expression;
assert.ok(statusExpression, "Internal status codes get a readable chart dimension");
assert.match(statusExpression, /\{issue_priority_status\}/);
for (const [status, label] of Object.entries(ANSWER_STATE_LABELS)) {
  assert.ok(statusExpression.includes(JSON.stringify(status)), `Answer coverage retains ${status}`);
  assert.ok(statusExpression.includes(JSON.stringify(label)), `Answer coverage displays ${label}`);
}
const issueCoverageGuard = candidate.guards.find((item) => item.visualId === "quick-issue-answer-state");
assert.deepEqual(issueCoverageGuard.partitions, ["issue_priority_status"], "Translated status must not be a PRE_AGG partition field");
assert.deepEqual(candidate.guards.find((item) => item.visualId === "quick-mandal-wave-coverage").partitions, ["iteration_number", "mandal_name"], "Iteration display text uses its raw number for privacy grouping");
assert.equal(issueCoverageGuard.sourceKey, "respondent_key", "Missing issue answers can independently qualify the coverage chart");
assert.equal(candidate.answerStatusFilters.some((item) => item.visualId === "quick-issue-answer-state"), false);
const missingPeople = Array.from({ length: 5 }, (_, index) => ({
  [statusDimension]: "No response", issue_priority_status: "MISSING", respondent_key: `missing-person-${index}`, quick_issue_respondent_key: null
}));
assert.deepEqual(cellPersonCounts(missingPeople, issueCoverageGuard), [5]);
const splitStatuses = Array.from({ length: 6 }, (_, index) => ({
  issue_priority_status: index < 3 ? "CODED" : "MISSING", respondent_key: `person-${index}`
}));
assert.deepEqual(cellPersonCounts(splitStatuses, issueCoverageGuard), [3, 3], "Six pooled people must not qualify two three-person status groups");
const issueDistributionGuard = candidate.guards.find((item) => item.visualId === "quick-issue-age");
assert.deepEqual(cellPersonCounts(missingPeople, issueDistributionGuard), [0], "Missing answers remain outside the issue-priority distribution");

const noteCatalog = [...Object.entries(EXISTING_VISUAL_NOTES).map(([id, note]) => ({ id, ...note })), ...ADDITIONAL_INSIGHT_VISUALS];
for (const note of noteCatalog) {
  const { body } = visuals.get(note.id);
  assert.equal(body.Title.FormatText.PlainText, note.title);
  assert.equal(body.Subtitle.FormatText.PlainText, note.subtitle);
  assert.ok(note.title.length <= 80, `${note.id}: title remains scannable`);
  assert.ok(note.subtitle.length <= 100, `${note.id}: caption remains a short units note`);
  assert.ok(guideText.includes(note.measurementNote), `${note.id}: complete measurement explanation is available on demand`);
  const actions = body.Actions ?? [];
  assert.ok(actions.some((action) => action.Status === "ENABLED" && action.Trigger === "DATA_POINT_MENU"
    && action.ActionOperations?.some((operation) => operation.NavigationOperation?.LocalNavigationConfiguration?.TargetSheetId === guide.SheetId)), `${note.id}: native chart menu opens the measurement guide`);
}

const sourceColumns = new Set();
walk(definition, (item) => {
  if (item.ColumnName) sourceColumns.add(item.ColumnName);
  assert.equal(Object.hasOwn(item, "TableUnaggregatedFieldWells"), false, "No respondent-level table is introduced");
});
for (const column of sourceColumns) {
  assert.doesNotMatch(column, /(?:^|_)(phone|epic|full_name|voter_name|raw|response_variables)(?:_|$)/i);
  assert.doesNotMatch(column, /(?:^|_)(candidate_awareness|candidate_fit|criterion_fit|development_priority|desired_change|party_strength|party_pulse|forecast)/i, "Insights cannot invent unavailable constructs or political inference");
  if (/transcript/i.test(column)) assert.ok(["transcripts_captured", "quick_transcript_pct"].includes(column), "Only aggregate transcript coverage is exposed");
}
assert.equal(definition.CalculatedFields.some((field) => /PRE_FILTER|direct_party_strength|party_lean|forecast/.test(field.Expression)), false);
for (const { body } of visuals.values()) {
  const chart = body.ChartConfiguration;
  assert.notEqual(chart.DataLabels?.LabelContent, "VALUE_AND_PERCENT", "Suppressed cells cannot trigger visible-slice percentage claims");
  assert.notEqual(chart.BarsArrangement, "STACKED_PERCENT");
}

for (const mutate of [
  (broken, guard) => { numericGuardFor(broken, guard).RangeMinimum.StaticValue = 4; },
  (broken, guard) => { broken.definition.CalculatedFields.find((field) => field.Name === guard.column).Expression = uniquePersonWindowExpression("evidence_key", guard.partitions); },
  (broken, guard) => { broken.definition.CalculatedFields.find((field) => field.Name === guard.column).Expression = uniquePersonWindowExpression(guard.sourceKey, []); }
]) {
  const broken = structuredClone(candidate);
  const guard = broken.guards.find((item) => item.visualId === "quick-issue-mandal-heat");
  mutate(broken, guard);
  assert.equal(validatePublicationCandidate(broken).valid, false, "Additional insights fail validation when a small cell, repeated observations, or pooled dimensions bypass protection");
}

function numericGuardFor(candidate, guard) {
  return candidate.definition.FilterGroups.flatMap((group) => group.Filters).find((filter) => filter.NumericRangeFilter?.FilterId === guard.id).NumericRangeFilter;
}

for (const name of ["quick_issue_answer_state", "quick_iteration_label"]) {
  const broken = structuredClone(candidate);
  broken.definition.CalculatedFields.find((field) => field.DataSetIdentifier === "enterprise" && field.Name === name).Expression = "{gender}";
  assert.equal(validatePublicationCandidate(broken).valid, false, "Changing a display-alias formula invalidates its raw-column privacy contract");
}

const oversizedGuide = structuredClone(candidate);
oversizedGuide.definition.Sheets.find((sheet) => sheet.Name === "Measurement guide").Layouts[0].Configuration.GridLayout.Elements[0].RowSpan = 22;
assert.equal(validatePublicationCandidate(oversizedGuide).valid, false, "An oversized guide cell fails local publication validation before AWS can reject the definition");

const qualitySheet = definition.Sheets.find((sheet) => sheet.Name === "Research quality");
const movementSheet = definition.Sheets.find((sheet) => sheet.Name === "Iteration movement");
assert.equal(candidate.filterScopes.some((scope) => scope.sheetId === qualitySheet.SheetId && !["program_name", "campaign_name"].includes(scope.column)), false);
assert.equal(candidate.filterScopes.some((scope) => scope.sheetId === movementSheet.SheetId && !["program_name", "campaign_name", "quick_iteration_label"].includes(scope.column)), false);
const qualityProgram = candidate.filterScopes.find((scope) => scope.sheetId === qualitySheet.SheetId && scope.column === "program_name");
assert.equal(qualityProgram.crossDataset, "SINGLE_DATASET");
assert.equal(qualityProgram.visualIds.includes("quick-comparability-registry"), false, "Program cannot claim to scope a registry without a Program field");
for (const id of ["quick-quality-connection", "quick-quality-output", "quick-quality-transcript", "quick-quality-callback", "quick-quality-demographics"]) {
  assert.match(EXISTING_VISUAL_NOTES[id].measurementNote, /Whole-Campaign/);
  assert.match(EXISTING_VISUAL_NOTES[id].measurementNote, /zero denominator/);
}

console.log("Quick insight regression checks passed: 41 governed visuals, cell privacy, answer bases, readable coverage and native measurement navigation.");
