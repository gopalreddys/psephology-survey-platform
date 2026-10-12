import { createHash } from "node:crypto";
import { ReportingContractError, validateContractSave, validateReportingContract } from "./reporting-contract.validation.js";

function failure(message, code, statusCode = 409) {
  return new ReportingContractError(message, code, statusCode);
}

function authorize(actor) {
  if (typeof actor?.id !== "string" || !actor.id.trim() || !["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    throw failure("Admin or Super Admin access is required", "REPORTING_CONTRACT_FORBIDDEN", 403);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw failure(`A valid ${label} ID is required`, "INVALID_REPORTING_CONTRACT_ID", 400);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// Conservative edit token over the complete stored question, including all
// metadata. It is an optimistic-lock token, not a prompt/test certification.
export function reportingContractFingerprint(question) {
  return createHash("sha256").update(JSON.stringify(canonical(question))).digest("hex");
}

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function resolveQuestionRelation(client) {
  const result = await client.query(`
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name, relation.oid AS relation_oid
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
      AND attribute.attname IN ('questionnaire_id', 'question_order', 'question_code', 'question_text')
    GROUP BY namespace.nspname, relation.relname, relation.oid
    HAVING COUNT(DISTINCT attribute.attname) = 4
  `);
  if (result.rows.length !== 1) {
    throw failure("Question storage is unavailable or ambiguous; review its schema before authoring reporting contracts", "QUESTION_SCHEMA_UNAVAILABLE", 503);
  }
  const relation = result.rows[0];
  // All identifiers originate in PostgreSQL's catalogue, never in requests.
  if (relation.schema_name !== "public" || typeof relation.table_name !== "string" || !relation.table_name) {
    throw failure("Question storage schema is unsupported", "QUESTION_SCHEMA_UNAVAILABLE", 503);
  }
  const columns = await client.query(`
    SELECT attribute.attname AS column_name, type.typname AS data_type
    FROM pg_catalog.pg_attribute attribute
    JOIN pg_catalog.pg_type type ON type.oid = attribute.atttypid
    WHERE attribute.attrelid = $1::oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
      AND attribute.attname IN ('id', 'questionnaire_id', 'metadata')
  `, [relation.relation_oid]);
  const types = new Map(columns.rows.map((row) => [row.column_name, row.data_type]));
  if (types.get("id") !== "uuid" || types.get("questionnaire_id") !== "uuid" || types.get("metadata") !== "jsonb") {
    throw failure("Reporting contracts require UUID question identity and a JSONB metadata column; no storage changes were made", "QUESTION_METADATA_UNSUPPORTED", 503);
  }
  return `${quotedIdentifier(relation.schema_name)}.${quotedIdentifier(relation.table_name)}`;
}

function editableMetadata(question) {
  if (question.metadata === null || question.metadata === undefined) return {};
  if (typeof question.metadata !== "object" || Array.isArray(question.metadata)) {
    throw failure("This question has non-object metadata; review it before saving so existing content is not lost", "QUESTION_METADATA_INCOMPATIBLE");
  }
  return question.metadata;
}

function questionResponse(question) {
  const metadata = question.metadata && typeof question.metadata === "object" && !Array.isArray(question.metadata) ? question.metadata : {};
  let contract = metadata.reporting_contract ?? null;
  let contractValid = false;
  let contractError = null;
  if (contract !== null) {
    try { contract = validateReportingContract(contract); contractValid = true; }
    catch (error) { contractError = error.message; }
  }
  return { id: question.id, questionCode: question.question_code, order: question.question_order,
    text: question.question_text, contract, contractValid, contractError,
    expectedContractFingerprint: reportingContractFingerprint(question) };
}

async function questionnaireHeader(client, questionnaireId, lock = false) {
  const result = await client.query(`
    SELECT id, questionnaire_code, questionnaire_name, version_number, status
    FROM questionnaires WHERE id = $1::uuid ${lock ? "FOR UPDATE" : ""}
  `, [questionnaireId]);
  if (result.rows.length !== 1) throw failure("Questionnaire was not found", "QUESTIONNAIRE_NOT_FOUND", 404);
  return result.rows[0];
}

async function usageCount(client, questionnaireId) {
  const result = await client.query(`
    SELECT COUNT(*)::int AS used_by_iterations
    FROM program_iterations WHERE questionnaire_id = $1::uuid
  `, [questionnaireId]);
  const count = Number(result.rows[0]?.used_by_iterations);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Questionnaire usage could not be determined");
  return count;
}

function lockReason(header, usedByIterations) {
  if (usedByIterations > 0) return "This questionnaire has already been selected by an Iteration. Create a new questionnaire version instead of changing its measurement contract.";
  if (["ARCHIVED", "RETIRED", "INACTIVE"].includes(String(header.status || "").toUpperCase())) {
    return "This questionnaire is not available for authoring. Use a new active questionnaire version.";
  }
  return null;
}

export async function listQuestionnaireReportingCoverage(db, actor, questionnaireId) {
  authorize(actor);
  identifier(questionnaireId, "Questionnaire");
  const client = await db.connect();
  try {
    // A single consistent read of header, references and contracts. GET never
    // writes metadata, creates contracts or certifies a provider deployment.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const header = await questionnaireHeader(client, questionnaireId);
    const usedByIterations = await usageCount(client, questionnaireId);
    const relation = await resolveQuestionRelation(client);
    const result = await client.query(`
      SELECT to_jsonb(question) AS question FROM ${relation} question
      WHERE question.questionnaire_id = $1::uuid ORDER BY question.question_order, question.question_code
    `, [questionnaireId]);
    const reason = lockReason(header, usedByIterations);
    const response = {
      questionnaire: { id: header.id, code: header.questionnaire_code, name: header.questionnaire_name,
        version: header.version_number, status: header.status },
      locked: reason !== null, lockReason: reason, usedByIterations, metadataWritable: true,
      questions: result.rows.map((row) => questionResponse(row.question))
    };
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function declaredOutputKeys(question) {
  const metadata = question.metadata && typeof question.metadata === "object" && !Array.isArray(question.metadata) ? question.metadata : {};
  return [...(Array.isArray(question.output_variables) ? question.output_variables : []),
    ...(Array.isArray(question.outputVariables) ? question.outputVariables : []),
    ...(Array.isArray(metadata.output_variables) ? metadata.output_variables : []),
    ...(Array.isArray(metadata.outputVariables) ? metadata.outputVariables : []),
    ...(Array.isArray(metadata.reporting_contract?.outputVariables) ? metadata.reporting_contract.outputVariables : [])]
    .map((value) => typeof value === "string" ? value : value?.key || value?.name)
    .filter((key) => typeof key === "string")
    .map((key) => key.trim().toLowerCase());
}

export async function saveQuestionReportingContract(db, actor, questionnaireId, questionId, input) {
  authorize(actor);
  identifier(questionnaireId, "Questionnaire");
  identifier(questionId, "Question");
  const { expectedContractFingerprint, contract } = validateContractSave(input);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Existing Iteration creation holds FOR SHARE on this same header before
    // freezing questions. This lock serializes contract writes with selection,
    // and serializes two authoring requests before any individual row locks.
    const header = await questionnaireHeader(client, questionnaireId, true);
    const usedByIterations = await usageCount(client, questionnaireId);
    const reason = lockReason(header, usedByIterations);
    if (reason) throw failure(reason, "QUESTIONNAIRE_CONTRACT_LOCKED");
    const relation = await resolveQuestionRelation(client);
    const result = await client.query(`
      SELECT to_jsonb(question) AS question FROM ${relation} question
      WHERE question.id = $1::uuid AND question.questionnaire_id = $2::uuid FOR UPDATE
    `, [questionId, questionnaireId]);
    if (result.rows.length !== 1) throw failure("Question was not found in this questionnaire", "QUESTION_NOT_FOUND", 404);
    const question = result.rows[0].question;
    if (reportingContractFingerprint(question) !== expectedContractFingerprint) {
      throw failure("This question changed after it was loaded. Refresh before saving its reporting contract", "REPORTING_CONTRACT_CONFLICT");
    }
    if (typeof question.question_code !== "string" || !question.question_code.trim()) {
      throw failure("Record a stable question code before declaring its reporting contract", "QUESTION_CODE_REQUIRED");
    }
    const metadata = editableMetadata(question);
    // Some runtime versions give top-level output_variables precedence. Never
    // silently leave a contradictory legacy mapping beside the new contract.
    for (const mapping of [question.output_variables, question.outputVariables, metadata.outputVariables]) {
      if (mapping === null || mapping === undefined) continue;
      if (!Array.isArray(mapping) || mapping.some((key) => typeof key !== "string")
          || JSON.stringify([...mapping].sort()) !== JSON.stringify([...contract.outputVariables].sort())) {
        throw failure("An existing legacy output mapping differs. Align the new questionnaire's output definition before declaring this contract", "QUESTION_OUTPUT_MAPPING_CONFLICT");
      }
    }
    const siblings = await client.query(`
      SELECT to_jsonb(question) AS question FROM ${relation} question
      WHERE question.questionnaire_id = $1::uuid AND question.id <> $2::uuid
      ORDER BY question.question_order, question.question_code FOR SHARE
    `, [questionnaireId, questionId]);
    const otherKeys = new Set(siblings.rows.flatMap((row) => declaredOutputKeys(row.question)));
    if (contract.outputVariables.some((key) => otherKeys.has(key))) {
      throw failure("An output variable is already mapped to another question in this questionnaire; use an unambiguous output key", "DUPLICATE_QUESTION_OUTPUT");
    }
    const updatedMetadata = { ...metadata, reporting_contract: contract, output_variables: contract.outputVariables };
    const updated = await client.query(`
      UPDATE ${relation} question SET metadata = $3::jsonb
      WHERE question.id = $1::uuid AND question.questionnaire_id = $2::uuid
      RETURNING to_jsonb(question) AS question
    `, [questionId, questionnaireId, JSON.stringify(updatedMetadata)]);
    if (updated.rows.length !== 1) throw new Error("The question contract update did not return its stored question");
    await client.query("COMMIT");
    return { question: questionResponse(updated.rows[0].question) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
