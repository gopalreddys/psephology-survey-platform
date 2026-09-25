import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "../campaign-workspace");
const files = [
  {
    name: "campaign-iterations.repository.js",
    source: path.join(workspaceRoot, "campaign-iterations.repository.js"),
    target: path.join(runtimeRoot, "src/repositories/campaign-iterations.repository.js"),
    previousHash: "1b62e2638067b4bb73f9933ae55f052907a6b6a2cc0c636e6b0748968b99fbd4"
  },
  {
    name: "campaign-iterations.routes.js",
    source: path.join(workspaceRoot, "campaign-iterations.routes.js"),
    target: path.join(runtimeRoot, "src/routes/campaign-iterations.routes.js"),
    previousHash: "d366fb5993aa5712a3cd6284bf91e306d2f7401aac6161ebfab21c9ceb894d26"
  },
  {
    name: "iteration-agent-version.policy.js",
    source: path.join(workspaceRoot, "iteration-agent-version.policy.js"),
    target: path.join(runtimeRoot, "src/repositories/iteration-agent-version.policy.js"),
    previousHash: null
  }
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checked = [];
for (const file of files) {
  const incoming = await readFile(file.source);
  let existing = null;
  try { existing = await readFile(file.target); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const currentHash = existing ? hash(existing) : null;
  const incomingHash = hash(incoming);
  if (currentHash && currentHash !== file.previousHash && currentHash !== incomingHash) {
    throw new Error(`${file.target} differs from the known platform version. Review its changes before installing; nothing was overwritten.`);
  }
  checked.push({ ...file, existing, currentHash, incomingHash });
}

const suffix = new Date().toISOString().replaceAll(":", "-");
for (const file of checked) {
  if (file.currentHash === file.incomingHash) continue;
  await mkdir(path.dirname(file.target), { recursive: true });
  if (file.existing) await copyFile(file.target, `${file.target}.bak-iteration-agent-version-${suffix}`);
  await copyFile(file.source, file.target);
  console.log(`Installed ${file.name}`);
}
console.log("Campaign Manager Iteration agent-version control installed. Restart the API after syntax checks.");
