// Optional isolated PostgreSQL regression; no live database is contacted.
// Set PGLITE_MODULE_PATH to an isolated @electric-sql/pglite dist/index.js.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildNormalizationSqlFunction, normalizeOutputValue, OUTPUT_KEYS, selectStructuredOutput, summarizeOutput } from "../output-variable-standardization/output-normalization.repository.js";
import { buildQuestionnaireContentSnapshot } from "../research-methodology/questionnaire-snapshot.repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : "@electric-sql/pglite");
const db = new PGlite();
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const migrations = await Promise.all([
  "024_amazon_quick_research_reporting.sql", "025_amazon_quick_geographic_heatmap.sql",
  "026_telangana_administrative_boundaries.sql", "027_psephology_decision_reporting.sql",
  "028_research_design_comparability.sql", "029_shared_comparison_gate.sql",
  "030_normalized_output_reporting.sql", "031_audited_research_methodology.sql",
  "032_sentiment_construct_reporting.sql"
].map((file) => readFile(path.join(here, file), "utf8")));
for (const group of ["party", "leadership", "candidate", "issue"]) {
  assert.ok(migrations.at(-1).includes(`ARRAY[${OUTPUT_KEYS[group].map((key) => `'${key}'`).join(", ")}]`), `${group} aliases and precedence must match native output groups`);
}
assert.doesNotMatch(migrations.at(-1), /\b(?:UPDATE|DELETE\s+FROM)\s+(?:calls|program_iterations|voter_master)\b/i, "032 may not rewrite historical raw answers, frozen instruments or demographics");
const campaignId = uuid(1), programId = uuid(2), questionnaireId = uuid(3), actorId = uuid(4);
const waveIds = [uuid(10), uuid(11), uuid(12)];
const voterIds = Array.from({ length: 10 }, (_, index) => uuid(100 + index));
const movement = async (id) => (await db.query("SELECT * FROM analytics_iteration_movement_v2 WHERE iteration_id = $1", [id])).rows[0];
const signature = async (view) => (await db.query(`SELECT column_name, data_type, udt_name
  FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [view])).rows;
const snapshot = buildQuestionnaireContentSnapshot({
  id: questionnaireId, questionnaire_code: "SURVEY", questionnaire_name: "Research survey",
  version_number: 1, status: "PUBLISHED"
}, [{
  question_code: "Q1", question_order: 1, question_text: "How do you assess the incumbent's performance?",
  question_type: "OPEN_TEXT", options: [], required: true, analysis_category: "INCUMBENT_ASSESSMENT",
  metadata: { output_variables: ["incumbent_assessment"] }
}]);

try {
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE survey_studies (id uuid PRIMARY KEY, study_code text, study_name text);
    CREATE TABLE campaigns (
      id uuid PRIMARY KEY, program_id uuid, campaign_code text, campaign_name text, status text,
      survey_stage text, target_type text, target_code text, target_name text,
      campaign_manager_user_id uuid, created_by_user_id uuid
    );
    CREATE TABLE program_iterations (
      id uuid PRIMARY KEY, iteration_number integer, iteration_name text, status text,
      questionnaire_id uuid, questionnaire_snapshot jsonb, created_at timestamptz, sample_design_type text
    );
    CREATE TABLE campaign_iteration_links (campaign_id uuid, iteration_id uuid UNIQUE, status text, UNIQUE(campaign_id, iteration_id));
    CREATE TABLE campaign_runs (id uuid PRIMARY KEY, iteration_id uuid, run_number integer, run_name text, status text);
    CREATE TABLE voter_master (id uuid PRIMARY KEY, gender text, age integer, mandal_name_source text, assembly_constituency_name text);
    CREATE TABLE calls (
      id uuid PRIMARY KEY, campaign_id text, iteration_id uuid, run_id uuid, voter_id uuid,
      response_variables jsonb, interaction_transcript jsonb, connectivity_status text,
      duration_seconds numeric, updated_at timestamptz, first_seen_at timestamptz
    );
    CREATE TABLE call_executions (id uuid PRIMARY KEY, run_id uuid, callback_received_at timestamptz);
  `);
  await db.query("INSERT INTO users VALUES ($1)", [actorId]);
  await db.query("INSERT INTO survey_studies VALUES ($1, 'P1', 'Program')", [programId]);
  await db.query(`INSERT INTO campaigns VALUES ($1, $2, 'C1', 'Campaign', 'ACTIVE',
    'CAMPAIGN', 'CONSTITUENCY', 'AC052', 'Serilingampally', NULL, NULL)`, [campaignId, programId]);
  for (const [index, id] of waveIds.entries()) {
    await db.query(`INSERT INTO program_iterations VALUES ($1, $2, $3, 'COMPLETED', $4,
      $5::jsonb, now(), 'Repeated cross-section')`, [id, index + 1, `Wave ${index + 1}`, questionnaireId,
      JSON.stringify(snapshot)]);
    await db.query("INSERT INTO campaign_iteration_links VALUES ($1, $2, 'COMPLETED')", [campaignId, id]);
  }
  for (const id of voterIds) await db.query("INSERT INTO voter_master VALUES ($1, 'Female', 35, 'Serilingampally', 'Serilingampally')", [id]);
  await db.exec(buildNormalizationSqlFunction());
  for (const sql of migrations.slice(0, -1)) await db.exec(sql);
  const v1Signatures = await Promise.all(["analytics_research_enterprise_v1", "analytics_research_geographic_v1", "analytics_iteration_movement_v1"].map(signature));
  const v2Signatures = await Promise.all(["analytics_research_enterprise_v2", "analytics_research_geographic_v2", "analytics_iteration_movement_v2"].map(signature));
  await db.exec(migrations.at(-1));
  assert.deepEqual(await Promise.all(["analytics_research_enterprise_v1", "analytics_research_geographic_v1", "analytics_iteration_movement_v1"].map(signature)), v1Signatures, "032 retains historical v1 column signatures");
  assert.deepEqual(await Promise.all(["analytics_research_enterprise_v2", "analytics_research_geographic_v2", "analytics_iteration_movement_v2"].map(signature)), v2Signatures, "032 retains published v2 column signatures");

  const examples = [
    ["", "Multiple parties mentioned"], ["party_salience_unaided", "Can’t say"],
    ["perceived_issue_leader_aided", "BRS and BJP"], ["party_salience_unaided", "BRS కాదు"],
    ["party_salience_unaided", " BRS. "], ["party_salience_unaided", "Telangana Rashtra Samithi"],
    ["party_salience_unaided", "BRS government"], ["party_salience_unaided", "BRS and BJP"],
    ["party_salience_unaided", "not BRS"], ["party_salience_unaided", "The respondent offered no coded party"],
    ["party_salience_unaided", null], ["party_salience_unaided", ""], ["party_salience_unaided", "not recorded"],
    ["party_salience_unaided", "Can't say"], ["party_salience_unaided", "None"],
    ["party_salience_unaided", "Prefer not to answer"], ["party_salience_unaided", ["BRS"]],
    ["party_salience_unaided", { party: "BRS" }], ["candidate_name", "Veeresh"],
    ["perceived_issue_leader_aided", "BRS government"], ["perceived_issue_leader_aided", "KCR"],
    ["perceived_issue_leader_aided", "The respondent mentioned BRS while describing history"],
    ["leadership_preference", "KTR"], ["leadership_preference", "Revanth Reddy"],
    ["association_influence", "yes"], ["association_influence", "not influenced"],
    ["issue_sentiment", "positive"], ["issue_sentiment", "not good"],
    ["incumbent_assessment", "Neither good nor poor"], ["veeresh_impression", "Not enough information"],
    ["candidate_impression", "Mixed"], ["candidate_impression", "Neutral"],
    ["candidate_impression", "None"], ["candidate_criterion_fit", "Good fit"],
    ["\tCANDIDATE_IMPRESSION\n", "\tGood\n"], ["\u00a0candidate_impression\u00a0", "\u00a0Good\u00a0"],
    ["graduate_issue_priority", "jobs"], ["graduate_issue_priority", "employment"],
    ["graduate_issue_priority", "jobs and education"]
  ];
  for (const [key, value] of examples) {
    const js = normalizeOutputValue(key, value);
    const { rows: [{ normalized: sql }] } = await db.query(
      "SELECT analytics_normalize_output_v1($1, $2::jsonb) AS normalized", [key, JSON.stringify(value)]);
    assert.equal(sql.status, js.status, `${key}: ${JSON.stringify(value)} SQL/JS status`);
    assert.equal(sql.label, js.label, `${key}: ${JSON.stringify(value)} SQL/JS label`);
    assert.equal(sql.domain, js.domain, `${key}: ${JSON.stringify(value)} SQL/JS domain`);
    assert.equal(sql.version, js.version, `${key}: ${JSON.stringify(value)} SQL/JS rule version`);
  }
  for (const variables of [
    { " PARTY_SALIENCE_UNAIDED ": "BRS" },
    { party_salience_unaided: "BRS", PARTY_SALIENCE_UNAIDED: "BRS" },
    { party_salience_unaided: "BRS", PARTY_SALIENCE_UNAIDED: "BJP" },
    { party_salience_unaided: "", PARTY_SALIENCE_UNAIDED: "BRS" }
  ]) {
    const js = summarizeOutput([{ response_variables: variables }], OUTPUT_KEYS.party);
    const { rows: [{ normalized: sql }] } = await db.query(
      "SELECT analytics_normalize_output_v1('party_salience_unaided', analytics_output_value_v1($1::jsonb, 'party_salience_unaided')) AS normalized",
      [JSON.stringify(variables)]);
    assert.equal(sql.label, js.values[0]?.value || null, "case/whitespace aliases and conflicts have SQL/JS parity");
    assert.equal(Number(sql.status === "UNCODED"), js.uncodedCount);
  }
  for (const [variables, keys, expectedStatus, expectedLabel] of [
    [{ candidate_impression: "Positive", candidate_sentiment: "Negative" }, OUTPUT_KEYS.candidate, "UNCODED", "Uncoded response"],
    [{ candidate_impression: "good", veeresh_impression: "Positive" }, OUTPUT_KEYS.candidate, "CODED", "Positive"],
    [{ candidate_impression: "", veeresh_impression: "Negative" }, OUTPUT_KEYS.candidate, "CODED", "Negative"],
    [{ " CANDIDATE_IMPRESSION ": "Positive", candidate_sentiment: "Negative" }, OUTPUT_KEYS.candidate, "UNCODED", "Uncoded response"],
    [{ "\tCANDIDATE_IMPRESSION\n": "Good" }, OUTPUT_KEYS.candidate, "CODED", "Positive"],
    [{ "\u00a0CANDIDATE_IMPRESSION\u00a0": "Good" }, OUTPUT_KEYS.candidate, "CODED", "Positive"],
    [{ candidate_impression: "Good" }, ["\tCANDIDATE_IMPRESSION\n"], "CODED", "Positive"],
    [{ "\tCANDIDATE_IMPRESSION\n": "Good" }, ["\u00a0candidate_impression\u00a0"], "CODED", "Positive"],
    [{ candidate_impression: "Positive", CANDIDATE_IMPRESSION: "Negative" }, OUTPUT_KEYS.candidate, "UNCODED", "Uncoded response"],
    [{ candidate_impression: "Mixed" }, OUTPUT_KEYS.candidate, "CODED", "Mixed"],
    [{ candidate_impression: "Mixed", veeresh_impression: "Neutral" }, OUTPUT_KEYS.candidate, "UNCODED", "Uncoded response"],
    [{ candidate_impression: "None" }, OUTPUT_KEYS.candidate, "UNCODED", "Uncoded response"],
    [{ candidate_criterion_fit: "Positive", veeresh_criterion_fit: "Negative" }, OUTPUT_KEYS.candidateFit, "UNCODED", "Uncoded response"],
    [{ candidate_criterion_fit: "Positive" }, OUTPUT_KEYS.candidate, "MISSING", null],
    [{ issue_sentiment: "Positive", development_sentiment: "Negative" }, ["incumbent_assessment"], "MISSING", null],
    [{ issue_sentiment: "Negative", incumbent_assessment: "Neutral" }, ["incumbent_assessment"], "CODED", "Neutral"],
    [{ candidate_impression: "Can't say" }, OUTPUT_KEYS.candidate, "CANT_SAY", "Can't say"],
    [{ candidate_impression: "Prefer not to answer" }, OUTPUT_KEYS.candidate, "REFUSED", "Declined to answer"],
    [{}, OUTPUT_KEYS.candidate, "MISSING", null]
  ]) {
    const js = selectStructuredOutput({ response_variables: variables }, keys);
    const { rows: [{ normalized: sql }] } = await db.query(
      "SELECT analytics_select_output_v2($1::jsonb, $2::text[]) AS normalized", [JSON.stringify(variables), keys]);
    for (const field of ["status", "label", "domain", "version", "sourceKey"]) {
      assert.equal(sql[field] ?? null, js[field] ?? null, `${JSON.stringify(variables)} ${keys}: selected ${field} SQL/JS parity`);
    }
    assert.deepEqual(sql.sourceKeys, js.sourceKeys, "all recorded aliases remain traceable, including contradictions");
    assert.equal(sql.status, expectedStatus);
    assert.equal(sql.label, expectedLabel);
  }
  for (const id of waveIds) await db.query(`INSERT INTO analytics_research_design_registry
    (iteration_id, campaign_id, target_population, sample_frame_name, sampling_method,
      selection_method, cohort_design, weighting_status, weighting_variables,
      fieldwork_mode, declared_by_user_id, revision, declared_at)
    VALUES ($1, $2, 'Registered graduates', 'Approved demo contacts', 'QUOTA',
      'Age and gender quotas within each Mandal', 'INDEPENDENT_SAMPLES', 'NOT_REQUIRED', '[]'::jsonb,
      'AI_ASSISTED_OUTBOUND_VOICE', $3, 1, now())
    ON CONFLICT (iteration_id) DO UPDATE SET target_population = EXCLUDED.target_population,
      sample_frame_name = EXCLUDED.sample_frame_name, sampling_method = EXCLUDED.sampling_method,
      selection_method = EXCLUDED.selection_method, weighting_status = EXCLUDED.weighting_status,
      cohort_design = EXCLUDED.cohort_design, weighting_variables = EXCLUDED.weighting_variables,
      fieldwork_mode = EXCLUDED.fieldwork_mode, declared_by_user_id = EXCLUDED.declared_by_user_id,
      revision = EXCLUDED.revision, declared_at = EXCLUDED.declared_at`, [id, campaignId, actorId]);

  const add = async (wave, index, variables, id = 1000 + wave * 100 + index, extra = {}) => db.query(`
    INSERT INTO calls (id, campaign_id, iteration_id, voter_id, response_variables,
      connectivity_status, duration_seconds, updated_at, first_seen_at)
    VALUES ($1, 'provider-context', $2, $3, $4::jsonb, $5, 120, $6, $7)`,
  [uuid(id), waveIds[wave], voterIds[index], JSON.stringify(variables), extra.status || "connected",
    extra.updatedAt || "2026-10-01T10:00:00Z", extra.firstSeenAt || "2026-10-01T09:00:00Z"]);
  const partyAliases = ["BRS", "TRS", "Bharat Rashtra Samithi", "BRS government", "బీఆర్ఎస్"];
  for (let wave = 0; wave < 2; wave++) for (let index = 0; index < 10; index++) {
    const variables = {
      graduate_issue_priority: index < 5 ? (index % 2 ? "employment" : "jobs") : "Not recorded",
      party_salience_unaided: index < 5 ? partyAliases[index] : ["BRS and BJP", "not BRS", "", "None", "Can't say"][index - 5],
      perceived_issue_leader_aided: index < 5 ? "BRS government" : "Not enough information",
      candidate_name: "Veeresh"
    };
    variables.incumbent_assessment = wave === 0
      ? ["Positive", "Positive", "Negative", "Can't say", "detailed uncoded narrative", null, null, null, null, null][index]
      : ["Positive", "Positive", "Positive", "Can't say", "Prefer not to answer", null, null, null, null, null][index];
    variables.veeresh_impression = wave === 0
      ? ["Positive", "Positive", "Positive", "Negative", "Prefer not to answer", null, null, null, null, null][index]
      : ["Positive", "Positive", "Positive", "Positive", null, null, null, null, null, null][index];
    if (index < 3) variables.party_lean_rating = "4";
    await add(wave, index, variables);
  }
  const { rows: labels } = await db.query("SELECT * FROM analytics_research_enterprise_v2 WHERE iteration_id = $1 ORDER BY respondent_key", [waveIds[0]]);
  assert.equal(labels.length, 10);
  assert.ok(labels.every((item) => item.age_band === "30–39" && item.gender === "Female" && item.mandal_name === "Serilingampally"), "sentiment changes preserve declared demographic reporting dimensions");
  assert.ok(labels.filter((item) => item.respondent_sentiment_status !== "MISSING").every((item) => item.sentiment_source_key === "incumbent_assessment"), "BI sentiment is the fixed incumbent construct, not an interchangeable issue/development fallback");
  assert.equal(labels.filter((row) => row.party_salience === "BRS").length, 5, "aliases and narratives create one canonical party category");
  assert.equal(labels.filter((row) => row.issue_priority === "Employment and jobs").length, 5);
  const respondent = async (index) => (await db.query(
    "SELECT * FROM analytics_research_enterprise_v2 WHERE iteration_id = $1 AND respondent_key = MD5($2::text)",
    [waveIds[0], voterIds[index]])).rows[0];
  assert.equal((await respondent(5)).party_salience, "Multiple parties mentioned");
  assert.equal((await respondent(6)).party_salience_status, "UNCODED");
  assert.equal((await respondent(7)).party_salience, "No response");
  assert.equal((await respondent(9)).party_salience_status, "CANT_SAY");
  assert.equal((await respondent(8)).party_salience, "None");
  assert.ok(labels.every((row) => row.candidate_name === "Kasani Veeresh"));
  assert.equal(v2Signatures[0].some((column) => ["response_variables", "voter_id", "phone_number", "full_name", "interaction_transcript"].includes(column.column_name) || column.column_name.endsWith("_raw")), false, "public BI cannot export raw free text or known respondent identifiers");
  const retainedSource = (await db.query("SELECT response_variables FROM calls WHERE id = $1", [uuid(1003)])).rows[0].response_variables;
  assert.equal(retainedSource.party_salience_unaided, "BRS government", "original narrative remains unchanged only in the privileged call source");
  assert.equal((await respondent(3)).party_salience, "BRS");
  assert.equal((await respondent(3)).party_source_key, "party_salience_unaided");

  let row = await movement(waveIds[0]);
  assert.equal(row.respondent_base, 10);
  assert.equal(row.sentiment_answer_base, 5);
  assert.equal(row.sentiment_missing_count, 5);
  assert.equal(row.sentiment_uncoded_count, 1);
  assert.equal(row.sentiment_cant_say_count, 1);
  assert.equal(Number(row.positive_sentiment_pct), 40, "positive share uses five recorded answers, not ten respondents");
  assert.equal(Number(row.candidate_positive_pct), 60);
  assert.match(row.sentiment_construct, /incumbent/i);
  assert.doesNotMatch(row.sentiment_construct, /issue, development|then incumbent/i);
  assert.doesNotMatch(row.candidate_construct, /criterion fit/i);
  row = await movement(waveIds[1]);
  assert.equal(row.comparison_basis, "COMPARABLE");
  assert.equal(Number(row.positive_sentiment_pct), 60);
  assert.equal(Number(row.positive_sentiment_change_pct), 20);
  assert.equal(row.previous_sentiment_answer_base, 5);
  assert.equal(row.candidate_answer_base, 4);
  assert.equal(row.candidate_positive_pct, null, "four answered candidate values are suppressed despite ten total respondents");
  assert.equal(row.candidate_positive_change_pct, null);
  assert.equal(row.party_strength_change, null, "direct measures are never inferred from party mentions");
  await db.query("UPDATE calls SET response_variables = response_variables || '{\"veeresh_impression\":\"Can''t say\"}'::jsonb WHERE id = $1", [uuid(1104)]);
  row = await movement(waveIds[1]);
  assert.equal(row.candidate_answer_base, 5);
  assert.equal(Number(row.candidate_positive_pct), 80);
  assert.equal(Number(row.candidate_positive_change_pct), 20);
  await db.query("UPDATE calls SET response_variables = response_variables || '{\"veeresh_impression\":null,\"incumbent_assessment\":null}'::jsonb WHERE id = $1", [uuid(1004)]);
  row = await movement(waveIds[1]);
  assert.equal(row.previous_candidate_answer_base, 4);
  assert.equal(row.previous_sentiment_answer_base, 4);
  assert.equal(row.candidate_positive_change_pct, null, "a small previous answer base cannot be bridged or ignored");
  assert.equal(row.positive_sentiment_change_pct, null);
  await db.query("UPDATE calls SET response_variables = response_variables || '{\"veeresh_impression\":\"Prefer not to answer\",\"incumbent_assessment\":\"detailed uncoded narrative\"}'::jsonb WHERE id = $1", [uuid(1004)]);

  const { rows: geography } = await db.query("SELECT * FROM analytics_research_geographic_v2 WHERE iteration_id = $1", [waveIds[0]]);
  assert.equal(geography.length, 1, "small party/missing/uncertainty cells stay withheld");
  assert.equal(geography[0].party_name, "BRS");
  assert.equal(geography[0].respondent_count, 5);
  assert.equal(geography[0].average_party_strength, null, "map scores need five answered direct ratings in each published cell");

  // Missing/failed retries cannot overwrite earlier connected structured evidence.
  await add(0, 0, {}, 5000, { updatedAt: "2026-10-02T10:00:00Z" });
  await add(0, 0, { party_salience_unaided: "BJP" }, 5001, { status: "disconnected", updatedAt: "2026-10-03T10:00:00Z" });
  assert.equal((await db.query("SELECT count(*)::integer AS count FROM analytics_research_enterprise_v2 WHERE iteration_id = $1", [waveIds[0]])).rows[0].count, 10);
  assert.equal((await db.query("SELECT count(*)::integer AS count FROM analytics_research_enterprise_v2 WHERE iteration_id = $1 AND party_salience = 'BRS'", [waveIds[0]])).rows[0].count, 5);

  // A small current answer base is withheld before any comparison is attempted.
  await add(2, 0, { issue_sentiment: "Positive", " PARTY_SALIENCE_UNAIDED ": "BRS" }, 6000);
  assert.equal((await db.query("SELECT party_salience FROM analytics_research_enterprise_v2 WHERE iteration_id = $1", [waveIds[2]])).rows[0].party_salience, "BRS", "the public view uses canonical output field names without rewriting source JSON");
  row = await movement(waveIds[2]);
  assert.equal(row.comparison_basis, "SUPPRESSED");
  assert.equal(row.positive_sentiment_pct, null);
  assert.equal(row.positive_sentiment_change_pct, null);
  await db.query("UPDATE analytics_research_design_registry SET sample_frame_name = 'Different frame' WHERE iteration_id = $1", [waveIds[1]]);
  row = await movement(waveIds[1]);
  assert.equal(row.comparison_basis, "NOT_COMPARABLE");
  assert.equal(row.positive_sentiment_change_pct, null, "Step 1 shared comparison gate is retained");
  await db.query("UPDATE analytics_research_design_registry SET sample_frame_name = 'Approved demo contacts' WHERE iteration_id = $1", [waveIds[1]]);
  const constructFixtures = [
    { issue_sentiment: "Positive", development_sentiment: "Negative", candidate_criterion_fit: "Positive" },
    { incumbent_assessment: "Neutral", issue_sentiment: "Negative", candidate_impression: "Mixed" },
    { incumbent_assessment: "Positive", development_sentiment: "Negative", candidate_impression: "Positive", candidate_sentiment: "Negative" },
    { issue_sentiment: "Not recorded", development_sentiment: "Negative", candidate_impression: "Positive" }
  ];
  for (const [offset, variables] of constructFixtures.entries()) await add(2, offset + 1, variables, 6001 + offset);
  const thirdRespondent = async (index) => (await db.query(
    "SELECT * FROM analytics_research_enterprise_v2 WHERE iteration_id = $1 AND respondent_key = MD5($2::text)", [waveIds[2], voterIds[index]])).rows[0];
  for (const index of [0, 1, 4]) {
    const source = await thirdRespondent(index);
    assert.equal(source.respondent_sentiment_status, "MISSING", "issue/development answers do not fill the missing incumbent construct");
    assert.equal(source.respondent_sentiment, "No response");
  }
  assert.equal((await thirdRespondent(1)).candidate_sentiment_status, "MISSING", "criterion fit is suitability, not a candidate impression");
  assert.equal((await thirdRespondent(2)).candidate_sentiment, "Mixed", "Mixed stays distinct from Neutral in published BI categories");
  assert.equal((await thirdRespondent(2)).respondent_sentiment, "Neutral", "candidate Mixed and issue Negative cannot overwrite an incumbent Neutral assessment");
  assert.equal((await thirdRespondent(3)).candidate_sentiment_status, "UNCODED", "contradictory impression aliases are not silently resolved by precedence");
  assert.equal((await thirdRespondent(3)).candidate_sentiment, "Uncoded response");
  assert.equal((await thirdRespondent(3)).respondent_sentiment, "Positive");
  row = await movement(waveIds[2]);
  assert.equal(row.sentiment_answer_base, 2);
  assert.equal(row.candidate_answer_base, 3);
  assert.equal(row.sentiment_missing_count, 3);
  assert.equal(row.candidate_missing_count, 2);
  assert.equal(row.candidate_positive_pct, null, "construct-specific bases below five remain suppressed");
  await db.query("UPDATE analytics_research_design_registry SET weighting_variables = '[\"age\"]'::jsonb WHERE iteration_id = $1", [waveIds[1]]);
  row = await movement(waveIds[1]);
  assert.equal(row.comparison_basis, "NOT_COMPARABLE", "variable weighting frames remain guarded after the sentiment correction");
  assert.equal(row.positive_sentiment_change_pct, null);
  await db.query("UPDATE analytics_research_design_registry SET weighting_variables = '[]'::jsonb WHERE iteration_id = $1", [waveIds[1]]);
  await db.query("UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2", [JSON.stringify({ id: questionnaireId, code: "SURVEY", version: 1 }), waveIds[1]]);
  assert.equal((await movement(waveIds[1])).comparison_basis, "NOT_COMPARABLE", "031 frozen-content provenance gate is retained");
  await db.query("UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2", [JSON.stringify(snapshot), waveIds[1]]);
  await db.query("DELETE FROM calls WHERE iteration_id = $1", [waveIds[1]]);
  row = await movement(waveIds[2]);
  assert.equal(row.comparison_basis, "NOT_COMPARABLE", "a missing middle evidence wave never compares waves one and three");
  assert.equal(row.positive_sentiment_change_pct, null);
  assert.ok(row.comparison_reasons.some((reason) => reason.includes("missing waves are not bridged")));

  // The entire existing migration sequence remains idempotent after v2 exists.
  const rawBeforeReplay = (await db.query("SELECT id, response_variables FROM calls ORDER BY id")).rows;
  await db.exec(buildNormalizationSqlFunction());
  for (const sql of migrations) await db.exec(sql);
  assert.deepEqual(await Promise.all(["analytics_research_enterprise_v1", "analytics_research_geographic_v1", "analytics_iteration_movement_v1"].map(signature)), v1Signatures);
  assert.deepEqual(await Promise.all(["analytics_research_enterprise_v2", "analytics_research_geographic_v2", "analytics_iteration_movement_v2"].map(signature)), v2Signatures);
  assert.equal((await movement(waveIds[2])).comparison_basis, "NOT_COMPARABLE", "replay preserves missing-wave gate");
  assert.deepEqual((await db.query("SELECT id, response_variables FROM calls ORDER BY id")).rows, rawBeforeReplay, "migration replay never rewrites retained raw source answers");
  assert.equal((await thirdRespondent(2)).candidate_sentiment, "Mixed", "replay ends on 032 instead of reinstating obsolete 030 pooling");
  console.log("Normalized Quick SQL passed: shared-rule/alias-conflict parity, distinct sentiment constructs, Mixed separation, fixed source keys, explicit answer states, denominators, minimum bases, audited provenance/comparison gates, geographic/demographic dimensions and full migration replay without raw rewrites.");
} catch (error) {
  console.error(`Normalized Quick SQL regression failed (${error.code || error.name}): ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
