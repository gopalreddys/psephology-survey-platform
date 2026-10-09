import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildQuestionnaireContentSnapshot, freezeQuestionnaireContent } from "./questionnaire-snapshot.repository.js";
import { installQuestionnaireSnapshot } from "./install-questionnaire-snapshot.js";

const questionnaire = {
  id: "eb55fbc2-54db-4609-80d4-7cf7118bb15d", questionnaire_code: "DEMO_CORE",
  questionnaire_name: "Public needs", version_number: 1, status: "ACTIVE"
};
const questions = [{
  id: "old-storage-id", questionnaire_id: questionnaire.id,
  question_order: 2, question_code: "Q_CHANGE", question_text: "Which improvement matters most?",
  question_text_telugu: "ఏ మార్పు ముఖ్యమైనది?", question_type: "SINGLE_SELECT",
  options: [{ value: "jobs", label: "Jobs" }, { value: "roads", label: "Roads" }],
  required: true, analysis_category: "development",
  output_variables: ["development_priority"],
  metadata: { required_for_completion: true, section: "CORE", output_definitions: { development_priority: "A stated public priority" } },
  created_at: "2026-01-01", updated_at: "2026-01-02", created_by_user_id: "author-id"
}, {
  id: "another-storage-id", questionnaire_id: questionnaire.id,
  question_order: 1, question_code: "Q_ISSUE", question_text: "What public issue affects you most?",
  question_type: "OPEN_TEXT", options: [], required: true,
  metadata: { question_text_telugu: "ఏ సమస్య మిమ్మల్ని ప్రభావితం చేస్తుంది?", output_variables: ["issue_priority"] }
}];

const snapshot = buildQuestionnaireContentSnapshot(questionnaire, questions);
assert.equal(snapshot.id, questionnaire.id);
assert.equal(snapshot.code, questionnaire.questionnaire_code);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.snapshot_schema_version, 2);
assert.equal(snapshot.question_provenance, "FROZEN_AT_SELECTION");
assert.match(snapshot.content_fingerprint, /^[0-9a-f]{64}$/);
assert.deepEqual(snapshot.questions.map((item) => item.question_code), ["Q_ISSUE", "Q_CHANGE"]);
assert.equal(snapshot.questions[1].question_text_telugu, questions[0].question_text_telugu);
assert.deepEqual(snapshot.questions[1].output_variables, ["development_priority"]);
assert.deepEqual(snapshot.questions[0].metadata.output_variables, ["issue_priority"]);
assert.equal(snapshot.questions[0].metadata.question_text_telugu, questions[1].metadata.question_text_telugu);
for (const question of snapshot.questions) {
  for (const excluded of ["id", "questionnaire_id", "created_at", "updated_at", "created_by_user_id"]) {
    assert.ok(!(excluded in question), `${excluded} is storage/author identity, not instrument content`);
  }
}
assert.ok(!("core_question_codes" in snapshot), "No unchanged core subset is inferred from old questions");
assert.equal(questions[0].id, "old-storage-id", "Snapshot creation does not mutate source questions");

const reorderedStorage = questions.map((question) => Object.fromEntries(
  Object.entries({ ...question, id: "new-row", created_at: "2026-02-01", updated_at: "2026-02-02" }).reverse()
)).reverse();
assert.equal(buildQuestionnaireContentSnapshot(questionnaire, reorderedStorage).content_fingerprint,
  snapshot.content_fingerprint, "Storage IDs/timestamps and object key order do not create false instrument drift");
for (const mutate of [
  (row) => { row.question_text += " Please explain."; },
  (row) => { row.question_text_telugu += " వివరించండి."; },
  (row) => { row.options[0].label = "Employment opportunities"; },
  (row) => { row.options.reverse(); },
  (row) => { row.output_variables = ["different_construct"]; },
  (row) => { row.metadata.required_for_completion = false; }
]) {
  const changed = structuredClone(questions);
  mutate(changed[0]);
  assert.notEqual(buildQuestionnaireContentSnapshot(questionnaire, changed).content_fingerprint,
    snapshot.content_fingerprint, "Changed wording/options/output semantics must change the fingerprint");
}
for (const rows of [[], [{ ...questions[0], question_code: "" }],
  [{ ...questions[0], question_text: {} }], [{ ...questions[0], question_order: 0 }],
  [questions[0], { ...questions[1], question_code: "q_change" }],
  [questions[0], { ...questions[1], question_order: 2 }]]) {
  assert.throws(() => buildQuestionnaireContentSnapshot(questionnaire, rows), (error) => error.statusCode === 400);
}

const queries = [];
const client = {
  async query(sql, values) {
    queries.push({ sql, values });
    if (sql.includes("pg_catalog.pg_class")) return { rows: [{ schema_name: "public", table_name: "questions" }] };
    return { rows: questions.map((question) => ({ question })) };
  }
};
assert.deepEqual(await freezeQuestionnaireContent(client, questionnaire), snapshot);
assert.match(queries[0].sql, /COUNT\(DISTINCT attribute.attname\) = 4/);
assert.match(queries[0].sql, /relation.relkind IN \('r', 'p'\)/);
assert.match(queries[1].sql, /FROM "public"\."questions" question/);
assert.match(queries[1].sql, /WHERE question.questionnaire_id = \$1::uuid/);
assert.match(queries[1].sql, /FOR SHARE/);
assert.deepEqual(queries[1].values, [questionnaire.id]);
for (const relations of [[], [{ schema_name: "public", table_name: "questions" }, { schema_name: "public", table_name: "old_questions" }]]) {
  let reads = 0;
  await assert.rejects(freezeQuestionnaireContent({ async query() { reads++; return { rows: relations }; } }, questionnaire),
    (error) => error.statusCode === 503 && /unavailable or ambiguous/.test(error.message));
  assert.equal(reads, 1, "Unavailable schema never falls back to header-only provenance");
}

// Execute the complete creation repository with fake storage dependencies.
// This verifies the snapshot is part of the existing transaction, future-only.
const source = await readFile(new URL("../campaign-workspace/campaign-iterations.repository.js", import.meta.url), "utf8");
const key = "__questionnaireSnapshotCreationBindings";
let availableQuestions = questions;
let insertValues;
const statements = [];
const creationClient = {
  async query(sql, values) {
    statements.push(sql);
    if (sql.includes("FROM campaigns campaign")) return { rowCount: 1, rows: [{ id: "campaign", program_id: "program", status: "ACTIVE", campaign_manager_user_id: "manager" }] };
    if (sql.includes("FROM questionnaires")) return { rowCount: 1, rows: [questionnaire] };
    if (sql.includes("pg_catalog.pg_class")) return { rows: [{ schema_name: "public", table_name: "questions" }] };
    if (sql.includes('FROM "public"."questions"')) return { rows: availableQuestions.map((question) => ({ question })) };
    if (sql.includes("MAX(iteration_number)")) return { rows: [{ next_number: 1 }] };
    if (sql.includes("INSERT INTO program_iterations")) { insertValues = values; return { rows: [{ id: "new-iteration" }] }; }
    return { rows: [], rowCount: 1 };
  },
  release() { statements.push("RELEASE"); }
};
globalThis[key] = {
  getDb: async () => ({ connect: async () => creationClient }),
  getVoiceAgentForSelection: async () => ({ id: "agent", app_version: 1 }),
  voiceAgentSnapshot: () => ({ app_version: 1 }),
  campaignReviewVisibilitySql: () => ({ sql: "TRUE", values: [] }),
  assertIterationAgentVersionChange: () => {}, freezeQuestionnaireContent
};
try {
  const executable = `const { ${Object.keys(globalThis[key]).join(", ")} } = globalThis[${JSON.stringify(key)}];\n`
    + source.replace(/^import\s[\s\S]*?;\n/gm, "");
  const repository = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  const input = { campaignId: "campaign", iterationName: "New wave", researchPhase: "CAMPAIGN", targetSampleSize: 10, voiceAgentId: "agent", questionnaireId: questionnaire.id, createdBy: "manager" };
  await repository.createCampaignIteration(input);
  assert.deepEqual(JSON.parse(insertValues[10]), snapshot);
  assert.equal(statements[0], "BEGIN");
  assert.ok(statements.includes("COMMIT"));
  assert.ok(!statements.some((sql) => /UPDATE program_iterations/.test(sql)), "Existing Iterations are never backfilled");
  statements.length = 0;
  insertValues = undefined;
  availableQuestions = [];
  await assert.rejects(repository.createCampaignIteration(input), /Add the approved questions/);
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(insertValues, undefined, "A header-only or empty instrument cannot create a future wave");
} finally {
  delete globalThis[key];
}

const runtime = await mkdtemp(path.join(tmpdir(), "questionnaire-snapshot-install-"));
try {
  await installQuestionnaireSnapshot(runtime);
  const target = path.join(runtime, "src/repositories/questionnaire-snapshot.repository.js");
  assert.equal(await readFile(target, "utf8"), await readFile(new URL("./questionnaire-snapshot.repository.js", import.meta.url), "utf8"));
  await installQuestionnaireSnapshot(runtime);
  assert.equal((await readdir(path.dirname(target))).length, 1, "An identical reinstall is idempotent");
  await writeFile(target, "// prior customized helper\n");
  await installQuestionnaireSnapshot(runtime);
  const backup = (await readdir(path.dirname(target))).find((name) => name.includes(".bak-questionnaire-content-"));
  assert.ok(backup);
  assert.equal(await readFile(path.join(path.dirname(target), backup), "utf8"), "// prior customized helper\n");
} finally {
  await rm(runtime, { recursive: true, force: true });
}
for (const installer of [
  "campaign-iteration-visibility/install-campaign-iteration-visibility.js",
  "iteration-agent-version/install-iteration-agent-version.js",
  "campaign-draft-privacy/install-campaign-draft-privacy.js",
  "iteration-closeout/install-iteration-closeout.js",
  "iteration-questionnaire-provenance/install-iteration-questionnaire-provenance.js"
]) {
  assert.match(await readFile(new URL(`../${installer}`, import.meta.url), "utf8"), /await installQuestionnaireSnapshot\(runtimeRoot\)/,
    `Copying the creation repository via ${installer} must also install its snapshot dependency`);
}
if (process.env.PGLITE_MODULE_PATH) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.questions (
      id uuid, questionnaire_id uuid, question_order integer, question_code text,
      question_text text, question_type text, options jsonb, required boolean, metadata jsonb
    )`);
    for (const question of questions) {
      await db.query(`INSERT INTO public.questions
        (questionnaire_id, question_order, question_code, question_text, question_type, options, required, metadata)
        VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
      [questionnaire.id, question.question_order, question.question_code, question.question_text,
        question.question_type, JSON.stringify(question.options), question.required, JSON.stringify(question.metadata)]);
    }
    const actual = await freezeQuestionnaireContent(db, questionnaire);
    assert.equal(actual.questions.length, 2);
    assert.deepEqual(actual.questions.map((question) => question.question_code), ["Q_ISSUE", "Q_CHANGE"]);
    assert.deepEqual(actual.questions[0].metadata.output_variables, ["issue_priority"]);
    await db.exec("CREATE TABLE public.ambiguous_questions (questionnaire_id uuid, question_order integer, question_code text, question_text text)");
    await assert.rejects(freezeQuestionnaireContent(db, questionnaire), /unavailable or ambiguous/);
  } finally {
    await db.close();
  }
  console.log("Questionnaire content schema discovery and row locking passed against PostgreSQL-compatible storage.");
}
console.log("Future-only questionnaire content, semantic fingerprint, creation transaction and installer tests passed.");
