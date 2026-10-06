import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hasCorrectAgentVariableHandoff,
  patchAgentVariableHandoff
} from "../sarvam-agent-variable-handoff/sarvam-agent-variable-handoff.patch.js";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

await copy(
  "027_voter_demo_call_outcomes.sql",
  path.join(runtimeRoot, "sql/027_voter_demo_call_outcomes.sql")
);
await copy(
  "migrate-voter-demo-call-outcomes.js",
  path.join(runtimeRoot, "src/db/migrate-voter-demo-call-outcomes.js")
);
await copy(
  "voter-demo-call-context.js",
  path.join(runtimeRoot, "src/services/voter-demo-call-context.js")
);
await copy(
  "voter-demo-call.service.js",
  path.join(runtimeRoot, "src/services/voter-demo-call.service.js")
);
await copy(
  "voter-demo-calls.repository.js",
  path.join(runtimeRoot, "src/repositories/voter-demo-calls.repository.js")
);
await copyFile(
  path.resolve(
    packageRoot,
    "../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js"
  ),
  path.join(runtimeRoot, "src/repositories/sarvam-outbound-webhook.repository.js")
);

const clientPath = path.join(runtimeRoot, "src/clients/sarvam.js");
const clientSource = await readFile(clientPath, "utf8");
const clientResult = patchAgentVariableHandoff(clientSource);

if (clientResult.changed) {
  const backupPath = `${clientPath}.bak-demo-runtime-context-${Date.now()}`;
  await copyFile(clientPath, backupPath);
  await writeFile(clientPath, clientResult.source);
  console.log(`Previous Sarvam client: ${backupPath}`);
}

if (!hasCorrectAgentVariableHandoff(clientResult.source)) {
  throw new Error("Standalone demo-call Sarvam handoff verification failed");
}

console.log(`Installed governed Voter Demo Call outcomes in ${runtimeRoot}`);
console.log("Run node src/db/migrate-voter-demo-call-outcomes.js before restarting the API.");
