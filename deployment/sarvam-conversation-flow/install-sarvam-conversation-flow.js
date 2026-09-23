import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  hasConciseAcknowledgementPolicy,
  patchConversationFlow
} from "./conversation-flow.patch.js";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const servicePath = path.join(runtimeRoot, "src/services/sarvam-execution.service.js");
const source = await readFile(servicePath, "utf8");
const result = patchConversationFlow(source);

if (result.changed) {
  const backup = `${servicePath}.bak-concise-acknowledgement-${Date.now()}`;
  await copyFile(servicePath, backup);
  await writeFile(servicePath, result.source);
  console.log(`Installed concise Sarvam acknowledgement policy in ${servicePath}`);
  console.log(`Backup written to ${backup}`);
} else {
  console.log("Concise Sarvam acknowledgement policy is already installed.");
}

if (!hasConciseAcknowledgementPolicy(await readFile(servicePath, "utf8"))) {
  throw new Error("Installed conversation-flow policy could not be verified");
}
