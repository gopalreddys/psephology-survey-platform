/**
 * Pure, offline helpers for an explicitly approved Quick publication.
 * This module has no AWS credentials, network client or implicit cloud writes.
 * API shapes: VisualPalette/DataPathColor, NumericRangeFilter/FilterGroup,
 * UpdateDataSet, UpdateDashboard and UpdateDashboardPublishedVersion.
 */
import { createHash } from "node:crypto";

export const PARTY_COLORS = Object.freeze({ BRS: "#E91E8F", BJP: "#FF9933", Congress: "#138808" });
// Sentiment is a separate construct: party hues must never imply polarity.
export const SENTIMENT_COLORS = Object.freeze({
  Positive: "#2F7D55", Neutral: "#64748B", Negative: "#C74B50", Mixed: "#805AD5",
  "Can't say": "#B7791F", "Declined to answer": "#94A3B8", "Uncoded response": "#475569"
});
export const REQUIRED_SHEETS = Object.freeze([
  "Leadership overview", "Demographic pulse", "Geographic intelligence",
  "Iteration movement", "Research quality"
]);
export const REPORTING_VIEWS = Object.freeze({
  enterprise: "analytics_research_enterprise_v2",
  geographic: "analytics_research_geographic_v2",
  movement: "analytics_iteration_movement_v2",
  quality: "analytics_research_quality_v1",
  comparability: "analytics_iteration_comparability_v1"
});
export const VALIDATION_DISCLOSURE = "Descriptive explicit-label coding · HUMAN_REVIEW_PENDING · OUTPUT_TAXONOMY_V2. Incumbent performance assessment and candidate impression are separate constructs. No individual inference, validated NLP accuracy or election forecast.";
const clone = (value) => structuredClone(value);
const identifier = (value) => {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${String(value)}`);
  return `"${value}"`;
};
const forbiddenColumn = /(?:^|_)(?:phone|epic|full_name|voter_name|transcript|raw|response_variables)(?:_|$)/i;
const isPrivilegedColumn = (name) => forbiddenColumn.test(name) && !["transcript_coverage_pct", "quick_transcript_pct"].includes(name);

/** Use live information_schema columns; never SELECT * or import UUIDs directly. */
export function reportingSelect(view, columns) {
  if (!Object.values(REPORTING_VIEWS).includes(view)) throw new Error("Only governed reporting views may be imported");
  if (!Array.isArray(columns) || columns.length === 0) throw new Error("Verified source column schema is required");
  const names = columns.map((column) => column.name ?? column.Name);
  if (new Set(names).size !== names.length) throw new Error("Duplicate source columns");
  const parts = columns.map((column) => {
    const name = column.name ?? column.Name;
    if (isPrivilegedColumn(name)) throw new Error(`Privileged/raw column is not permitted: ${name}`);
    const quoted = identifier(name);
    const type = String(column.data_type ?? column.type ?? column.Type).toLowerCase();
    // JSON/arrays contain methodology/qualification text, not respondent answers.
    // They are formatted as strings so SPICE never silently drops a source column.
    return ["uuid", "array", "json", "jsonb"].includes(type)
      ? `${quoted}::text AS ${quoted}` : quoted;
  });
  return `SELECT\n  ${parts.join(",\n  ")}\nFROM public.${identifier(view)}`;
}

/** Composite observation identity: pooled waves are not independent people. */
export function enterpriseEvidenceSelect(columns) {
  const sql = reportingSelect(REPORTING_VIEWS.enterprise, columns);
  for (const required of ["campaign_id", "iteration_id", "respondent_key"]) {
    if (!columns.some((column) => (column.name ?? column.Name) === required)) throw new Error(`Evidence key source missing: ${required}`);
  }
  return sql.replace("\nFROM public.", ",\n  MD5(campaign_id::text || ':' || iteration_id::text || ':' || respondent_key) AS evidence_key\nFROM public.");
}

const isStringEvidenceKey = (column) => column === "respondent_key" || column === "evidence_key" || /_(?:respondent|answer|missing)_key$/.test(column ?? "");
/** Numeric targets only: PRE_AGG windows or already-qualified numeric rollups. */
export function minimumCellFilter({ datasetIdentifier, sheetId, visualId, id, column, minimum = 5, aggregation = "NONE" }) {
  if (!datasetIdentifier || !sheetId || !visualId || !id) throw new Error("Explicit dataset/sheet/visual/filter IDs are required");
  if (!Number.isInteger(minimum) || minimum < 5) throw new Error("The minimum reporting base cannot be lower than five");
  if (!column || isStringEvidenceKey(column)) throw new Error("NumericRangeFilter requires a numeric window/rollup column, never a string evidence/person key");
  let aggregationFunction;
  if (["SUM", "MIN", "MAX"].includes(aggregation)) aggregationFunction = { NumericalAggregationFunction: { SimpleNumericalAggregation: aggregation } };
  else if (aggregation !== "NONE") throw new Error(`Unsupported suppression aggregation: ${aggregation}`);
  return {
    FilterGroupId: `${id}-group`, Status: "ENABLED", CrossDataset: "SINGLE_DATASET",
    ScopeConfiguration: { SelectedSheets: { SheetVisualScopingConfigurations: [{ SheetId: sheetId, Scope: "SELECTED_VISUALS", VisualIds: [visualId] }] } },
    Filters: [{ NumericRangeFilter: {
      FilterId: id, Column: { DataSetIdentifier: datasetIdentifier, ColumnName: column },
      ...(aggregationFunction ? { AggregationFunction: aggregationFunction } : {}), NullOption: "NON_NULLS_ONLY",
      RangeMinimum: { StaticValue: minimum }, IncludeMinimum: true
    } }]
  };
}

/** Bind colors to explicit party field values, never theme palette position. */
export function partyPalette(fieldId, existing = {}) {
  if (!fieldId) throw new Error("Party dimension FieldId is required");
  return namedPalette(fieldId, PARTY_COLORS, existing);
}

export function sentimentPalette(fieldId, existing = {}) {
  if (!fieldId) throw new Error("Sentiment dimension FieldId is required");
  return namedPalette(fieldId, SENTIMENT_COLORS, existing);
}

function namedPalette(fieldId, colors, existing) {
  const retained = (existing.ColorMap ?? []).filter((entry) => !(entry.Element?.FieldId === fieldId && Object.hasOwn(colors, entry.Element?.FieldValue)));
  return { ...clone(existing), ColorMap: [...retained, ...Object.entries(colors).map(([FieldValue, Color]) => ({ Element: { FieldId: fieldId, FieldValue }, Color }))] };
}

function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) if (child && typeof child === "object") walk(child, visit);
}

/** Exactly the visual's grouping dimensions; never pooled across color cells. */
export function visualPartitionColumns(visual, datasetIdentifier) {
  const columns = [];
  walk(visual.ChartConfiguration?.FieldWells, (item) => {
    const dimension = item.CategoricalDimensionField ?? item.NumericalDimensionField ?? item.DateDimensionField;
    if (dimension?.Column?.DataSetIdentifier === datasetIdentifier) columns.push(dimension.Column.ColumnName);
  });
  return [...new Set(columns)].sort();
}

export function uniquePersonWindowExpression(sourceKey, partitions) {
  return `distinctCountOver({${sourceKey}}, [${partitions.map((column) => `{${column}}`).join(", ")}], PRE_AGG)`;
}

export function applyPartyColors(definition) {
  return applyDimensionColors(definition, ["party_salience", "party_name", "party_leadership"], partyPalette);
}

export function applySentimentColors(definition) {
  return applyDimensionColors(definition, ["respondent_sentiment", "candidate_sentiment"], sentimentPalette);
}

function applyDimensionColors(definition, columns, paletteFactory) {
  const result = clone(definition);
  const colored = [];
  for (const sheet of result.Sheets ?? []) for (const union of sheet.Visuals ?? []) {
    if (!["BarChartVisual", "PieChartVisual", "GeospatialMapVisual", "LineChartVisual", "ScatterPlotVisual", "ComboChartVisual"].includes(Object.keys(union)[0])) continue;
    const visual = Object.values(union)[0];
    const fields = [];
    walk(visual.ChartConfiguration?.FieldWells, (item) => {
      if (item.FieldId && columns.includes(item.Column?.ColumnName)) fields.push(item.FieldId);
    });
    if (fields.length && visual.ChartConfiguration) {
      for (const field of new Set(fields)) visual.ChartConfiguration.VisualPalette = paletteFactory(field, visual.ChartConfiguration.VisualPalette);
      colored.push({ sheetId: sheet.SheetId, visualId: visual.VisualId, fieldIds: [...new Set(fields)] });
    }
  }
  return { definition: result, colored };
}

const datasetUpdateKeys = [
  "Name", "PhysicalTableMap", "LogicalTableMap", "ImportMode", "ColumnGroups", "FieldFolders",
  "RowLevelPermissionDataSet", "RowLevelPermissionTagConfiguration", "ColumnLevelPermissionRules",
  "DataSetUsageConfiguration", "DatasetParameters", "PerformanceConfiguration", "DataPrepConfiguration", "SemanticModelConfiguration"
];

export function quickInputColumns(columns, previous = [], { withIds = false } = {}) {
  return columns.map((column) => {
    const Name = column.name ?? column.Name;
    const sourceType = String(column.data_type ?? column.type ?? column.Type).toLowerCase();
    let Type;
    if (["smallint", "integer", "bigint", "int2", "int4", "int8"].includes(sourceType)) Type = "INTEGER";
    else if (["decimal", "numeric", "real", "double precision", "float4", "float8"].includes(sourceType)) Type = "DECIMAL";
    else if (["date", "datetime", "timestamp", "timestamp with time zone", "timestamp without time zone", "timestamptz"].includes(sourceType)) Type = "DATETIME";
    else if (["boolean", "bool"].includes(sourceType)) Type = "BOOLEAN";
    else if (["text", "uuid", "array", "json", "jsonb", "character varying", "character", "varchar", "char", "string"].includes(sourceType)) Type = "STRING";
    else throw new Error(`Unsupported verified PostgreSQL type: ${Name} (${sourceType})`);
    const old = previous.find((item) => item.Name === Name);
    return { Name, Type,
      ...(Type === "DECIMAL" ? { SubType: ["real", "double precision", "float4", "float8"].includes(sourceType) ? "FLOAT" : "FIXED" } : {}),
      ...(withIds ? { Id: old?.Id ?? `quick-v2-${Name}-${createHash("sha256").update(Name).digest("hex").slice(0, 8)}` } : {})
    };
  });
}

function assertSimplePrep(dataset, physicalId) {
  const prep = dataset.DataPrepConfiguration;
  if (!prep) return;
  const sources = Object.entries(prep.SourceTableMap ?? {});
  const transforms = Object.entries(prep.TransformStepMap ?? {});
  const destinations = Object.entries(prep.DestinationTableMap ?? {});
  if (sources.length !== 1 || transforms.length !== 1 || destinations.length !== 1
    || sources[0][1].PhysicalTableId !== physicalId
    || Object.keys(transforms[0][1]).length !== 1
    || transforms[0][1].ImportTableStep?.Source?.SourceTableId !== sources[0][0]
    || destinations[0][1].Source?.TransformOperationId !== transforms[0][0]) {
    throw new Error("Complex Data Prep transforms require explicit review; only the verified import-only graph is supported");
  }
}

/** Full UpdateDataSet request; retain ACL/RLS config, original IDs and data source. */
export function datasetUpdateRequest({ awsAccountId, dataset, view, columns, inputColumns }) {
  const physical = Object.entries(dataset.PhysicalTableMap ?? {});
  if (physical.length !== 1 || !physical[0][1].CustomSql) throw new Error("Only a verified single CustomSql source is supported");
  assertSimplePrep(dataset, physical[0][0]);
  if (!dataset.DataSetId || !dataset.ImportMode || !dataset.Name) throw new Error("Complete DescribeDataSet snapshot is required");
  if (!Array.isArray(inputColumns) || inputColumns.length !== columns.length) throw new Error("Complete Quick input-column schema is required");
  if (inputColumns.some((column, index) => column.Name !== (columns[index].name ?? columns[index].Name))) throw new Error("Source/Quick column order differs");
  const request = { AwsAccountId: awsAccountId, DataSetId: dataset.DataSetId };
  for (const key of datasetUpdateKeys) if (dataset[key] !== undefined) request[key] = clone(dataset[key]);
  const sql = request.PhysicalTableMap[physical[0][0]].CustomSql;
  if (!sql.DataSourceArn) throw new Error("Original DataSourceArn is missing");
  const previousColumns = sql.Columns ?? [];
  sql.Name = view; sql.SqlQuery = view === REPORTING_VIEWS.enterprise ? enterpriseEvidenceSelect(columns) : reportingSelect(view, columns); sql.Columns = clone(inputColumns);
  if (dataset.DataPrepConfiguration) sql.Columns = sql.Columns.map((column) => ({ ...column, Id: previousColumns.find((previous) => previous.Name === column.Name)?.Id ?? column.Id ?? `quick-v2-${column.Name}-${createHash("sha256").update(column.Name).digest("hex").slice(0, 8)}` }));
  if (view === REPORTING_VIEWS.enterprise) sql.Columns.push({ Name: "evidence_key", Type: "STRING", ...(dataset.DataPrepConfiguration ? { Id: "quick-v2-evidence-key" } : {}) });
  for (const table of Object.values(request.LogicalTableMap ?? {})) {
    if (table.Source?.JoinInstruction || table.Source?.DataSetArn) throw new Error("Joined/derived datasets require explicit transform review");
    for (const transform of table.DataTransforms ?? []) {
      if (transform.ProjectOperation) transform.ProjectOperation.ProjectedColumns = sql.Columns.map((column) => column.Name);
      else if (transform.TagColumnOperation || transform.CastColumnTypeOperation) {
        const operation = transform.TagColumnOperation ?? transform.CastColumnTypeOperation;
        if (!sql.Columns.some((column) => column.Name === operation.ColumnName)) throw new Error(`Transform uses a removed source column: ${operation.ColumnName}`);
      } else throw new Error("Calculated/renamed/filtered legacy transforms require explicit review");
    }
  }
  return request;
}

/** Stage without changing the dataset used by the currently published version. */
export function stagedDatasetRequest({ awsAccountId, dataset, view, columns, newDataSetId, name }) {
  if (!newDataSetId || newDataSetId === dataset.DataSetId || !/^[\w-]+$/.test(newDataSetId)) throw new Error("A distinct, explicit staging dataset ID is required");
  const physical = Object.values(dataset.PhysicalTableMap ?? {})[0]?.CustomSql;
  const inputColumns = quickInputColumns(columns, physical?.Columns ?? [], { withIds: Boolean(dataset.DataPrepConfiguration) });
  return { ...datasetUpdateRequest({ awsAccountId, dataset, view, columns, inputColumns }), DataSetId: newDataSetId, Name: name ?? `${dataset.Name} · governed v2` };
}

/** Validate a generated candidate, not the blueprint or a claim of live QA. */
export function validatePublicationCandidate({ definition, bindings, guards = [], answerStatusFilters = [], percentagePolicies = [], reviewedVisualIds = [] }) {
  const errors = [];
  const sheets = definition.Sheets ?? [];
  for (const sheet of sheets) for (const box of sheet.TextBoxes ?? []) {
    if (box.Content && !/^<text-box(?:\s[^>]*)?>[\s\S]*<\/text-box>$/.test(box.Content)) errors.push(`Unsupported textbox markup root: ${box.SheetTextBoxId}`);
  }
  const groupIds = new Set(), filterIds = new Set();
  for (const group of definition.FilterGroups ?? []) {
    if (groupIds.has(group.FilterGroupId)) errors.push(`Duplicate filter group ID: ${group.FilterGroupId}`);
    groupIds.add(group.FilterGroupId);
    for (const filter of group.Filters ?? []) {
      const filterId = Object.values(filter)[0]?.FilterId;
      if (filterIds.has(filterId)) errors.push(`Duplicate filter ID: ${filterId}`);
      filterIds.add(filterId);
      const list = filter.CategoryFilter?.Configuration?.FilterListConfiguration;
      // AWS service validation is stricter than the general SDK enum: a list
      // filter accepts contains/not-contains; equality uses the custom variant.
      if (list && !["CONTAINS", "DOES_NOT_CONTAIN"].includes(list.MatchOperator)) errors.push(`Unsupported list-filter operator: ${filterId}`);
      if (isStringEvidenceKey(filter.NumericRangeFilter?.Column?.ColumnName)) errors.push(`String key is not a numeric filter target: ${filterId}`);
    }
  }
  for (const name of REQUIRED_SHEETS) if (!sheets.some((sheet) => sheet.Name === name)) errors.push(`Required sheet missing: ${name}`);
  for (const [role, view] of Object.entries(REPORTING_VIEWS)) {
    const binding = bindings.find((item) => item.role === role);
    if (!binding || binding.view !== view || !definition.DataSetIdentifierDeclarations?.some((item) => item.Identifier === binding.identifier && item.DataSetArn === binding.arn)) errors.push(`Dataset binding missing/stale: ${role}`);
  }
  const known = new Set(sheets.flatMap((sheet) => (sheet.Visuals ?? []).map((visual) => Object.values(visual)[0].VisualId)));
  for (const id of known) if (!reviewedVisualIds.includes(id)) errors.push(`Visual is not explicitly reviewed: ${id}`);
  walk(definition, (item) => {
    if (item.ColumnName && isPrivilegedColumn(item.ColumnName)) errors.push(`Privileged detail field: ${item.ColumnName}`);
    if (item.TableUnaggregatedFieldWells) errors.push("Unaggregated detail tables are not allowed");
  });
  // Person keys are allowed as aggregated measures/window operands, not dimensions.
  for (const sheet of sheets) for (const union of sheet.Visuals ?? []) {
    const visual = Object.values(union)[0];
    walk(visual, (item) => {
      if (["respondent_key", "evidence_key"].includes(item.CategoricalDimensionField?.Column?.ColumnName)) errors.push(`Respondent detail dimension: ${visual.VisualId}`);
    });
    const usesEnterprise = JSON.stringify(visual.ChartConfiguration?.FieldWells ?? {}).includes(`"DataSetIdentifier":"${bindings.find((item) => item.role === "enterprise")?.identifier}"`);
    if (usesEnterprise && !guards.some((guard) => guard.visualId === visual.VisualId && hasGuard(definition, guard))) errors.push(`Post-filter cell guard missing: ${visual.VisualId}`);
  }
  for (const guard of guards) if (!known.has(guard.visualId) || !hasGuard(definition, guard)) errors.push(`Missing/invalid configured guard: ${guard.visualId}`);
  for (const guard of answerStatusFilters) {
    const present = (definition.FilterGroups ?? []).some((group) => group.Status === "ENABLED" && group.CrossDataset === "SINGLE_DATASET"
      && group.ScopeConfiguration?.SelectedSheets?.SheetVisualScopingConfigurations?.some((scope) => scope.SheetId === guard.sheetId && scope.Scope === "SELECTED_VISUALS" && scope.VisualIds?.includes(guard.visualId))
      && group.Filters?.some(({ CategoryFilter: filter }) => filter?.Column?.DataSetIdentifier === guard.dataset && filter.Column.ColumnName === guard.column
        && filter.Configuration?.CustomFilterConfiguration?.MatchOperator === "DOES_NOT_EQUAL"
        && filter.Configuration.CustomFilterConfiguration.CategoryValue === "MISSING"
        && filter.Configuration.CustomFilterConfiguration.NullOption === "NON_NULLS_ONLY"));
    if (!known.has(guard.visualId) || !present) errors.push(`Missing/invalid nonmissing-answer safeguard: ${guard.visualId}`);
  }
  for (const policy of percentagePolicies) {
    if (!known.has(policy.visualId) || policy.basis !== "ALL_NON_MISSING_RECORDED_ANSWERS" || !policy.answerBaseVisualId || !known.has(policy.answerBaseVisualId) || policy.renormalizeVisibleCells !== false) errors.push(`Percentage basis unsafe: ${policy.visualId}`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function hasGuard(definition, guard) {
  if (guard.sourceKey) {
    const sheet = definition.Sheets?.find((item) => item.SheetId === guard.sheetId);
    const visual = sheet?.Visuals?.map((union) => Object.values(union)[0]).find((item) => item.VisualId === guard.visualId);
    if (!visual || guard.aggregation !== "NONE" || !/^respondent_key$|^quick_(?:incumbent|candidate|party|leadership|issue)_(?:missing_)?respondent_key$/.test(guard.sourceKey)
      || JSON.stringify(guard.partitions) !== JSON.stringify(visualPartitionColumns(visual, guard.datasetIdentifier))) return false;
    const window = definition.CalculatedFields?.find((item) => item.DataSetIdentifier === guard.datasetIdentifier && item.Name === guard.column);
    if (window?.Expression !== uniquePersonWindowExpression(guard.sourceKey, guard.partitions)) return false;
    const measuredPersonSources = [];
    walk(visual.ChartConfiguration.FieldWells, (item) => {
      let column = item.CategoricalMeasureField?.Column?.ColumnName;
      const numerical = item.NumericalMeasureField;
      if (numerical) {
        const protectedValue = definition.CalculatedFields?.find((field) => field.DataSetIdentifier === guard.datasetIdentifier && field.Name === numerical.Column?.ColumnName);
        const prefix = `ifelse({${guard.column}} >= 5, distinctCountOver({`;
        const suffix = "}, [], PRE_AGG), NULL)";
        if (guard.partitions.length !== 0 || numerical.AggregationFunction?.SimpleNumericalAggregation !== "MIN" || !protectedValue?.Expression.startsWith(prefix) || !protectedValue.Expression.endsWith(suffix)) {
          measuredPersonSources.push("INVALID_PROTECTED_KPI");
          return;
        }
        column = protectedValue.Expression.slice(prefix.length, -suffix.length);
      }
      if (column === "respondent_key" || column === "evidence_key") measuredPersonSources.push("respondent_key");
      else if (/^quick_\w+_(?:answer|missing)_key$/.test(column ?? "")) measuredPersonSources.push(column.replace("_answer_key", "_respondent_key").replace("_missing_key", "_missing_respondent_key"));
      else if (numerical) measuredPersonSources.push("INVALID_PROTECTED_KPI");
    });
    if (!measuredPersonSources.length || measuredPersonSources.some((source) => source !== guard.sourceKey)) return false;
    if (guard.sourceKey !== "respondent_key") {
      const match = /^quick_(incumbent|candidate|party|leadership|issue)_(missing_)?respondent_key$/.exec(guard.sourceKey);
      const source = { incumbent: "respondent_sentiment", candidate: "candidate_sentiment", party: "party_salience", leadership: "party_leadership", issue: "issue_priority" }[match[1]];
      const conditional = definition.CalculatedFields?.find((item) => item.DataSetIdentifier === guard.datasetIdentifier && item.Name === guard.sourceKey);
      if (conditional?.Expression !== `ifelse({${source}_status} ${match[2] ? "=" : "<>"} 'MISSING', {respondent_key}, NULL)`) return false;
    }
  }
  return (definition.FilterGroups ?? []).some((group) => group.Status === "ENABLED" && group.CrossDataset === "SINGLE_DATASET"
    && group.ScopeConfiguration?.SelectedSheets?.SheetVisualScopingConfigurations?.some((scope) => scope.SheetId === guard.sheetId && scope.Scope === "SELECTED_VISUALS" && scope.VisualIds?.includes(guard.visualId))
    && group.Filters?.some((filter) => {
      const range = filter.NumericRangeFilter;
      const aggregation = range?.AggregationFunction;
      return range?.Column?.DataSetIdentifier === guard.datasetIdentifier && range.Column.ColumnName === guard.column
        && range.NullOption === "NON_NULLS_ONLY" && range.IncludeMinimum === true && range.RangeMinimum?.StaticValue >= 5
        && (guard.aggregation === "NONE" && guard.sourceKey && aggregation === undefined
          || ["SUM", "MIN", "MAX"].includes(guard.aggregation) && aggregation?.NumericalAggregationFunction?.SimpleNumericalAggregation === guard.aggregation);
    }));
}

// Property order is irrelevant; array order remains significant within a visual
// or filter. Service-normalized differences require review, never blind approval.
const canonicalJson = (value) => JSON.stringify((function sorted(item) {
  if (Array.isArray(item)) return item.map(sorted);
  if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sorted(item[key])]));
  return item;
})(value));

/** A successful build alone is not proof that AWS retained the reviewed semantics. */
export function validatePublicationReadback(readback, candidate) {
  const errors = [];
  if (!["CREATION_SUCCESSFUL", "UPDATE_SUCCESSFUL"].includes(readback?.ResourceStatus)) errors.push("Dashboard definition is not successfully built");
  if (readback?.Errors?.length) errors.push("Dashboard definition reports errors");
  const expected = candidate.definition;
  const actual = readback?.Definition;
  const sameSet = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (!actual || !sameSet((actual.DataSetIdentifierDeclarations ?? []).map((x) => `${x.Identifier}:${x.DataSetArn}`), (expected.DataSetIdentifierDeclarations ?? []).map((x) => `${x.Identifier}:${x.DataSetArn}`))) errors.push("Dashboard dataset bindings differ from the reviewed candidate");
  if (!actual || !sameSet((actual.Sheets ?? []).map((x) => `${x.SheetId}:${x.Name}`), expected.Sheets.map((x) => `${x.SheetId}:${x.Name}`))) errors.push("Dashboard sheets differ from the reviewed candidate");
  if (!actual || !sameSet((actual.CalculatedFields ?? []).map((x) => x.Name), (expected.CalculatedFields ?? []).map((x) => x.Name))) errors.push("Dashboard calculated-field identities differ from the reviewed candidate");
  if (!actual || !sameSet((actual.FilterGroups ?? []).map((x) => x.FilterGroupId), (expected.FilterGroups ?? []).map((x) => x.FilterGroupId))) errors.push("Dashboard filter identities differ from the reviewed candidate");
  for (const field of ["CalculatedFields", "FilterGroups", "Sheets"]) {
    if (!actual || !sameSet((actual[field] ?? []).map(canonicalJson), (expected[field] ?? []).map(canonicalJson))) errors.push(`Dashboard ${field} contents differ from the reviewed candidate`);
  }
  if (!actual || canonicalJson(actual.Options) !== canonicalJson(expected.Options)) errors.push("Dashboard options differ from the reviewed candidate");
  if (actual) {
    const safeguards = validatePublicationCandidate({ ...candidate, definition: actual });
    if (!safeguards.valid) errors.push(...safeguards.errors.map((error) => `Readback safeguard: ${error}`));
  }
  return { valid: errors.length === 0, errors };
}

/** UpdateDashboard is NOT publication. Freeze old definitions before any mutation. */
export async function executePublication({ request, candidate, datasets = [], apply = false, publish = false, backup, api, verify, expectedDashboardId }) {
  const validation = validatePublicationCandidate(candidate);
  if (!validation.valid) throw new Error(`Publication candidate rejected:\n${validation.errors.join("\n")}`);
  if (JSON.stringify(request.Definition) !== JSON.stringify(candidate.definition)) throw new Error("UpdateDashboard request is not the validated definition");
  if (!expectedDashboardId || request.DashboardId !== expectedDashboardId) throw new Error("Dashboard identity differs from the approved existing dashboard");
  const digest = createHash("sha256").update(JSON.stringify({ request, datasets })).digest("hex");
  const plan = { mode: apply ? "APPLY" : "DRY_RUN", dashboardId: expectedDashboardId, publish: apply && publish, datasetIds: datasets.map((item) => item.DataSetId), sha256: digest };
  if (!apply) return plan;
  if (typeof backup !== "function" || typeof api !== "function" || typeof verify !== "function") throw new Error("Backup, API and live verification callbacks are mandatory for apply");
  const snapshot = {
    dashboard: await api("DescribeDashboard", { AwsAccountId: request.AwsAccountId, DashboardId: expectedDashboardId }),
    definition: await api("DescribeDashboardDefinition", { AwsAccountId: request.AwsAccountId, DashboardId: expectedDashboardId, AliasName: "$PUBLISHED" }),
    datasets: []
  };
  const publishedBindings = snapshot.definition?.Definition?.DataSetIdentifierDeclarations;
  if (!Array.isArray(publishedBindings) || publishedBindings.length === 0 || publishedBindings.some((item) => !/^arn:aws:quicksight:[a-z0-9-]+:\d{12}:dataset\/[^/]+$/.test(item.DataSetArn ?? ""))) throw new Error("Verified published dataset bindings are required before staging mutations");
  const publishedIds = new Set(publishedBindings.map((item) => item.DataSetArn.split(":dataset/")[1]));
  const candidateIds = new Set(candidate.bindings.map((item) => item.arn.split(":dataset/")[1]));
  for (const dataset of datasets) {
    if (dataset.AwsAccountId !== request.AwsAccountId || !candidateIds.has(dataset.DataSetId)) throw new Error("Staged dataset update must bind to the reviewed candidate and AWS account");
    if (publishedIds.has(dataset.DataSetId)) throw new Error("Cannot mutate a dataset used by the published dashboard; use a separate staged dataset");
  }
  for (const dataset of datasets) snapshot.datasets.push(await api("DescribeDataSet", { AwsAccountId: request.AwsAccountId, DataSetId: dataset.DataSetId }));
  const receipt = await backup(snapshot, { ...plan, candidateRequest: request, datasetRequests: datasets });
  if (!receipt?.durable || !receipt.path || receipt.sha256 !== digest) throw new Error("Verified durable backup receipt is required before any mutation");
  const datasetResults = [];
  for (const dataset of datasets) datasetResults.push(await api("UpdateDataSet", dataset));
  const updated = await api("UpdateDashboard", request);
  if (!updated.VersionArn) throw new Error("UpdateDashboard did not return a version ARN; never guess a version");
  const match = updated.VersionArn.match(/\/version\/(\d+)$/);
  if (!match) throw new Error("Unexpected dashboard version ARN");
  const versionNumber = Number(match[1]);
  // Callback must wait for SPICE ingestion and dashboard UPDATE_SUCCESSFUL,
  // compare retained IDs, then test selected filters/minimum bases live.
  const verification = await verify({ versionNumber, updated, datasetResults, candidate, snapshot });
  if (verification?.status !== "VERIFIED" || verification.versionNumber !== versionNumber) throw new Error("Live verification did not approve the exact unpublished version");
  const readback = await api("DescribeDashboardDefinition", { AwsAccountId: request.AwsAccountId, DashboardId: expectedDashboardId, VersionNumber: versionNumber });
  const readbackValidation = validatePublicationReadback(readback, candidate);
  if (!readbackValidation.valid) throw new Error(`Dashboard readback rejected: ${readbackValidation.errors.join("; ")}`);
  if (!publish) return { ...plan, versionNumber, status: "VERIFIED_UNPUBLISHED", backupPath: receipt.path };
  const published = await api("UpdateDashboardPublishedVersion", { AwsAccountId: request.AwsAccountId, DashboardId: expectedDashboardId, VersionNumber: versionNumber });
  return { ...plan, versionNumber, status: "PUBLISHED", backupPath: receipt.path, published };
}
