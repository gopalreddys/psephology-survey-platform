import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const apiRoot = resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const iterationId = "5410403e-d257-4389-8c47-fba6ac31c666";
const questionnaireId = "eb55fbc2-54db-4609-80d4-7cf7118bb15d";
const appId = "Political-A-b26ad56c-c4ae";

const expected = JSON.parse(readFileSync(new URL("./campaign-mlc-pulse-v1.json", import.meta.url), "utf8"));
const { getDb } = await import(pathToFileURL(resolve(apiRoot, "src/db/postgres.js")).href);
const { compileCallContext } = await import(
  pathToFileURL(resolve(apiRoot, "src/services/call-context-compiler.service.js")).href
);
const executionSource = readFileSync(resolve(apiRoot, "src/services/sarvam-execution.service.js"), "utf8");
if (!/questionnaire_context\s*:\s*compiledContext\s*\.questionnaire_context/s.test(executionSource) ||
    !/agentVariables\s*:\s*prepared\.inputVariables/s.test(executionSource)) {
  throw new Error("Sarvam execution service does not show the expected compiled-context handoff");
}

const db = await getDb();
try {
  const result = await db.query(`
    SELECT contact.id AS run_contact_id, run.id AS run_id, run.run_number,
      iteration.questionnaire_id, iteration.questionnaire_snapshot,
      iteration.voice_agent_snapshot
    FROM campaign_run_contacts contact
    JOIN campaign_runs run ON run.id = contact.run_id
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    WHERE iteration.id = $1::uuid
    ORDER BY run.run_number, contact.id
    LIMIT 1
  `, [iterationId]);

  if (!result.rowCount) {
    console.log("No Run contact exists yet. Create Run 1 without launching calls, then rerun this read-only preflight.");
    process.exitCode = 2;
  } else {
    const row = result.rows[0];
    if (row.questionnaire_id !== questionnaireId ||
        row.questionnaire_snapshot?.code !== expected.questionnaireCode ||
        row.voice_agent_snapshot?.app_id !== appId ||
        Number(row.voice_agent_snapshot?.app_version) !== 1) {
      throw new Error("Run does not inherit the expected questionnaire and Sarvam App v1 snapshot");
    }

    const context = await compileCallContext({ runContactId: row.run_contact_id });
    const questionnaireContext = String(context?.questionnaire_context || "");
    const matched = expected.questions.map((question) => ({
      order: question.questionOrder,
      code: question.questionCode,
      present: questionnaireContext.includes(question.questionText) ||
        questionnaireContext.includes(question.questionTextTelugu) ||
        questionnaireContext.includes(question.questionCode)
    }));
    console.table(matched);
    console.log({
      runId: row.run_id,
      runNumber: row.run_number,
      questionnaireCode: expected.questionnaireCode,
      agentAppId: appId,
      agentAppVersion: 1,
      compiledQuestionnaireContextBytes: Buffer.byteLength(questionnaireContext, "utf8"),
      exactQuestionMatches: matched.filter((question) => question.present).length,
      sarvamExecutionHandoffFound: true,
      providerSubmissionPerformed: false
    });
    if (matched.some((question) => !question.present)) {
      throw new Error("The compiled context does not contain all ten approved question texts or codes");
    }
  }
} finally {
  await db.end();
}
