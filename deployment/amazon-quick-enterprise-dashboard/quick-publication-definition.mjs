import { applyPartyColors, applySentimentColors, minimumCellFilter, privacyPartitionColumns, PRIVACY_DISPLAY_DIMENSIONS, uniquePersonWindowExpression, REPORTING_VIEWS, REQUIRED_SHEETS, VALIDATION_DISCLOSURE } from "./quick-publication-plan.mjs";
import { getSentimentValidation, reportingCategoryLabels, OUTPUT_KEYS, DISCLOSURE_POLICY_VERSION } from "../output-variable-standardization/output-normalization.repository.js";
import { ADDITIONAL_INSIGHT_VISUALS, EXISTING_VISUAL_NOTES } from "./quick-insight-catalog.mjs";

const text = (value) => ({ Visibility: "VISIBLE", FormatText: { PlainText: value } });
const dim = (dataset, column, id) => ({ CategoricalDimensionField: { FieldId: id, Column: { DataSetIdentifier: dataset, ColumnName: column } } });
const count = (dataset, column, id) => ({ CategoricalMeasureField: { FieldId: id, Column: { DataSetIdentifier: dataset, ColumnName: column }, AggregationFunction: "DISTINCT_COUNT" } });
const number = (dataset, column, id, aggregation = "MIN") => ({ NumericalMeasureField: {
  FieldId: id, Column: { DataSetIdentifier: dataset, ColumnName: column },
  ...(aggregation ? { AggregationFunction: { SimpleNumericalAggregation: aggregation } } : {})
} });
const numericDim = (dataset, column, id) => ({ NumericalDimensionField: { FieldId: id, Column: { DataSetIdentifier: dataset, ColumnName: column } } });
const wrap = (kind, id, title, subtitle, config) => ({ [kind]: { VisualId: id, Title: text(title), Subtitle: text(subtitle), ChartConfiguration: config } });
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Display labels reference the existing field wells; neither grouping nor
// aggregation changes when internal source names are replaced on the axes.
const barAxisLabels = (wells) => {
  const dimensions = {
    age_band: "Age group", gender: "Gender", mandal_name: "Mandal",
    constituency_name: "Constituency", iteration_number: "Iteration",
    campaign_name: "Campaign", quick_iteration_label: "Iteration",
    party_salience: "Party attention", party_leadership: "Party perceived as responsive",
    candidate_sentiment: "Candidate impression", respondent_sentiment: "Incumbent assessment",
    issue_priority: "Issue priority", quick_issue_answer_state: "Answer status"
  };
  const measures = {
    evidence_key: "Survey observations",
    quick_incumbent_answer_key: "Recorded answers", quick_candidate_answer_key: "Recorded answers",
    quick_party_answer_key: "Recorded answers", quick_leadership_answer_key: "Recorded answers",
    quick_issue_answer_key: "Recorded answers",
    positive_sentiment_change_pct: "Change (percentage points)",
    candidate_positive_change_pct: "Change (percentage points)"
  };
  const options = (fields, labels) => ({
    Visibility: "VISIBLE",
    AxisLabelOptions: fields.map((field) => {
      const reference = Object.values(field)[0];
      const CustomLabel = labels[reference.Column.ColumnName];
      if (!CustomLabel) throw new Error(`Friendly bar-axis label required for ${reference.Column.ColumnName}`);
      return { ApplyTo: { Column: structuredClone(reference.Column), FieldId: reference.FieldId }, CustomLabel };
    })
  });
  return {
    CategoryLabelOptions: options(wells.Category, dimensions),
    ...(wells.Colors?.length ? { ColorLabelOptions: options(wells.Colors, dimensions) } : {}),
    ValueLabelOptions: options(wells.Values, measures)
  };
};

// Markup is verified from AWS's exported CUDOS definition, not HTML grammar:
// https://github.com/aws-samples/aws-cudos-framework-deployment/blob/main/dashboards/cudos/CUDOS-v5-definition.yaml
// Content uses a text-box root and inline font-size="16px" descendants.
export const quickTextBoxContent = (value) => `<text-box><inline font-size="16px">${escape(value)}</inline></text-box>`;

/**
 * Offline API definition generator. Requires existing dataset ARNs and a saved
 * dashboard definition; uses its sheet IDs, not a replacement dashboard ID.
 * AWS must validate this candidate, complete ingestion and perform live filter
 * checks before the separate publication operation is authorized to run.
 */
export function buildGovernedDefinition({ bindings, existingDefinition, mapVisual, sentimentValidation = getSentimentValidation() }) {
  const role = Object.fromEntries(bindings.map((item) => [item.role, item.identifier]));
  for (const [name, view] of Object.entries(REPORTING_VIEWS)) if (!bindings.some((item) => item.role === name && item.view === view && item.arn)) throw new Error(`Governed ${name} dataset binding is required`);
  if (!existingDefinition?.Sheets?.length) throw new Error("Existing dashboard definition backup is required");
  if (sentimentValidation.status !== "HUMAN_REVIEW_PENDING" || sentimentValidation.method !== "EXPLICIT_LABEL_MAPPING" || sentimentValidation.normalizationVersion !== "OUTPUT_TAXONOMY_V2" || !/^[a-f0-9]{64}$/.test(sentimentValidation.ruleHash ?? "")) throw new Error("Verified Step 4 validation metadata is required; never manufacture a validation status");
  const result = {
    DataSetIdentifierDeclarations: bindings.map((item) => ({ Identifier: item.identifier, DataSetArn: item.arn })),
    CalculatedFields: [], FilterGroups: [], Sheets: [],
    // Retain disabled insights and every saved action/security option. Building
    // reporting visuals must not silently change unrelated dashboard features.
    Options: { ...structuredClone(existingDefinition.Options ?? {}),
      WeekStart: existingDefinition.Options?.WeekStart ?? "MONDAY",
      QBusinessInsightsStatus: existingDefinition.Options?.QBusinessInsightsStatus ?? "DISABLED"
    }
  };
  const guards = [], partitionGuards = [], answerBaseGuards = [], answerStatusFilters = [], reviewedVisualIds = [], filterScopes = [];
  const enterprise = role.enterprise;
  const calc = (dataset, name, expression) => {
    if (!result.CalculatedFields.some((item) => item.DataSetIdentifier === dataset && item.Name === name)) result.CalculatedFields.push({ DataSetIdentifier: dataset, Name: name, Expression: expression });
    return name;
  };
  for (const dataset of new Set([role.enterprise, role.geographic, role.movement, role.comparability, role.map].filter(Boolean))) calc(dataset, "quick_iteration_label", PRIVACY_DISPLAY_DIMENSIONS.quick_iteration_label.expression);
  calc(enterprise, "quick_party_label", "{party_salience}");
  calc(role.geographic, "quick_party_label", "{party_name}");
  if (role.map) calc(role.map, "quick_party_label", "{party_name}");
  // Quick converts PostgreSQL BOOLEAN to integer 1/0 in SPICE.
  // https://docs.aws.amazon.com/quick/latest/userguide/supported-data-types-and-values.html
  calc(role.comparability, "quick_declaration_status", "ifelse({design_declared} = 1, 'Declared', 'Undeclared')");
  for (const name of ["sentiment_answer_base", "candidate_answer_base"]) calc(role.movement, `quick_reportable_${name}`, `ifelse({${name}} >= 5, {${name}}, NULL)`);
  for (const [kind, source] of [["incumbent", "respondent_sentiment"], ["candidate", "candidate_sentiment"], ["party", "party_salience"], ["leadership", "party_leadership"], ["issue", "issue_priority"]]) {
    calc(enterprise, `quick_${kind}_answer_key`, `ifelse({${source}_status} <> 'MISSING', {evidence_key}, NULL)`);
    calc(enterprise, `quick_${kind}_missing_key`, `ifelse({${source}_status} = 'MISSING', {evidence_key}, NULL)`);
    calc(enterprise, `quick_${kind}_respondent_key`, `ifelse({${source}_status} <> 'MISSING', {respondent_key}, NULL)`);
    calc(enterprise, `quick_${kind}_missing_respondent_key`, `ifelse({${source}_status} = 'MISSING', {respondent_key}, NULL)`);
    calc(enterprise, `quick_${kind}_base`, `distinctCountOver({quick_${kind}_answer_key}, [], PRE_AGG)`);
  }
  calc(enterprise, "quick_incumbent_age_base", "distinctCountOver({quick_incumbent_answer_key}, [{age_band}], PRE_AGG)");
  calc(enterprise, "quick_party_gender_base", "distinctCountOver({quick_party_answer_key}, [{gender}], PRE_AGG)");
  calc(enterprise, "quick_party_mandal_base", "distinctCountOver({quick_party_answer_key}, [{mandal_name}], PRE_AGG)");
  calc(enterprise, "quick_incumbent_constituency_base", "distinctCountOver({quick_incumbent_answer_key}, [{constituency_name}], PRE_AGG)");
  for (const insight of ADDITIONAL_INSIGHT_VISUALS) if (insight.answerBase) {
    const kind = insight.id.includes("candidate") ? "candidate" : insight.id.includes("incumbent") ? "incumbent" : "issue";
    calc(enterprise, insight.answerBase, `distinctCountOver({quick_${kind}_answer_key}, [${insight.answerBasePartitions.map((column) => `{${column}}`).join(", ")}], PRE_AGG)`);
  }
  // AWS's ifelse examples support double-quoted string literals. This avoids
  // depending on an undocumented single-quote escape for the Can't say label.
  calc(enterprise, "quick_issue_answer_state", PRIVACY_DISPLAY_DIMENSIONS.quick_issue_answer_state.expression);
  for (const [name, numerator, denominator, multiplier] of [
    ["quick_connection_pct", "connected_calls", "call_attempts", 100],
    ["quick_response_pct", "responses_captured", "connected_calls", 100],
    ["quick_transcript_pct", "transcripts_captured", "connected_calls", 100],
    ["quick_callback_pct", "callbacks_received", "call_attempts", 100]
  ]) calc(role.quality, name, `ifelse(sum({${denominator}}) > 0, ${multiplier}.0 * sum({${numerator}}) / sum({${denominator}}), NULL)`);
  calc(role.quality, "quick_demographic_pct", "ifelse(sum({respondent_base}) > 0, 100.0 * (sum({known_gender_respondents}) + sum({known_age_respondents}) + sum({known_mandal_respondents})) / (3 * sum({respondent_base})), NULL)");

  const addGuard = (sheet, id, dataset = enterprise, column = "respondent_key", aggregation = "DISTINCT_COUNT") => {
    let sourceMetadata = {};
    if (dataset === enterprise) {
      const sourceKey = column;
      const visual = sheet.Visuals.map((union) => Object.values(union)[0]).find((item) => item.VisualId === id);
      const partitions = privacyPartitionColumns(visual, dataset);
      column = calc(dataset, `quick_cell_${id.replaceAll("-", "_")}_${sourceKey}_count`, uniquePersonWindowExpression(sourceKey, partitions));
      aggregation = "NONE";
      sourceMetadata = { sourceKey, partitions, stage: "PRE_AGG_AFTER_DIMENSION_FILTERS" };
    }
    const guard = { datasetIdentifier: dataset, sheetId: sheet.SheetId, visualId: id, id: `${id}-${column}-minimum`, column, aggregation, ...sourceMetadata };
    result.FilterGroups.push(minimumCellFilter(guard)); guards.push(guard);
    if (dataset === enterprise) {
      // Protect every category of a construct together, including missingness.
      // Category-level hiding beside a full answered KPI leaks complements.
      // Independent conditional-key windows avoid unsupported nested LAC-W.
      const taxonomy = {
        incumbent: ['respondent_sentiment', ['incumbent_assessment']], candidate: ['candidate_sentiment', OUTPUT_KEYS.candidate],
        party: ['party_salience', OUTPUT_KEYS.party], leadership: ['party_leadership', OUTPUT_KEYS.leadership], issue: ['issue_priority', OUTPUT_KEYS.issue]
      };
      const selectedKind = /^quick_(incumbent|candidate|party|leadership|issue)_/.exec(sourceMetadata.sourceKey || '')?.[1];
      const kinds = selectedKind ? [selectedKind] : Object.keys(taxonomy);
      const checks = [];
      for (const kind of kinds) {
        const [dimension, keys] = taxonomy[kind];
        const partitions = sourceMetadata.partitions.filter((name) => ![dimension, `${dimension}_status`, 'quick_issue_answer_state', 'quick_party_label'].includes(name));
        const labels = [...reportingCategoryLabels(keys), 'No response'];
        for (const [index, label] of labels.entries()) {
          const key = calc(dataset, `quick_partition_${kind}_${index}_person_key`, `ifelse({${dimension}} = ${JSON.stringify(label)}, {respondent_key}, NULL)`);
          const name = calc(dataset, `quick_partition_${kind}_${index}_${partitions.join('_') || 'all'}_count`, uniquePersonWindowExpression(key, partitions));
          checks.push(`({${name}} > 0 AND {${name}} < 5)`);
        }
      }
      const protectedColumn = calc(dataset, `quick_partition_${id.replaceAll('-', '_')}_safe`, `ifelse(${checks.join(' OR ')}, 0, 5)`);
      const partitionGuard = { datasetIdentifier: dataset, sheetId: sheet.SheetId, visualId: id,
        id: `${id}-whole-partition`, column: protectedColumn, aggregation: 'NONE', policy: DISCLOSURE_POLICY_VERSION, kinds };
      result.FilterGroups.push(minimumCellFilter(partitionGuard)); partitionGuards.push(partitionGuard);
    }
  };
  const addAnswerBaseGuard = (sheet, id, column) => {
    const filterId = `${id}-${column}-answer-base`;
    result.FilterGroups.push({
      FilterGroupId: `${filterId}-group`, Status: "ENABLED", CrossDataset: "SINGLE_DATASET",
      ScopeConfiguration: { SelectedSheets: { SheetVisualScopingConfigurations: [{ SheetId: sheet.SheetId, Scope: "SELECTED_VISUALS", VisualIds: [id] }] } },
      Filters: [{ NumericRangeFilter: { FilterId: filterId, Column: { DataSetIdentifier: enterprise, ColumnName: column }, NullOption: "NON_NULLS_ONLY", RangeMinimum: { StaticValue: 5 }, IncludeMinimum: true } }]
    });
    answerBaseGuards.push({ sheetId: sheet.SheetId, visualId: id, column, stage: "PRE_AGG_AFTER_DIMENSION_FILTERS" });
  };
  const excludeMissingPartyRows = (sheet, visualId, dataset) => {
    const filterId = `${visualId}-party-answer-status`;
    // Geographic rollups include separately coded nonresponses. Only MISSING
    // is excluded: explicit uncertainty, refusal and uncoded answers remain.
    result.FilterGroups.push({
      FilterGroupId: `${filterId}-group`, Status: "ENABLED", CrossDataset: "SINGLE_DATASET",
      ScopeConfiguration: { SelectedSheets: { SheetVisualScopingConfigurations: [{ SheetId: sheet.SheetId, Scope: "SELECTED_VISUALS", VisualIds: [visualId] }] } },
      Filters: [{ CategoryFilter: { FilterId: filterId, Column: { DataSetIdentifier: dataset, ColumnName: "party_answer_status" }, Configuration: { CustomFilterConfiguration: { MatchOperator: "DOES_NOT_EQUAL", CategoryValue: "MISSING", NullOption: "NON_NULLS_ONLY" } } } }]
    });
    answerStatusFilters.push({ sheetId: sheet.SheetId, visualId, dataset, column: "party_answer_status", excluded: ["MISSING"] });
  };
  const add = (sheet, visual, { guardColumn, dataset = enterprise, aggregation, answerBase } = {}) => {
    const body = Object.values(visual)[0];
    if (visual.BarChartVisual) Object.assign(body.ChartConfiguration, barAxisLabels(body.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells));
    sheet.Visuals.push(visual); reviewedVisualIds.push(body.VisualId);
    addGuard(sheet, body.VisualId, dataset, guardColumn ?? (dataset === enterprise ? "respondent_key" : "respondent_base"), aggregation ?? (dataset === enterprise ? "DISTINCT_COUNT" : "MIN"));
    if (answerBase) addAnswerBaseGuard(sheet, body.VisualId, answerBase);
    return body.VisualId;
  };
  const privacyKey = (observationKey) => observationKey === "evidence_key" ? "respondent_key" : observationKey.replace("_answer_key", "_respondent_key").replace("_missing_key", "_missing_respondent_key");
  const conditionalKey = (dimension) => ({ respondent_sentiment: "quick_incumbent_answer_key", candidate_sentiment: "quick_candidate_answer_key", party_salience: "quick_party_answer_key", party_leadership: "quick_leadership_answer_key", issue_priority: "quick_issue_answer_key" }[dimension] ?? "evidence_key");
  const kpi = (sheet, id, title, column, options = {}) => {
    const valueField = `quick_kpi_${id.replaceAll("-", "_")}_value`;
    add(sheet, wrap("KPIVisual", id, title, "Filtered base; cells with fewer than five unique respondents are withheld (No data), never shown as zero", { FieldWells: { Values: [number(enterprise, valueField, `${id}-value`, "MIN")] } }), { guardColumn: privacyKey(column), ...options });
    const guard = guards.find((item) => item.visualId === id && item.datasetIdentifier === enterprise);
    // COUNT on an empty suppressed set returns 0. A protected numeric window
    // with MIN returns null/No data and cannot disguise withholding as zero.
    calc(enterprise, valueField, `ifelse({${guard.column}} >= 5, distinctCountOver({${column}}, [], PRE_AGG), NULL)`);
    return id;
  };
  const bar = (sheet, id, title, category, color, answerBase) => add(sheet, wrap("BarChartVisual", id, title,
    "Respondent–Iteration observations · category cells n ≥ 5 after filters · not vote share", {
      FieldWells: { BarChartAggregatedFieldWells: { Category: [dim(enterprise, category, `${id}-category`)], Values: [count(enterprise, conditionalKey(color ?? category), `${id}-value`)], ...(color ? { Colors: [dim(enterprise, color, `${id}-color`)] } : {}) } },
      BarsArrangement: color ? "STACKED" : "CLUSTERED", Orientation: "HORIZONTAL",
      DataLabels: { Visibility: "VISIBLE", LabelContent: "VALUE", MeasureLabelVisibility: "VISIBLE", CategoryLabelVisibility: "HIDDEN" }
    }), { answerBase, guardColumn: privacyKey(conditionalKey(color ?? category)) });
  const pie = (sheet, id, title, category, answerBase) => add(sheet, wrap("PieChartVisual", id, title,
    "Counts only; withheld slices are not renormalized into a percentage claim", {
      FieldWells: { PieChartAggregatedFieldWells: { Category: [dim(enterprise, category, `${id}-category`)], Values: [count(enterprise, conditionalKey(category), `${id}-value`)] } },
      DataLabels: { Visibility: "VISIBLE", LabelContent: "VALUE", MeasureLabelVisibility: "VISIBLE", CategoryLabelVisibility: "VISIBLE", Position: "OUTSIDE" }
    }), { answerBase, guardColumn: privacyKey(conditionalKey(category)) });
  const heat = (sheet, id, title, rows, columns, answerBase) => add(sheet, wrap("HeatMapVisual", id, title,
    "Intensity represents recorded observation counts, not inferred alignment · cells n ≥ 5", {
      FieldWells: { HeatMapAggregatedFieldWells: { Rows: [dim(enterprise, rows, `${id}-row`)], Columns: [dim(enterprise, columns, `${id}-column`)], Values: [count(enterprise, conditionalKey(columns), `${id}-value`)] } },
      DataLabels: { Visibility: "VISIBLE", LabelContent: "VALUE" }
    }), { answerBase, guardColumn: privacyKey(conditionalKey(columns)) });
  const table = (sheet, id, title, dataset, dimensions, measures, guardColumn = "respondent_base", subtitle = "Aggregate rows only; no respondent details") => add(sheet, wrap("TableVisual", id, title, subtitle, {
    FieldWells: { TableAggregatedFieldWells: { GroupBy: dimensions.map((column) => column === "iteration_number" ? numericDim(dataset, column, `${id}-${column}`) : dim(dataset, column, `${id}-${column}`)), Values: measures.map((column) => number(dataset, column, `${id}-${column}`)) } }
  }), { dataset, guardColumn, aggregation: "MIN" });

  for (const [index, name] of REQUIRED_SHEETS.entries()) {
    const existing = existingDefinition.Sheets.find((sheet) => sheet.Name === name);
    const sheet = { SheetId: existing?.SheetId ?? `quick-governed-sheet-${index}`, Name: name, Visuals: [], FilterControls: [], TextBoxes: [] };
    let explanation = `${VALIDATION_DISCLOSURE} Rules/implementation SHA-256: ${sentimentValidation.ruleHash}.`;
    if (index <= 2) explanation += " Pooled charts count respondent–Iteration observations, not independent people. Selecting one Iteration gives that wave. Every category cell requires at least five distinct people after filters; repeated waves do not satisfy that threshold. Missing answers are excluded from construct distributions and displayed separately when reportable. Explicit uncertainty, refusals, Mixed and Uncoded remain separate; raw sentences never become chart categories.";
    if (index === 2) explanation += " Maps show recorded party-salience counts only; not vote choice. Demo Serilingampally centroids are approximate, not verified Mandal boundaries. Geographic rollups do not support age or gender filters.";
    if (index === 3) explanation += " Full consecutive Iterations/all Runs only. No demographic/Mandal/party filtering. Changes require declared comparable frozen instruments and at least five non-missing answers in both waves. Null is unavailable, not zero; no waves are bridged.";
    if (index === 4) explanation += " Whole-Campaign operational fieldwork. Rates use summed numerators and denominators. Method declarations below are actual recorded registry values, not applied survey weights. Evidence status is not confidence or representativeness. No age, gender, Mandal or Iteration filtering for campaign totals. The Program control filters fieldwork only; the registry view has no Program field. Select Campaign to scope both fieldwork and the methodology registry.";
    // Keep the report canvas readable; full definitions remain available on a
    // separate native sheet even when a chart has no selectable data point.
    const context = index === 3 ? "Full Iterations · comparable adjacent waves only · unavailable is not zero"
      : index === 4 ? "Whole-Campaign fieldwork · Campaign scopes both tables; Program scopes fieldwork only"
      : index === 2 ? "Recorded counts · approximate demo map · no age/gender map filters"
      : "Recorded survey counts · select an Iteration for one wave";
    sheet.TextBoxes.push({ SheetTextBoxId: `${sheet.SheetId}-research-disclosure`, Content: quickTextBoxContent(`Demo · unweighted · human review pending · cells need 5 distinct people. ${context}. Definitions: Measurement guide.`) });
    sheet.measurementExplanation = explanation;
    result.Sheets.push(sheet);
  }
  const [leadership, demographic, geographic, movement, quality] = result.Sheets;
  kpi(leadership, "quick-unique-respondents", "Unique respondents across selected waves", "respondent_key");
  kpi(leadership, "quick-evidence-observations", "Respondent–Iteration observations", "evidence_key");
  kpi(leadership, "quick-incumbent-answer-base", "Incumbent assessment · answered base", "quick_incumbent_answer_key");
  kpi(leadership, "quick-candidate-answer-base", "Candidate impression · answered base", "quick_candidate_answer_key");
  pie(leadership, "quick-incumbent-count", "Incumbent performance assessment · human review pending", "respondent_sentiment", "quick_incumbent_base");
  bar(leadership, "quick-party-count", "Recorded party salience", "party_salience", null, "quick_party_base");
  bar(leadership, "quick-candidate-count", "Candidate impression · human review pending", "candidate_sentiment", null, "quick_candidate_base");
  bar(leadership, "quick-leadership-count", "Recorded issue leadership", "party_leadership", null, "quick_leadership_base");
  bar(leadership, "quick-issue-count", "Recorded issue priorities", "issue_priority", null, "quick_issue_base");
  kpi(leadership, "quick-incumbent-missing", "Incumbent assessment · no response", "quick_incumbent_missing_key");
  kpi(leadership, "quick-candidate-missing", "Candidate impression · no response", "quick_candidate_missing_key");
  bar(demographic, "quick-age-count", "Age bands · 18–29 / 30–39 / 40–49 / 50+", "age_band");
  bar(demographic, "quick-age-incumbent", "Incumbent performance assessment by age", "age_band", "respondent_sentiment", "quick_incumbent_age_base");
  pie(demographic, "quick-gender-count", "Gender composition", "gender");
  bar(demographic, "quick-gender-party", "Recorded party salience by gender", "gender", "party_salience", "quick_party_gender_base");
  bar(geographic, "quick-mandal-party", "Mandal × recorded party salience", "mandal_name", "party_salience", "quick_party_mandal_base");
  heat(geographic, "quick-mandal-party-heat", "Mandal × recorded party salience · count intensity", "mandal_name", "party_salience", "quick_party_mandal_base");
  heat(geographic, "quick-constituency-incumbent", "Constituency × incumbent assessment · count intensity", "constituency_name", "respondent_sentiment", "quick_incumbent_constituency_base");
  if (mapVisual) {
    const map = structuredClone(mapVisual);
    const body = map.GeospatialMapVisual;
    if (!body?.ChartConfiguration?.FieldWells?.GeospatialMapAggregatedFieldWells) throw new Error("Only a verified saved GeospatialMapVisual template may be reused");
    body.VisualId = "quick-mandal-party-map";
    body.Title = text("Mandal party-salience observations · demo centroids");
    body.Subtitle = text("Approximate demo geolocation; no demographic filtering, vote choice or inferred alignment");
    const mapDataset = role.map ?? role.geographic;
    const wells = body.ChartConfiguration.FieldWells.GeospatialMapAggregatedFieldWells;
    const rewrite = (item) => { if (!item || typeof item !== "object") return; if (item.Column?.DataSetIdentifier) item.Column.DataSetIdentifier = mapDataset; for (const child of Object.values(item)) if (typeof child === "object") rewrite(child); };
    rewrite(wells);
    wells.Colors = [dim(mapDataset, "party_name", "quick-map-party")];
    wells.Values = [number(mapDataset, "respondent_count", "quick-map-count", "SUM")];
    body.ChartConfiguration.Tooltip = { TooltipVisibility: "VISIBLE", SelectedTooltipType: "BASIC" };
    add(geographic, map, { dataset: mapDataset, guardColumn: "respondent_count", aggregation: "SUM" });
    excludeMissingPartyRows(geographic, body.VisualId, mapDataset);
  }
  table(geographic, "quick-map-evidence-table", "Mandal map evidence · already-qualified rows", role.geographic,
    ["campaign_name", "iteration_number", "mandal_name", "party_name", "interpretation_label"], ["respondent_count"], "respondent_count",
    "Geography×party cells already have n ≥ 5. No demographic scope or numeric party-strength claim.");
  excludeMissingPartyRows(geographic, "quick-map-evidence-table", role.geographic);
  for (const [id, title, value, base, previousBase] of [
    ["quick-incumbent-movement", "Qualified positive incumbent-assessment change (pp)", "positive_sentiment_change_pct", "sentiment_answer_base", "previous_sentiment_answer_base"],
    ["quick-candidate-movement", "Qualified positive candidate-impression change (pp)", "candidate_positive_change_pct", "candidate_answer_base", "previous_candidate_answer_base"]
  ]) {
    add(movement, wrap("BarChartVisual", id, title, "Descriptive adjacent-wave change only · unavailable nulls are not zero", {
      FieldWells: { BarChartAggregatedFieldWells: { Category: [numericDim(role.movement, "iteration_number", `${id}-iteration`)], Colors: [dim(role.movement, "campaign_name", `${id}-campaign`)], Values: [number(role.movement, value, `${id}-value`)] } }, BarsArrangement: "CLUSTERED", Orientation: "VERTICAL"
    }), { dataset: role.movement, guardColumn: base, aggregation: "MIN" });
    addGuard(movement, id, role.movement, previousBase, "MIN");
  }
  table(movement, "quick-wave-evidence", "Standalone wave evidence and answered/missing coverage", role.movement,
    ["campaign_name", "iteration_number", "comparison_basis", "sentiment_construct", "candidate_construct", "interpretation_label", "percentage_basis"],
    ["respondent_base", "quick_reportable_sentiment_answer_base", "quick_reportable_candidate_answer_base"], "respondent_base");
  table(movement, "quick-movement-reasons", "Why movement is unavailable", role.movement,
    ["campaign_name", "iteration_number", "comparison_basis", "comparison_reasons"], ["respondent_base"], "respondent_base");
  for (const [id, title, column] of [
    ["quick-quality-connection", "Connection rate · % of call attempts", "quick_connection_pct"],
    ["quick-quality-output", "Structured-output coverage · % connected", "quick_response_pct"],
    ["quick-quality-transcript", "Transcript coverage · % connected", "quick_transcript_pct"],
    ["quick-quality-callback", "Callback coverage · % call attempts", "quick_callback_pct"],
    ["quick-quality-demographics", "Demographic completeness · % required fields", "quick_demographic_pct"]
  ]) add(quality, wrap("KPIVisual", id, title, "Whole Campaign operational ratio; summed numerators/denominators", { FieldWells: { Values: [number(role.quality, column, `${id}-value`, null)] } }), { dataset: role.quality, guardColumn: "respondent_base", aggregation: "SUM" });
  table(quality, "quick-quality-evidence", "Campaign fieldwork and evidence qualification", role.quality,
    ["campaign_name", "evidence_quality_status", "interpretation_label"], ["call_attempts", "connected_calls", "callbacks_received", "transcripts_captured", "responses_captured", "respondent_base"], "respondent_base");
  // Do not show hard-coded quality_v1 sampling_design/weighting_status as declarations.
  const gateTable = wrap("TableVisual", "quick-comparability-registry", "Recorded methodology and comparison gate", "Actual registry labels; undeclared is not comparable; declarations do not apply weights", {
    FieldWells: { TableAggregatedFieldWells: { GroupBy: ["campaign_name", "iteration_number", "iteration_name", "sampling_method", "weighting_status", "fieldwork_mode", "quick_declaration_status", "comparison_status", "comparison_reasons"].map((column) => column === "iteration_number" ? numericDim(role.comparability, column, `quick-gate-${column}`) : dim(role.comparability, column, `quick-gate-${column}`)), Values: [] } }
  });
  quality.Visuals.push(gateTable); reviewedVisualIds.push("quick-comparability-registry");

  const byRole = { leadership, demographic, geographic };
  for (const insight of ADDITIONAL_INSIGHT_VISUALS) {
    const sheet = byRole[insight.sheetRole];
    if (insight.kind === "BAR") bar(sheet, insight.id, insight.title, insight.statusLabels ? "quick_issue_answer_state" : insight.category, insight.color, insight.answerBase);
    else if (insight.kind === "HEAT") heat(sheet, insight.id, insight.title, insight.row, insight.column, insight.answerBase);
    else throw new Error(`Unsupported insight kind: ${insight.kind}`);
  }
  const guide = { SheetId: existingDefinition.Sheets.find((sheet) => sheet.Name === "Measurement guide")?.SheetId ?? "quick-measurement-guide", Name: "Measurement guide", Visuals: [], FilterControls: [], TextBoxes: [] };
  const insightNotes = Object.fromEntries(ADDITIONAL_INSIGHT_VISUALS.map((insight) => [insight.id, insight]));
  const measurementNotes = [];
  const guideBox = (id, value) => {
    // Quick grid cells may span at most 21 rows. Split long definitions into
    // bounded boxes instead of clipping a multi-page paragraph into one cell.
    let remaining = value, part = 0;
    while (remaining.length) {
      const end = remaining.length > 1150 ? remaining.lastIndexOf(" ", 1150) : remaining.length;
      if (end <= 0) throw new Error(`Unbreakable measurement note: ${id}`);
      guide.TextBoxes.push({ SheetTextBoxId: `${guide.SheetId}-${id}-${part++}`, Content: quickTextBoxContent(remaining.slice(0, end)) });
      remaining = remaining.slice(end).trimStart();
    }
  };
  guideBox("intro", `How to read these reports. ${VALIDATION_DISCLOSURE} Rules/implementation SHA-256: ${sentimentValidation.ruleHash}. Charts show recorded evidence, not voting predictions or individual profiles. Unknown, missing, withheld and not comparable are different states. Use the report tabs to return; filters remain sheet-specific.`);
  for (const sheet of result.Sheets) {
    guideBox(`${sheet.SheetId}-scope`, `${sheet.Name}. ${sheet.measurementExplanation}`);
    for (const union of sheet.Visuals) {
      const [kind, visual] = Object.entries(union)[0];
      const note = insightNotes[visual.VisualId] ?? EXISTING_VISUAL_NOTES[visual.VisualId];
      if (!note) throw new Error(`Measurement note required for ${visual.VisualId}`);
      visual.Title = text(note.title); visual.Subtitle = text(note.subtitle);
      guideBox(visual.VisualId, `${note.title}: ${note.measurementNote}`);
      measurementNotes.push({ visualId: visual.VisualId, sheetId: sheet.SheetId, title: note.title, measurementNote: note.measurementNote });
      // Local navigation only; never a URL action, individual-level filter or
      // change to the saved left-click highlight operation/security options.
      visual.Actions = [{ CustomActionId: `${visual.VisualId}-measurement-note`, Name: "How it’s measured", Status: "ENABLED", Trigger: "DATA_POINT_MENU", ActionOperations: [{ NavigationOperation: { LocalNavigationConfiguration: { TargetSheetId: guide.SheetId } } }] }];
      if (["BarChartVisual", "PieChartVisual", "HeatMapVisual"].includes(kind) && visual.ChartConfiguration.FieldWells) {
        const valueId = `${visual.VisualId}-value`;
        // Only generated fields are used; saved map tooltip IDs are not reused.
        const fields = [{ FieldTooltipItem: { FieldId: valueId, Label: sheet === movement ? "Percentage-point change" : "Recorded response count", Visibility: "VISIBLE" } }];
        const base = answerBaseGuards.find((item) => item.visualId === visual.VisualId);
        if (base) fields.push({ ColumnTooltipItem: { Column: { DataSetIdentifier: enterprise, ColumnName: base.column }, Aggregation: { NumericalAggregationFunction: { SimpleNumericalAggregation: "MIN" } }, Label: "Full answered base · this row", Visibility: "VISIBLE" } });
        visual.ChartConfiguration.Tooltip = { TooltipVisibility: "VISIBLE", SelectedTooltipType: "DETAILED", FieldBasedTooltip: { AggregationVisibility: "HIDDEN", TooltipTitleType: "PRIMARY_VALUE", TooltipFields: fields } };
      }
    }
    delete sheet.measurementExplanation;
  }
  result.Sheets.push(guide);

  const controls = (sheet, dataset, columns, crossDataset = "SINGLE_DATASET", visualIds) => {
    for (const [column, title] of columns) {
      const id = `${sheet.SheetId}-${column}`;
      result.FilterGroups.push({ FilterGroupId: `${id}-group`, Status: "ENABLED", CrossDataset: crossDataset,
        ScopeConfiguration: { SelectedSheets: { SheetVisualScopingConfigurations: [{ SheetId: sheet.SheetId, Scope: visualIds ? "SELECTED_VISUALS" : "ALL_VISUALS", ...(visualIds ? { VisualIds: visualIds } : {}) }] } },
        Filters: [{ CategoryFilter: { FilterId: id, Column: { DataSetIdentifier: dataset, ColumnName: column }, Configuration: { FilterListConfiguration: { MatchOperator: "CONTAINS", SelectAllOptions: "FILTER_ALL_VALUES", NullOption: "ALL_VALUES" } } } }]
      });
      sheet.FilterControls.push({ Dropdown: { FilterControlId: `${id}-control`, SourceFilterId: id, Title: title, Type: "MULTI_SELECT" } });
      filterScopes.push({ sheetId: sheet.SheetId, dataset, column, crossDataset, ...(visualIds ? { visualIds } : {}) });
    }
  };
  const enterpriseFilters = [["program_name", "Program"], ["campaign_name", "Campaign"], ["quick_iteration_label", "Iteration"], ["constituency_name", "Constituency"], ["mandal_name", "Mandal"], ["gender", "Gender"], ["age_band", "Age band"], ["quick_party_label", "Recorded party salience"]];
  controls(leadership, enterprise, enterpriseFilters); controls(demographic, enterprise, enterpriseFilters);
  // Filter geographic enterprise visuals separately; do not pretend geo rollups
  // support demographics. Matched common labels are explicitly scoped to both.
  controls(geographic, role.geographic, [["program_name", "Program"], ["campaign_name", "Campaign"], ["quick_iteration_label", "Iteration"], ["constituency_name", "Constituency"], ["mandal_name", "Mandal"], ["quick_party_label", "Recorded party salience"]], "ALL_DATASETS");
  controls(movement, role.movement, [["program_name", "Program"], ["campaign_name", "Campaign"], ["quick_iteration_label", "Iteration"]]);
  controls(quality, role.quality, [["program_name", "Program · fieldwork only"]], "SINGLE_DATASET", quality.Visuals.map((union) => Object.values(union)[0].VisualId).filter((id) => id !== "quick-comparability-registry"));
  controls(quality, role.quality, [["campaign_name", "Campaign · fieldwork and methodology"]], "ALL_DATASETS");
  for (const sheet of result.Sheets) {
    const elements = []; let row = 0;
    for (const [index, control] of sheet.FilterControls.entries()) {
      // Live Quick validation needs room for the control label and dropdown.
      elements.push({ ElementId: control.Dropdown.FilterControlId, ElementType: "FILTER_CONTROL", ColumnIndex: (index % 4) * 9, ColumnSpan: 9, RowIndex: Math.floor(index / 4) * 4, RowSpan: 4 });
    }
    row = Math.ceil(sheet.FilterControls.length / 4) * 4;
    for (const box of sheet.TextBoxes) {
      const height = sheet === guide ? Math.max(12, Math.ceil(box.Content.length / 100) + 8) : 4;
      elements.push({ ElementId: box.SheetTextBoxId, ElementType: "TEXT_BOX", ColumnIndex: 0, ColumnSpan: 36, RowIndex: row, RowSpan: height }); row += height;
    }
    let half = false, pendingHeight = 0;
    for (const union of sheet.Visuals) {
      const kind = Object.keys(union)[0], visual = union[kind];
      // KPI titles/captions must not consume the numeric value's whole height.
      const width = kind === "TableVisual" ? 36 : 18, height = kind === "KPIVisual" ? 10 : 16;
      if (width === 36 && half) { row += pendingHeight; half = false; pendingHeight = 0; }
      elements.push({ ElementId: visual.VisualId, ElementType: "VISUAL", ColumnIndex: half ? 18 : 0, ColumnSpan: width, RowIndex: row, RowSpan: height });
      if (width === 36 || half) { row += Math.max(pendingHeight, height); half = false; pendingHeight = 0; } else { half = true; pendingHeight = height; }
    }
    sheet.Layouts = [{ Configuration: { GridLayout: { Elements: elements } } }];
  }
  const sentiments = applySentimentColors(result);
  const colored = applyPartyColors(sentiments.definition);
  return { definition: colored.definition, bindings, guards, partitionGuards, disclosurePolicy: DISCLOSURE_POLICY_VERSION, answerBaseGuards, answerStatusFilters, percentagePolicies: [], reviewedVisualIds, filterScopes, measurementNotes, coloredVisuals: colored.colored, sentimentColoredVisuals: sentiments.colored };
}
