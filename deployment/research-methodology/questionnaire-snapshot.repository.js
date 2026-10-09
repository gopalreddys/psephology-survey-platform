import { createHash } from "node:crypto";

const SEMANTIC_EXCLUSIONS = new Set([
  "id", "questionnaire_id", "created_at", "updated_at", "created_by", "updated_by",
  "created_by_user_id", "updated_by_user_id"
]);

function failure(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

// Freeze only rows that exist now. No historical Iteration is updated and no
// question, core subset, wording, option or output mapping is inferred.
export function buildQuestionnaireContentSnapshot(questionnaire, rows) {
  if (!questionnaire?.id || !String(questionnaire.questionnaire_code || "").trim()
      || questionnaire.version_number === null || questionnaire.version_number === undefined) {
    throw failure("Selected questionnaire must have a recorded identity, code and version");
  }
  if (!Array.isArray(rows) || !rows.length) {
    throw failure("Add the approved questions before selecting this questionnaire for an Iteration");
  }
  const codes = new Set();
  const orders = new Set();
  const questions = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw failure("The selected questionnaire contains an invalid question definition");
    }
    const code = typeof row.question_code === "string" ? row.question_code.trim() : "";
    const order = Number(row.question_order);
    if (!code || typeof row.question_text !== "string" || !row.question_text.trim()
        || !Number.isInteger(order) || order < 1) {
      throw failure("Every approved question needs a stable code, positive order and question text");
    }
    if (codes.has(code.toUpperCase()) || orders.has(order)) {
      throw failure("Question codes and question orders must be unique within the selected questionnaire");
    }
    codes.add(code.toUpperCase());
    orders.add(order);
    // Preserve existing schema fields, including Telugu wording, options,
    // completion rules and output-variable metadata. Exclude storage identity
    // and timestamps, which are not part of the research instrument content.
    return Object.fromEntries(Object.entries(row)
      .filter(([key]) => !SEMANTIC_EXCLUSIONS.has(key)));
  }).sort((left, right) => Number(left.question_order) - Number(right.question_order));
  const content = canonical(questions);
  return {
    id: questionnaire.id,
    code: questionnaire.questionnaire_code,
    name: questionnaire.questionnaire_name,
    version: questionnaire.version_number,
    status_at_selection: questionnaire.status,
    snapshot_schema_version: 2,
    question_provenance: "FROZEN_AT_SELECTION",
    questions: content,
    content_fingerprint: createHash("sha256").update(JSON.stringify(content)).digest("hex")
  };
}

export async function freezeQuestionnaireContent(client, questionnaire) {
  // The backend's questionnaire relation is not maintained in this UI mirror.
  // Resolve its actual schema rather than assuming a table name or optional
  // columns. Only a single public stored relation with the known question
  // contract is accepted; an absent/ambiguous contract fails closed.
  const relations = await client.query(`
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
      AND attribute.attname IN ('questionnaire_id', 'question_order', 'question_code', 'question_text')
    GROUP BY namespace.nspname, relation.relname
    HAVING COUNT(DISTINCT attribute.attname) = 4
  `);
  if (relations.rows.length !== 1) {
    throw failure("Questionnaire content schema is unavailable or ambiguous; review the questionnaire storage before creating an Iteration", 503);
  }
  const relation = relations.rows[0];
  const selected = await client.query(`
    SELECT to_jsonb(question) AS question
    FROM ${quotedIdentifier(relation.schema_name)}.${quotedIdentifier(relation.table_name)} question
    WHERE question.questionnaire_id = $1::uuid
    ORDER BY question.question_order, question.question_code
    FOR SHARE
  `, [questionnaire.id]);
  return buildQuestionnaireContentSnapshot(questionnaire, selected.rows.map((row) => row.question));
}

function launchFailure(message) {
  const error = failure(message, 409);
  error.code = "QUESTIONNAIRE_CONTENT_DRIFT";
  return error;
}

// A launch-time catalogue drift check is not a proof of the committed provider
// prompt. It never changes runtime variables, provider prompts or old records.
export async function assertRunQuestionnaireContent(db, runId) {
  const result = await db.query(`
    SELECT iteration.questionnaire_snapshot,
      to_jsonb(questionnaire) AS current_questionnaire
    FROM campaign_runs run
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    LEFT JOIN questionnaires questionnaire ON questionnaire.id = iteration.questionnaire_id
    WHERE run.id = $1::uuid
  `, [runId]);
  if (result.rows.length !== 1) throw failure("Run not found", 404);
  const { questionnaire_snapshot: snapshot, current_questionnaire: current } = result.rows[0];
  if (!snapshot || snapshot.snapshot_schema_version === undefined
      || Number(snapshot.snapshot_schema_version) === 1) {
    return { enforced: false, status: "LEGACY_CONTENT_UNAVAILABLE" };
  }
  if (Number(snapshot.snapshot_schema_version) !== 2) {
    throw launchFailure("This questionnaire content snapshot version is unsupported; review the Iteration before launching calls");
  }
  if (snapshot.question_provenance !== "FROZEN_AT_SELECTION"
      || typeof snapshot.content_fingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(snapshot.content_fingerprint)) {
    throw launchFailure("The frozen questionnaire content provenance is incomplete; review the Iteration before launching calls");
  }
  let frozen;
  try {
    frozen = buildQuestionnaireContentSnapshot({
      id: snapshot.id, questionnaire_code: snapshot.code, questionnaire_name: snapshot.name,
      version_number: snapshot.version, status: snapshot.status_at_selection
    }, snapshot.questions);
  } catch {
    throw launchFailure("The frozen questionnaire question definitions are incomplete; review the Iteration before launching calls");
  }
  if (frozen.content_fingerprint !== snapshot.content_fingerprint) {
    throw launchFailure("The frozen questionnaire content fingerprint is inconsistent; review the Iteration before launching calls");
  }
  if (!current || current.id !== snapshot.id
      || current.questionnaire_code !== snapshot.code
      || String(current.version_number) !== String(snapshot.version)) {
    throw launchFailure("The selected questionnaire identity or version changed after Iteration creation; create a new approved Iteration instead of rewriting its instrument");
  }
  let actual;
  try { actual = await freezeQuestionnaireContent(db, current); } catch (error) {
    if (error.statusCode !== 400) throw error;
    throw launchFailure("The current questionnaire catalogue is incomplete; restore the approved instrument or create a new approved Iteration before launching calls");
  }
  if (actual.content_fingerprint !== snapshot.content_fingerprint) {
    throw launchFailure("Questionnaire wording, options or output definitions changed after Iteration creation; restore the approved instrument or create a new approved Iteration before launching calls");
  }
  return { enforced: true, status: "CATALOGUE_CONTENT_MATCHED" };
}
