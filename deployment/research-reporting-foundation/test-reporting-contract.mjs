import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { REPORT_KEYS, EXPLICIT_MISSING_STATES, validateReportingContract, validateContractSave } from "./reporting-contract.validation.js";
import { listQuestionnaireReportingCoverage, reportingContractFingerprint, saveQuestionReportingContract } from "./reporting-contract.repository.js";

const questionnaireId = "eb55fbc2-54db-4609-80d4-7cf7118bb15d";
const questionId = "9417d766-0947-42d1-b84f-59f0b261d602";
const siblingId = "63c45412-04ed-454a-863b-d2ae0106980d";
const actor = { id: "d5af7113-abfc-4a97-86ef-d663570511bf", role_code: "ADMIN" };
const questionnaire = { id: questionnaireId, questionnaire_code: "PUBLIC_NEEDS_V2", questionnaire_name: "Public needs",
  version_number: 2, status: "ACTIVE" };
const sampleContract = {
  reportKey: "issue_priority", outputVariables: ["public_issue_priority"], valueType: "CATEGORICAL",
  allowedValues: ["Employment", "Public services", "Other"], target: { type: "NONE", id: "", name: "" },
  missingPolicy: "EXPLICIT_STATES"
};
const sampleQuestion = { id: questionId, questionnaire_id: questionnaireId, question_code: "Q_ISSUE",
  question_order: 1, question_text: "Which public issue matters most?", options: ["Employment", "Public services", "Other"],
  metadata: { question_text_telugu: "మీకు ముఖ్యమైన ప్రజా సమస్య ఏమిటి?", required_for_completion: true,
    section: "CORE", opaque: { retain: [1, 2, 3] } } };

assert.deepEqual(validateReportingContract(sampleContract), sampleContract);
assert.deepEqual(EXPLICIT_MISSING_STATES, ["NOT_ANSWERED", "CANT_SAY", "REFUSED"]);
for (const reportKey of REPORT_KEYS) {
  const type = ({ candidate_impression: "CANDIDATE", candidate_fit: "CANDIDATE", scheme_experience: "SCHEME",
    leader_assessment: "LEADER" })[reportKey] || "NONE";
  const target = { type, id: type === "NONE" ? "" : "stable_entity_1", name: type === "NONE" ? "" : "Recorded entity" };
  assert.equal(validateReportingContract({ ...sampleContract, reportKey, target }).reportKey, reportKey);
}
for (const mutate of [
  (c) => { c.reportKey = "inferred_political_lean"; },
  (c) => { c.reportKey = "issue_priority; DROP TABLE voters"; },
  (c) => { c.outputVariables = []; },
  (c) => { c.outputVariables = ["party lean"]; },
  (c) => { c.outputVariables = ["PoliticalLean"]; },
  (c) => { c.outputVariables = ["output__double"]; },
  (c) => { c.outputVariables = ["x_".repeat(50)]; },
  (c) => { c.outputVariables = ["same_key", "same_key"]; },
  (c) => { c.outputVariables = Array.from({ length: 11 }, (_, index) => `output_${index}`); },
  (c) => { c.allowedValues = ["Same", "same"]; },
  (c) => { c.allowedValues = ["Only one"]; },
  (c) => { c.allowedValues = ["Positive", "not answered"]; },
  (c) => { c.allowedValues = ["Positive", "can't say"]; },
  (c) => { c.allowedValues = ["Positive", "refused"]; },
  (c) => { c.allowedValues = ["Positive", "\u0000Hidden"]; },
  (c) => { c.valueType = "TEXT"; },
  (c) => { c.valueType = "NUMERIC"; },
  (c) => { c.valueType = "PREDICTED_LEAN"; },
  (c) => { c.missingPolicy = "ZERO"; },
  (c) => { c.target = { type: "NONE", id: "hidden", name: "" }; },
  (c) => { c.target = { type: "PARTY", id: "", name: "A party" }; },
  (c) => { c.target = { type: "PARTY", id: "stable", name: "" }; },
  (c) => { c.target = { type: "PARTY", id: "bad id", name: "A party" }; },
  (c) => { c.reportKey = "candidate_fit"; },
  (c) => { c.reportKey = "leader_assessment"; },
  (c) => { c.reportKey = "scheme_experience"; },
  (c) => { c.target = { type: "CANDIDATE", id: "person", name: "Person" }; c.reportKey = "party_salience"; },
  (c) => { c.target = { type: "CANDIDATE", id: "person", name: "Person" }; },
  (c) => { c.target = { type: "SCHEME", id: "scheme", name: "Scheme" }; },
  (c) => { c.certified = true; },
  (c) => { c.target.certified = true; }
]) {
  const input = structuredClone(sampleContract);
  mutate(input);
  assert.throws(() => validateReportingContract(input), (error) => error.statusCode === 400, JSON.stringify(input));
}
for (const input of [null, [], "unknown"]) assert.throws(() => validateReportingContract(input));
assert.equal(validateReportingContract({ ...sampleContract, target: undefined }).target.type, "NONE");
for (const valueType of ["TEXT", "NUMERIC"]) {
  assert.deepEqual(validateReportingContract({ ...sampleContract, valueType, allowedValues: [] }).allowedValues, []);
}
assert.equal(validateReportingContract({ ...sampleContract, target: { type: "PARTY", id: "party_1", name: "Recorded party" } }).target.id, "party_1");
assert.throws(() => validateContractSave({ contract: sampleContract }), /fingerprint/);
assert.throws(() => validateContractSave({ contract: sampleContract, expectedContractFingerprint: "A".repeat(64) }), /fingerprint/);
assert.throws(() => validateContractSave({ contract: sampleContract, expectedContractFingerprint: "a".repeat(64), overwrite: true }), /unsupported/);

function fakeDatabase(overrides = {}) {
  const state = { header: structuredClone(questionnaire), questions: [structuredClone(sampleQuestion)], used: 0,
    relations: [{ schema_name: "public", table_name: "stored_questions", relation_oid: 42 }],
    columns: [{ column_name: "id", data_type: "uuid" }, { column_name: "questionnaire_id", data_type: "uuid" },
      { column_name: "metadata", data_type: "jsonb" }], statements: [], connections: 0, writes: 0, releases: 0, ...overrides };
  let queue = Promise.resolve();
  async function acquireHeader() {
    const predecessor = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await predecessor;
    return release;
  }
  const db = { async connect() {
    state.connections++;
    let unlock = null;
    return {
      async query(sql, values = []) {
        state.statements.push({ sql, values });
        if (/^(?:BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
          if (/^(?:COMMIT|ROLLBACK)/.test(sql) && unlock) { unlock(); unlock = null; }
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM questionnaires")) {
          if (sql.includes("FOR UPDATE")) unlock = await acquireHeader();
          return { rows: state.header ? [structuredClone(state.header)] : [], rowCount: state.header ? 1 : 0 };
        }
        if (sql.includes("FROM program_iterations")) return { rows: [{ used_by_iterations: state.used }] };
        if (sql.includes("FROM pg_catalog.pg_class")) return { rows: structuredClone(state.relations) };
        if (sql.includes("FROM pg_catalog.pg_attribute")) return { rows: structuredClone(state.columns) };
        if (sql.includes("UPDATE ")) {
          assert.match(sql, /SET metadata = \$3::jsonb/);
          assert.equal(values[0], questionId);
          assert.equal(values[1], questionnaireId);
          const question = state.questions.find((row) => row.id === values[0] && row.questionnaire_id === values[1]);
          if (!question) return { rows: [] };
          question.metadata = JSON.parse(values[2]);
          state.writes++;
          return { rows: [{ question: structuredClone(question) }] };
        }
        if (sql.includes("SELECT to_jsonb(question)")) {
          let questions = state.questions;
          if (sql.includes("question.id <>")) questions = questions.filter((row) => row.id !== values[1] && row.questionnaire_id === values[0]);
          else if (sql.includes("question.id =")) questions = questions.filter((row) => row.id === values[0] && row.questionnaire_id === values[1]);
          else questions = questions.filter((row) => row.questionnaire_id === values[0]);
          return { rows: questions.map((question) => ({ question: structuredClone(question) })) };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() { state.releases++; assert.equal(unlock, null, "Transaction must finish before connection release"); }
    };
  } };
  return { db, state, acquireHeader };
}

const { db, state } = fakeDatabase();
const read = await listQuestionnaireReportingCoverage(db, actor, questionnaireId);
assert.equal(read.locked, false);
assert.equal(read.usedByIterations, 0);
assert.equal(read.questions[0].contract, null);
assert.equal(read.questions[0].contractValid, false);
assert.equal(read.questions[0].expectedContractFingerprint, reportingContractFingerprint(sampleQuestion));
assert.equal(state.writes, 0, "GET is read-only and does not infer contracts");
assert.equal(state.statements[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
const body = { expectedContractFingerprint: read.questions[0].expectedContractFingerprint, contract: sampleContract };
const result = await saveQuestionReportingContract(db, actor, questionnaireId, questionId, body);
assert.deepEqual(result.question.contract, sampleContract);
assert.equal(result.question.contractValid, true);
assert.notEqual(result.question.expectedContractFingerprint, body.expectedContractFingerprint);
assert.deepEqual(state.questions[0].metadata.opaque, sampleQuestion.metadata.opaque);
assert.equal(state.questions[0].metadata.question_text_telugu, sampleQuestion.metadata.question_text_telugu);
assert.equal(state.questions[0].metadata.required_for_completion, true);
assert.deepEqual(state.questions[0].metadata.output_variables, sampleContract.outputVariables);
assert.deepEqual(state.questions[0].options, sampleQuestion.options);
assert.equal(state.questions[0].question_text, sampleQuestion.question_text);
assert.equal(state.writes, 1);
assert.ok(state.statements.some((entry) => /FROM questionnaires[\s\S]*FOR UPDATE/.test(entry.sql)));
assert.ok(!state.statements.some((entry) => /UPDATE (?:program_iterations|campaign_runs|questionnaires)/.test(entry.sql)), "No historical instruments/calls or identity headers are rewritten");
const headerLock = state.statements.findIndex((entry) => /FROM questionnaires[\s\S]*FOR UPDATE/.test(entry.sql));
const usage = state.statements.findIndex((entry, index) => index > headerLock && entry.sql.includes("FROM program_iterations"));
assert.ok(usage > headerLock, "Selection header lock precedes reference checks");
await assert.rejects(saveQuestionReportingContract(db, actor, questionnaireId, questionId, body), (error) => error.code === "REPORTING_CONTRACT_CONFLICT" && error.statusCode === 409);
assert.equal(state.writes, 1);

for (const invalidActor of [null, { id: "viewer", role_code: "CAMPAIGN_MANAGER" }, { id: "caller", role_code: "CAMPAIGNER" }, { role_code: "ADMIN" }, { id: {}, role_code: "ADMIN" }]) {
  const denied = fakeDatabase();
  await assert.rejects(listQuestionnaireReportingCoverage(denied.db, invalidActor, questionnaireId), { statusCode: 403 });
  await assert.rejects(saveQuestionReportingContract(denied.db, invalidActor, questionnaireId, questionId, body), { statusCode: 403 });
  assert.equal(denied.state.connections, 0);
}
for (const invalidId of ["unknown", `${questionnaireId}' OR TRUE --`, "../questionnaires", " "]) {
  const denied = fakeDatabase();
  await assert.rejects(listQuestionnaireReportingCoverage(denied.db, actor, invalidId), { statusCode: 400 });
  await assert.rejects(saveQuestionReportingContract(denied.db, actor, questionnaireId, invalidId, body), { statusCode: 400 });
  assert.equal(denied.state.connections, 0, "Request IDs never become query text");
}
for (const relationRows of [[], [state.relations[0], { schema_name: "public", table_name: "other_questions", relation_oid: 43 }]]) {
  const failed = fakeDatabase({ relations: relationRows });
  await assert.rejects(listQuestionnaireReportingCoverage(failed.db, actor, questionnaireId), { statusCode: 503, code: "QUESTION_SCHEMA_UNAVAILABLE" });
  assert.equal(failed.state.writes, 0);
  assert.equal(failed.state.releases, 1);
}
for (const columns of [[], [{ column_name: "metadata", data_type: "json" }], [{ column_name: "id", data_type: "text" }]]) {
  const failed = fakeDatabase({ columns });
  await assert.rejects(saveQuestionReportingContract(failed.db, actor, questionnaireId, questionId, body), { statusCode: 503, code: "QUESTION_METADATA_UNSUPPORTED" });
  assert.equal(failed.state.writes, 0);
}
for (const metadata of ["string metadata", ["array metadata"]]) {
  const question = { ...sampleQuestion, metadata };
  const failed = fakeDatabase({ questions: [question] });
  await assert.rejects(saveQuestionReportingContract(failed.db, actor, questionnaireId, questionId,
    { ...body, expectedContractFingerprint: reportingContractFingerprint(question) }), { code: "QUESTION_METADATA_INCOMPATIBLE" });
  assert.deepEqual(failed.state.questions[0].metadata, metadata, "Malformed metadata is never replaced/lost");
}
const nullMetadataQuestion = { ...sampleQuestion, metadata: null };
const nullMetadata = fakeDatabase({ questions: [nullMetadataQuestion] });
await saveQuestionReportingContract(nullMetadata.db, actor, questionnaireId, questionId,
  { ...body, expectedContractFingerprint: reportingContractFingerprint(nullMetadataQuestion) });
assert.deepEqual(nullMetadata.state.questions[0].metadata.reporting_contract, sampleContract);
for (const existingOutputs of [["legacy_key"], [], "single_key"]) {
  const question = { ...sampleQuestion, output_variables: existingOutputs };
  const failed = fakeDatabase({ questions: [question] });
  await assert.rejects(saveQuestionReportingContract(failed.db, actor, questionnaireId, questionId,
    { ...body, expectedContractFingerprint: reportingContractFingerprint(question) }), { code: "QUESTION_OUTPUT_MAPPING_CONFLICT" });
  assert.equal(failed.state.writes, 0);
}
const consistentQuestion = { ...sampleQuestion, output_variables: sampleContract.outputVariables };
const consistent = fakeDatabase({ questions: [consistentQuestion] });
await saveQuestionReportingContract(consistent.db, actor, questionnaireId, questionId,
  { ...body, expectedContractFingerprint: reportingContractFingerprint(consistentQuestion) });
assert.deepEqual(consistent.state.questions[0].output_variables, sampleContract.outputVariables);
for (const field of ["outputVariables", "metadata.outputVariables"]) {
  const question = structuredClone(sampleQuestion);
  if (field.startsWith("metadata.")) question.metadata.outputVariables = ["legacy_key"];
  else question.outputVariables = ["legacy_key"];
  const failed = fakeDatabase({ questions: [question] });
  await assert.rejects(saveQuestionReportingContract(failed.db, actor, questionnaireId, questionId,
    { ...body, expectedContractFingerprint: reportingContractFingerprint(question) }), { code: "QUESTION_OUTPUT_MAPPING_CONFLICT" });
  assert.equal(failed.state.writes, 0, "CamelCase legacy mapping cannot contradict the new contract");
}
const matchingAliases = { ...structuredClone(sampleQuestion), outputVariables: sampleContract.outputVariables,
  metadata: { ...structuredClone(sampleQuestion.metadata), outputVariables: sampleContract.outputVariables } };
const consistentAliases = fakeDatabase({ questions: [matchingAliases] });
await saveQuestionReportingContract(consistentAliases.db, actor, questionnaireId, questionId,
  { ...body, expectedContractFingerprint: reportingContractFingerprint(matchingAliases) });
assert.deepEqual(consistentAliases.state.questions[0].outputVariables, sampleContract.outputVariables);
assert.deepEqual(consistentAliases.state.questions[0].metadata.outputVariables, sampleContract.outputVariables);

for (const count of [1, 5]) {
  const locked = fakeDatabase({ used: count });
  const listing = await listQuestionnaireReportingCoverage(locked.db, actor, questionnaireId);
  assert.equal(listing.locked, true);
  assert.equal(listing.usedByIterations, count);
  await assert.rejects(saveQuestionReportingContract(locked.db, actor, questionnaireId, questionId, body), { statusCode: 409, code: "QUESTIONNAIRE_CONTRACT_LOCKED" });
  assert.equal(locked.state.writes, 0, "Even an unlaunched/closed reference locks instrument editing");
}
for (const status of ["ARCHIVED", "RETIRED", "INACTIVE"]) {
  const locked = fakeDatabase({ header: { ...questionnaire, status } });
  assert.equal((await listQuestionnaireReportingCoverage(locked.db, actor, questionnaireId)).locked, true);
  await assert.rejects(saveQuestionReportingContract(locked.db, actor, questionnaireId, questionId, body), { code: "QUESTIONNAIRE_CONTRACT_LOCKED" });
}
const sibling = { ...sampleQuestion, id: siblingId, question_code: "Q_OTHER", question_order: 2,
  metadata: { output_variables: ["public_issue_priority"] } };
const duplicate = fakeDatabase({ questions: [structuredClone(sampleQuestion), sibling] });
await assert.rejects(saveQuestionReportingContract(duplicate.db, actor, questionnaireId, questionId, body), { code: "DUPLICATE_QUESTION_OUTPUT" });
assert.equal(duplicate.state.writes, 0);
for (const otherQuestion of [
  { ...sibling, metadata: {}, outputVariables: ["public_issue_priority"] },
  { ...sibling, metadata: { outputVariables: ["public_issue_priority"] } },
  { ...sibling, metadata: { outputVariables: [{ key: "public_issue_priority" }] } },
  { ...sibling, metadata: { output_variables: [" PUBLIC_ISSUE_PRIORITY "] } }
]) {
  const duplicateAlias = fakeDatabase({ questions: [structuredClone(sampleQuestion), otherQuestion] });
  await assert.rejects(saveQuestionReportingContract(duplicateAlias.db, actor, questionnaireId, questionId, body), { code: "DUPLICATE_QUESTION_OUTPUT" });
  assert.equal(duplicateAlias.state.writes, 0, "CamelCase/structured legacy aliases remain unambiguous across questions");
}
const unnamed = { ...sampleQuestion, question_code: " " };
const noCode = fakeDatabase({ questions: [unnamed] });
await assert.rejects(saveQuestionReportingContract(noCode.db, actor, questionnaireId, questionId,
  { ...body, expectedContractFingerprint: reportingContractFingerprint(unnamed) }), { code: "QUESTION_CODE_REQUIRED" });
assert.equal(noCode.state.writes, 0);
const noQuestion = fakeDatabase({ questions: [] });
await assert.rejects(saveQuestionReportingContract(noQuestion.db, actor, questionnaireId, questionId, body), { statusCode: 404, code: "QUESTION_NOT_FOUND" });
const noHeader = fakeDatabase({ header: null });
await assert.rejects(listQuestionnaireReportingCoverage(noHeader.db, actor, questionnaireId), { statusCode: 404, code: "QUESTIONNAIRE_NOT_FOUND" });
assert.equal(noHeader.state.writes, 0);
const malformed = fakeDatabase({ questions: [{ ...sampleQuestion, metadata: { reporting_contract: { reportKey: "unknown" } } }] });
const malformedRead = await listQuestionnaireReportingCoverage(malformed.db, actor, questionnaireId);
assert.equal(malformedRead.questions[0].contractValid, false);
assert.ok(malformedRead.questions[0].contractError);
assert.equal(malformed.state.writes, 0, "Legacy/malformed contracts are not repaired or certified on read");

const quote = fakeDatabase({ relations: [{ schema_name: "public", table_name: 'questions"; DROP TABLE users; --', relation_oid: 99 }] });
await listQuestionnaireReportingCoverage(quote.db, actor, questionnaireId);
assert.ok(quote.state.statements.some((entry) => entry.sql.includes('FROM "public"."questions""; DROP TABLE users; --" question')),
  "Catalogue identifiers are properly quoted, never treated as executable SQL");
assert.ok(quote.state.statements.some((entry) => entry.values[0] === 99 && entry.sql.includes("$1::oid")));

const concurrent = fakeDatabase();
const saves = await Promise.allSettled([
  saveQuestionReportingContract(concurrent.db, actor, questionnaireId, questionId, body),
  saveQuestionReportingContract(concurrent.db, { ...actor, role_code: "SUPER_ADMIN" }, questionnaireId, questionId,
    { ...body, contract: { ...sampleContract, allowedValues: ["Jobs", "Roads"] } })
]);
assert.equal(saves.filter((save) => save.status === "fulfilled").length, 1);
assert.equal(saves.filter((save) => save.status === "rejected" && save.reason.code === "REPORTING_CONTRACT_CONFLICT").length, 1);
assert.equal(concurrent.state.writes, 1, "Only one stale-fingerprint author can save");
assert.equal(concurrent.state.releases, 2);

// Simulate Iteration creation holding its documented FOR SHARE header lock.
// Authoring must wait and then observe the committed selection reference.
const selecting = fakeDatabase();
const selectionUnlock = await selecting.acquireHeader();
const waitingSave = saveQuestionReportingContract(selecting.db, actor, questionnaireId, questionId, body);
for (let turn = 0; turn < 10; turn++) await Promise.resolve();
assert.ok(selecting.state.statements.some((entry) => /FROM questionnaires[\s\S]*FOR UPDATE/.test(entry.sql)));
assert.ok(!selecting.state.statements.some((entry) => entry.sql.includes("FROM program_iterations")),
  "Reference check waits until the selection header lock is released");
selecting.state.used = 1;
selectionUnlock();
await assert.rejects(waitingSave, { code: "QUESTIONNAIRE_CONTRACT_LOCKED" });
assert.equal(selecting.state.writes, 0);
const creationSource = await readFile(new URL("../campaign-workspace/campaign-iterations.repository.js", import.meta.url), "utf8");
assert.match(creationSource, /FROM questionnaires[\s\S]*?WHERE id = \$1::uuid[\s\S]*?FOR SHARE/,
  "Authoring lock agrees with the actual questionnaire selection path");

assert.equal(reportingContractFingerprint(sampleQuestion), reportingContractFingerprint(Object.fromEntries(Object.entries(sampleQuestion).reverse())));
assert.notEqual(reportingContractFingerprint(sampleQuestion), reportingContractFingerprint({ ...sampleQuestion, question_text: "A changed question" }));

// Execute route wiring without Express/network/database dependencies to verify
// both route-level middleware and repository-level authorization are retained.
const source = await readFile(new URL("./reporting-contract.routes.js", import.meta.url), "utf8");
const registered = [];
const middlewareAuth = () => {};
const middlewareRole = (roles) => ({ roleMiddleware: roles });
const routeBindingsKey = "__reportingContractRouteBindings";
const routeDb = {};
const observed = [];
globalThis[routeBindingsKey] = {
  express: { Router: () => ({ get: (...args) => registered.push({ method: "GET", args }), patch: (...args) => registered.push({ method: "PATCH", args }) }) },
  requireAuth: middlewareAuth, requireRole: middlewareRole, getDb: async () => routeDb,
  listQuestionnaireReportingCoverage: async (...args) => { observed.push(args); return { questions: [] }; },
  saveQuestionReportingContract: async (...args) => { observed.push(args); return { question: {} }; }
};
try {
  const executable = `const { ${Object.keys(globalThis[routeBindingsKey]).join(", ")} } = globalThis[${JSON.stringify(routeBindingsKey)}];\n`
    + source.replace(/^import\s[\s\S]*?;\n/gm, "");
  await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  assert.deepEqual(registered.map((route) => route.method), ["GET", "PATCH"]);
  for (const route of registered) {
    assert.equal(route.args[1], middlewareAuth);
    assert.deepEqual(route.args[2].roleMiddleware, ["SUPER_ADMIN", "ADMIN"]);
    const headers = {};
    const res = { set: (key, value) => { headers[key] = value; }, json: (value) => value };
    await route.args[3]({ platformUser: actor, params: { questionnaireId, questionId }, body }, res);
    assert.equal(headers["Cache-Control"], "no-store");
  }
  assert.deepEqual(observed[0], [routeDb, actor, questionnaireId]);
  assert.deepEqual(observed[1], [routeDb, actor, questionnaireId, questionId, body]);
} finally { delete globalThis[routeBindingsKey]; }

// Optional isolated PostgreSQL-engine test. No production connection, provider
// credentials or installed database are needed; use an existing PGlite module.
if (process.env.PGLITE_MODULE_PATH) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const engine = new PGlite();
  const pool = { connect: async () => ({ query: (...args) => engine.query(...args), release() {} }) };
  try {
    await engine.exec(`
      CREATE TABLE questionnaires (
        id uuid PRIMARY KEY, questionnaire_code text, questionnaire_name text,
        version_number integer, status text
      );
      CREATE TABLE program_iterations (id uuid PRIMARY KEY, questionnaire_id uuid REFERENCES questionnaires(id));
      CREATE TABLE stored_questions (
        id uuid PRIMARY KEY, questionnaire_id uuid REFERENCES questionnaires(id),
        question_order integer, question_code text, question_text text, options jsonb, metadata jsonb
      );
    `);
    await engine.query("INSERT INTO questionnaires VALUES ($1, $2, $3, $4, $5)",
      [questionnaire.id, questionnaire.questionnaire_code, questionnaire.questionnaire_name, questionnaire.version_number, questionnaire.status]);
    await engine.query("INSERT INTO stored_questions VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)",
      [sampleQuestion.id, sampleQuestion.questionnaire_id, sampleQuestion.question_order, sampleQuestion.question_code,
        sampleQuestion.question_text, JSON.stringify(sampleQuestion.options), JSON.stringify(sampleQuestion.metadata)]);
    const catalog = await listQuestionnaireReportingCoverage(pool, actor, questionnaireId);
    assert.equal(catalog.questions.length, 1);
    assert.equal(catalog.locked, false);
    const saved = await saveQuestionReportingContract(pool, actor, questionnaireId, questionId,
      { expectedContractFingerprint: catalog.questions[0].expectedContractFingerprint, contract: sampleContract });
    assert.deepEqual(saved.question.contract, sampleContract);
    const actual = await engine.query("SELECT metadata, options, question_text FROM stored_questions WHERE id = $1", [questionId]);
    assert.deepEqual(actual.rows[0].metadata.opaque, sampleQuestion.metadata.opaque);
    assert.deepEqual(actual.rows[0].metadata.output_variables, sampleContract.outputVariables);
    assert.deepEqual(actual.rows[0].options, sampleQuestion.options);
    assert.equal(actual.rows[0].question_text, sampleQuestion.question_text);
    await assert.rejects(saveQuestionReportingContract(pool, actor, questionnaireId, questionId,
      { expectedContractFingerprint: catalog.questions[0].expectedContractFingerprint, contract: sampleContract }), { code: "REPORTING_CONTRACT_CONFLICT" });
    await engine.query("INSERT INTO program_iterations VALUES ($1, $2)", [siblingId, questionnaireId]);
    assert.equal((await listQuestionnaireReportingCoverage(pool, actor, questionnaireId)).locked, true);
    await assert.rejects(saveQuestionReportingContract(pool, actor, questionnaireId, questionId,
      { expectedContractFingerprint: saved.question.expectedContractFingerprint, contract: sampleContract }), { code: "QUESTIONNAIRE_CONTRACT_LOCKED" });
    await engine.exec("CREATE TABLE ambiguous_questions (LIKE stored_questions INCLUDING ALL)");
    await assert.rejects(listQuestionnaireReportingCoverage(pool, actor, questionnaireId), { code: "QUESTION_SCHEMA_UNAVAILABLE" });
    await engine.exec("DROP TABLE ambiguous_questions; ALTER TABLE stored_questions ALTER COLUMN metadata TYPE json USING metadata::json");
    await assert.rejects(listQuestionnaireReportingCoverage(pool, actor, questionnaireId), { code: "QUESTION_METADATA_UNSUPPORTED" });
    console.log("Reporting-contract PostgreSQL-engine schema, JSONB preservation and used-instrument lock tests passed.");
  } finally { await engine.close(); }
}

console.log("Reporting-contract validation, schema discovery, metadata preservation, protected routes and concurrency tests passed.");
