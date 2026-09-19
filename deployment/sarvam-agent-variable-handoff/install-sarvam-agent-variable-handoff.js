import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  hasCorrectAgentVariableHandoff,
  patchAgentVariableHandoff
} from "./sarvam-agent-variable-handoff.patch.js";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const clientPath = path.join(runtimeRoot, "src/clients/sarvam.js");
const source = await readFile(clientPath, "utf8");
const result = patchAgentVariableHandoff(source);

if (result.changed) {
  const backupPath = `${clientPath}.bak-agent-variable-handoff-${Date.now()}`;
  await copyFile(clientPath, backupPath);
  await writeFile(clientPath, result.source);
  console.log(`Previous Sarvam client: ${backupPath}`);
}

if (!hasCorrectAgentVariableHandoff(result.source)) {
  throw new Error("Sarvam agent-variable handoff verification failed");
}

console.log(
  result.changed
    ? `Corrected Sarvam agent-variable handoff in ${clientPath}`
    : `Sarvam agent-variable handoff is already correct in ${clientPath}`
);
