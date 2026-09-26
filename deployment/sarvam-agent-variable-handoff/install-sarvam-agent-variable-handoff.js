import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  hasCorrectAgentVariableHandoff,
  patchAgentVariableHandoff
} from "./sarvam-agent-variable-handoff.patch.js";
import {
  hasCompactRuntimeContext,
  patchRuntimeContext
} from "./sarvam-runtime-context.patch.js";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const clientPath = path.join(runtimeRoot, "src/clients/sarvam.js");
const runtimeRoutePath = path.join(
  runtimeRoot,
  "src/routes/sarvam-runtime.routes.js"
);
const source = await readFile(clientPath, "utf8");
const result = patchAgentVariableHandoff(source);
const runtimeSource = await readFile(runtimeRoutePath, "utf8");
const runtimeResult = patchRuntimeContext(runtimeSource);

if (result.changed) {
  const backupPath = `${clientPath}.bak-agent-variable-handoff-${Date.now()}`;
  await copyFile(clientPath, backupPath);
  await writeFile(clientPath, result.source);
  console.log(`Previous Sarvam client: ${backupPath}`);
}

if (runtimeResult.changed) {
  const backupPath = `${runtimeRoutePath}.bak-compact-runtime-${Date.now()}`;
  await copyFile(runtimeRoutePath, backupPath);
  await writeFile(runtimeRoutePath, runtimeResult.source);
  console.log(`Previous Sarvam runtime route: ${backupPath}`);
}

if (!hasCorrectAgentVariableHandoff(result.source)) {
  throw new Error("Sarvam agent-variable handoff verification failed");
}

if (!hasCompactRuntimeContext(runtimeResult.source)) {
  throw new Error("Sarvam compact runtime-context verification failed");
}

console.log(
  result.changed
    ? `Corrected Sarvam agent-variable handoff in ${clientPath}`
    : `Sarvam agent-variable handoff is already correct in ${clientPath}`
);
console.log(
  runtimeResult.changed
    ? `Compacted Sarvam runtime-context response in ${runtimeRoutePath}`
    : `Sarvam runtime-context response is already compact in ${runtimeRoutePath}`
);
