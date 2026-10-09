import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { assertRunQuestionnaireContent, buildQuestionnaireContentSnapshot, freezeQuestionnaireContent } from "./questionnaire-snapshot.repository.js";
import { patchQuestionnaireLaunchGuard, QUESTIONNAIRE_LAUNCH_GUARD_MARKER } from "./questionnaire-launch-guard.patch.js";
import { installQuestionnaireLaunchGuard } from "./install-questionnaire-launch-guard.js";

const runId = "8f88caf7-e820-4c87-93af-c064cf1b5128";
const header = {
  id: "eb55fbc2-54db-4609-80d4-7cf7118bb15d", questionnaire_code: "PUBLIC_NEEDS",
  questionnaire_name: "Public needs", version_number: 1, status: "ACTIVE"
};
const questions = [{
  question_order: 1, question_code: "Q_ISSUE", question_text: "Which public issue matters most?",
  question_type: "OPEN_TEXT", options: [], metadata: { output_variables: ["issue_priority"] }
}];
const snapshot = buildQuestionnaireContentSnapshot(header, questions);
let stored = snapshot;
let currentHeader = header;
let currentQuestions = questions;
let foundRun = true;
let relations = [{ schema_name: "public", table_name: "questions" }];
const queries = [];
const db = {
  async query(sql, values) {
    queries.push({ sql, values });
    if (sql.includes("FROM campaign_runs run")) {
      return { rows: foundRun ? [{ questionnaire_snapshot: stored, current_questionnaire: currentHeader }] : [] };
    }
    if (sql.includes("pg_catalog.pg_class")) return { rows: relations };
    if (sql.includes('FROM "public"."questions"')) return { rows: currentQuestions.map((question) => ({ question })) };
    throw new Error("Unexpected launch-guard statement");
  }
};
assert.deepEqual(await assertRunQuestionnaireContent(db, runId), { enforced: true, status: "CATALOGUE_CONTENT_MATCHED" });
assert.deepEqual(queries[0].values, [runId]);
assert.ok(queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)), "The guard never rewrites research or execution records");

for (const changed of [
  { ...questions[0], question_text: "Which party do you favor?" },
  { ...questions[0], options: [{ value: "one", label: "One" }] },
  { ...questions[0], metadata: { output_variables: ["different_construct"] } }
]) {
  currentQuestions = [changed];
  await assert.rejects(assertRunQuestionnaireContent(db, runId), (error) => error.statusCode === 409 && error.code === "QUESTIONNAIRE_CONTENT_DRIFT");
}
currentQuestions = [];
await assert.rejects(assertRunQuestionnaireContent(db, runId), (error) => error.statusCode === 409 && /catalogue is incomplete/.test(error.message));
currentQuestions = questions;
for (const changed of [{ ...header, id: "new-id" }, { ...header, questionnaire_code: "OTHER" }, { ...header, version_number: 2 }, null]) {
  currentHeader = changed;
  await assert.rejects(assertRunQuestionnaireContent(db, runId), (error) => error.statusCode === 409 && /identity or version changed/.test(error.message));
}
currentHeader = header;
for (const changed of [
  { ...snapshot, content_fingerprint: "0".repeat(64) },
  { ...snapshot, content_fingerprint: "not-a-fingerprint" },
  { ...snapshot, questions: [] },
  { ...snapshot, question_provenance: "INFERRED" },
  { ...snapshot, snapshot_schema_version: 3 }
]) {
  stored = changed;
  await assert.rejects(assertRunQuestionnaireContent(db, runId), (error) => error.statusCode === 409);
}
for (const legacy of [null, { id: header.id, code: header.questionnaire_code, version: 1 },
  { id: header.id, code: header.questionnaire_code, version: 1, snapshot_schema_version: 1 }]) {
  stored = legacy;
  queries.length = 0;
  assert.deepEqual(await assertRunQuestionnaireContent(db, runId), { enforced: false, status: "LEGACY_CONTENT_UNAVAILABLE" });
  assert.equal(queries.length, 1, "Legacy guard does not fabricate catalogue-based historical provenance");
}
stored = snapshot;
foundRun = false;
await assert.rejects(assertRunQuestionnaireContent(db, runId), (error) => error.statusCode === 404);
foundRun = true;
relations = [];
await assert.rejects(assertRunQuestionnaireContent(db, runId), (error) => error.statusCode === 503);
relations = [{ schema_name: "public", table_name: "questions" }];

const fixture = `import { getDb } from "../db/postgres.js";
export async function launchRun({ runId, limit = 1, runContactIds = [] }) {
  const db = await getDb();
  await recordLaunchState(db, runId);
  return submitToProvider({ limit, runContactIds });
}
`;
const patch = patchQuestionnaireLaunchGuard(fixture);
assert.equal(patch.changed, true);
assert.match(patch.source, new RegExp(QUESTIONNAIRE_LAUNCH_GUARD_MARKER));
assert.deepEqual(patchQuestionnaireLaunchGuard(patch.source), { source: patch.source, changed: false });
assert.doesNotMatch(patch.source, /agent_variables|inputVariables|questionnaire_context/, "No compact handoff or agent prompt is changed");
for (const malformed of ["export async function unrelated() {}", `${fixture}\n${fixture}`,
  fixture.replace("getDb", "database"), patch.source.replace("await assertRunQuestionnaireContent(await getDb(), runId);", "// guard removed"),
  patch.source.replace("await assertRunQuestionnaireContent(await getDb(), runId);", "await recordLaunchState(db, runId);\n  await assertRunQuestionnaireContent(await getDb(), runId);")]) {
  assert.throws(() => patchQuestionnaireLaunchGuard(malformed), /entrypoint|dependency|incomplete/);
}

let writes = 0;
let providerStarts = 0;
const key = "__questionnaireLaunchGuardBindings";
globalThis[key] = {
  getDb: async () => db, assertRunQuestionnaireContent,
  recordLaunchState: async () => { writes++; },
  submitToProvider: async (input) => { providerStarts++; return input; }
};
try {
  const executable = `const { ${Object.keys(globalThis[key]).join(", ")} } = globalThis[${JSON.stringify(key)}];\n`
    + patch.source.replace(/^import\s[\s\S]*?;\n/gm, "");
  const service = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  currentQuestions = [{ ...questions[0], question_text: "Unexpected changed question" }];
  await assert.rejects(service.launchRun({ runId, limit: 10 }), (error) => error.statusCode === 409);
  assert.equal(writes, 0);
  assert.equal(providerStarts, 0, "Catalogue drift prevents provider submission for the whole batch");
  currentQuestions = questions;
  assert.deepEqual(await service.launchRun({ runId, limit: 1, runContactIds: ["selected"] }), { limit: 1, runContactIds: ["selected"] });
  assert.equal(writes, 1);
  assert.equal(providerStarts, 1);
  stored = { id: header.id, code: header.questionnaire_code, version: 1 };
  await service.launchRun({ runId });
  assert.equal(providerStarts, 2, "Historical header-only snapshots retain the explicitly unenforced legacy path");
} finally {
  delete globalThis[key];
}

const runtime = await mkdtemp(path.join(tmpdir(), "questionnaire-launch-install-"));
try {
  await assert.rejects(installQuestionnaireLaunchGuard(runtime), (error) => error.code === "ENOENT");
  assert.deepEqual(await readdir(runtime), [], "A missing required launch service does not cause a partial install");
  const servicePath = path.join(runtime, "src/services/run-launch.service.js");
  await mkdir(path.dirname(servicePath), { recursive: true });
  await writeFile(servicePath, "// unknown launch service\n");
  await assert.rejects(installQuestionnaireLaunchGuard(runtime), /entrypoint/);
  assert.equal(await readFile(servicePath, "utf8"), "// unknown launch service\n");
  await assert.rejects(readFile(path.join(runtime, "src/repositories/questionnaire-snapshot.repository.js")), (error) => error.code === "ENOENT");
  await writeFile(servicePath, fixture);
  const installed = await installQuestionnaireLaunchGuard(runtime);
  assert.equal(installed.changed, true);
  assert.equal(await readFile(installed.backup, "utf8"), fixture);
  assert.equal(await readFile(servicePath, "utf8"), patch.source);
  assert.match(await readFile(path.join(runtime, "src/repositories/questionnaire-snapshot.repository.js"), "utf8"), /assertRunQuestionnaireContent/);
  const before = await readdir(path.dirname(servicePath));
  assert.equal((await installQuestionnaireLaunchGuard(runtime)).changed, false);
  assert.deepEqual(await readdir(path.dirname(servicePath)), before, "Identical reinstall creates no extra service backup");
} finally {
  await rm(runtime, { recursive: true, force: true });
}
if (process.env.PGLITE_MODULE_PATH) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const database = new PGlite();
  try {
    await database.exec(`CREATE TABLE questionnaires (
        id uuid PRIMARY KEY, questionnaire_code text, questionnaire_name text, version_number integer, status text
      );
      CREATE TABLE program_iterations (id uuid PRIMARY KEY, questionnaire_id uuid, questionnaire_snapshot jsonb);
      CREATE TABLE campaign_runs (id uuid PRIMARY KEY, iteration_id uuid);
      CREATE TABLE questions (questionnaire_id uuid, question_order integer, question_code text,
        question_text text, question_type text, options jsonb, metadata jsonb);`);
    await database.query("INSERT INTO questionnaires VALUES ($1::uuid, $2, $3, $4, $5)",
      [header.id, header.questionnaire_code, header.questionnaire_name, header.version_number, header.status]);
    await database.query("INSERT INTO questions VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb)",
      [header.id, questions[0].question_order, questions[0].question_code, questions[0].question_text,
        questions[0].question_type, JSON.stringify(questions[0].options), JSON.stringify(questions[0].metadata)]);
    const captured = await freezeQuestionnaireContent(database, header);
    const iterationId = "5410403e-d257-4389-8c47-fba6ac31c666";
    await database.query("INSERT INTO program_iterations VALUES ($1::uuid, $2::uuid, $3::jsonb)", [iterationId, header.id, JSON.stringify(captured)]);
    await database.query("INSERT INTO campaign_runs VALUES ($1::uuid, $2::uuid)", [runId, iterationId]);
    assert.deepEqual(await assertRunQuestionnaireContent(database, runId), { enforced: true, status: "CATALOGUE_CONTENT_MATCHED" });
    await database.query("UPDATE questions SET question_text = $1", ["Changed live catalogue wording"]);
    await assert.rejects(assertRunQuestionnaireContent(database, runId), (error) => error.statusCode === 409);
    await database.query("UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb", [JSON.stringify({ id: header.id, code: header.questionnaire_code, version: 1 })]);
    assert.deepEqual(await assertRunQuestionnaireContent(database, runId), { enforced: false, status: "LEGACY_CONTENT_UNAVAILABLE" });
  } finally {
    await database.close();
  }
  console.log("Run/Iteration catalogue drift lookup passed against PostgreSQL-compatible storage.");
}
console.log("Future questionnaire catalogue drift, first-action launch guard and fail-closed installer tests passed.");
