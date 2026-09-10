import fs from "node:fs";
import path from "node:path";

const servicePath = path.resolve(process.argv[2] || "src/services/sarvam-execution.service.js");
let source = fs.readFileSync(servicePath, "utf8");

if (!source.includes("getSarvamVoiceAgentForRunContact")) {
  const dbImport = /import\s*\{\s*getDb\s*\}\s*from\s*["']\.\.\/db\/postgres\.js["'];/m;
  if (!dbImport.test(source)) throw new Error("Could not find getDb import in Sarvam execution service");
  source = source.replace(dbImport, (match) => `${match}\n\nimport { getSarvamVoiceAgentForRunContact } from "../repositories/voice-agents.repository.js";`);
}

if (!source.includes("const voiceAgent =")) {
  const preparedBlock = /const prepared\s*=\s*await prepareSarvamExecution\(\{\s*runContactId,\s*attemptCycleId\s*\}\s*\);/m;
  if (!preparedBlock.test(source)) throw new Error("Could not find prepared Sarvam execution block");
  source = source.replace(preparedBlock, (match) => `${match}\n\n  const voiceAgent = await getSarvamVoiceAgentForRunContact(prepared.runContactId);\n  prepared.providerDeployment = voiceAgent;`);
}

const literalBlock = /appId:\s*["']Conversatio-040de042-626d["'],\s*appVersion:\s*9,\s*connectionId:\s*["']ee3407f4-85-8805a44f-a822["'],\s*agentPhoneNumber:\s*["']\+918065356536["'],/m;
if (literalBlock.test(source)) {
  source = source.replace(literalBlock, `appId:\n          voiceAgent.app_id,\n\n        appVersion:\n          Number(voiceAgent.app_version),\n\n        connectionId:\n          voiceAgent.connection_id,\n\n        agentPhoneNumber:\n          voiceAgent.outbound_phone_number,`);
} else if (!source.includes("voiceAgent.app_id")) {
  throw new Error("Could not find the expected hardcoded Sarvam deployment block");
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${servicePath}.bak-voice-agent-selection-${timestamp}`;
fs.copyFileSync(servicePath, backupPath);
fs.writeFileSync(servicePath, source);
console.log(`Enabled iteration voice-agent selection in ${servicePath}`);
console.log(`Backup written to ${backupPath}`);
