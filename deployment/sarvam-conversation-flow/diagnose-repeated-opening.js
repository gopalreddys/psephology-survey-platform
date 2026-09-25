import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const runId = process.argv.find((value) => value.startsWith("--run-id="))?.split("=")[1];

if (!runId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) {
  throw new Error("Usage: node diagnose-repeated-opening.js /opt/sarvam-voice-analytics --run-id=RUN_UUID");
}

function transcriptTurns(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function turnText(turn) {
  return String(turn?.indic_text || turn?.en_text || turn?.text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function openingMetrics(transcript) {
  const agentTurns = transcriptTurns(transcript)
    .filter((turn) => String(turn?.role || "").toLowerCase() === "agent")
    .map(turnText)
    .filter(Boolean);
  const first = agentTurns[0] || "";
  const firstTokens = new Set(first.split(" ").filter(Boolean));
  const similarity = (text) => {
    if (!firstTokens.size) return 0;
    const tokens = new Set(text.split(" ").filter(Boolean));
    const shared = Array.from(firstTokens).filter((token) => tokens.has(token)).length;
    return (2 * shared) / (firstTokens.size + tokens.size || 1);
  };
  const repeatedOpeningTurns = first
    ? agentTurns.filter((text) => similarity(text) >= 0.78).length
    : 0;
  return {
    agentTurns: agentTurns.length,
    repeatedOpeningTurns,
    openingSignature: first
      ? crypto.createHash("sha256").update(first).digest("hex").slice(0, 12)
      : null
  };
}

const { getDb } = await import(
  pathToFileURL(path.join(runtimeRoot, "src/db/postgres.js")).href
);
const db = await getDb();

try {
  const result = await db.query(`
    SELECT contact.id AS run_contact_id,
      execution.id AS execution_id,
      execution.provider_attempt_id,
      call_record.interaction_id,
      call_record.interaction_transcript
    FROM campaign_run_contacts contact
    LEFT JOIN call_executions execution
      ON execution.run_contact_id = contact.id
    LEFT JOIN calls call_record
      ON call_record.attempt_id = execution.provider_attempt_id
    WHERE contact.run_id = $1::uuid
    ORDER BY contact.id, execution.created_at, call_record.created_at
  `, [runId]);

  if (!result.rowCount) throw new Error("Run has no selected contacts");

  const contacts = new Map();
  for (const row of result.rows) {
    const item = contacts.get(row.run_contact_id) || {
      runContact: row.run_contact_id,
      executions: new Set(),
      providerAttempts: new Set(),
      interactions: new Set(),
      calls: []
    };
    if (row.execution_id) item.executions.add(row.execution_id);
    if (row.provider_attempt_id) item.providerAttempts.add(row.provider_attempt_id);
    if (row.interaction_id) item.interactions.add(row.interaction_id);
    if (row.interaction_id || row.interaction_transcript) {
      item.calls.push(openingMetrics(row.interaction_transcript));
    }
    contacts.set(row.run_contact_id, item);
  }

  const report = Array.from(contacts.values()).map((item) => ({
    runContact: item.runContact,
    executions: item.executions.size,
    providerAttempts: item.providerAttempts.size,
    interactions: item.interactions.size,
    agentTurns: item.calls.reduce((total, call) => total + call.agentTurns, 0),
    repeatedOpeningTurns: Math.max(0, ...item.calls.map((call) => call.repeatedOpeningTurns)),
    openingSignatures: Array.from(new Set(item.calls.map((call) => call.openingSignature).filter(Boolean))).join(",")
  }));
  console.table(report);
  console.log({
    runId,
    contacts: report.length,
    contactsWithDuplicateProviderStarts: report.filter((item) => item.providerAttempts > 1 || item.interactions > 1).length,
    contactsWithRepeatedOpeningInsideOneInteraction: report.filter((item) => item.interactions === 1 && item.repeatedOpeningTurns > 1).length,
    transcriptTextPrinted: false,
    providerSubmissionPerformed: false
  });
} finally {
  await db.end();
}
