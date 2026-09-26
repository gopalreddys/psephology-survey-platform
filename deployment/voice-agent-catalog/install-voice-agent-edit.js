import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const files = [
  {
    name: "voice-agents.repository.js",
    subdirectory: "src/repositories",
    previousHashes: [
      "ee120497faeb81bf4fbcd904eea8c1799231e23bb47507807e1a1acb9a63de1e",
      "1ee8ac7ad890ae3c41d651de54349eaa048eab1504517dea427d876fb0b5f82d"
    ]
  },
  {
    name: "voice-agents.routes.js",
    subdirectory: "src/routes",
    previousHashes: [
      "5abbd697d4faa854bd0b3b6a0c0fbeae88fc27b04cd6562d4126b4a2ad9bc3ad"
    ]
  }
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checks = await Promise.all(files.map(async (file) => {
  const source = path.join(packageRoot, file.name);
  const target = path.join(runtimeRoot, file.subdirectory, file.name);
  const [incoming, existing] = await Promise.all([readFile(source), readFile(target)]);
  const currentHash = hash(existing);
  const incomingHash = hash(incoming);
  if (!file.previousHashes.includes(currentHash) && currentHash !== incomingHash) {
    throw new Error(`${target} differs from the known platform version. Review its changes before installing; nothing was overwritten.`);
  }
  return { target, source, unchanged: currentHash === incomingHash };
}));

const suffix = new Date().toISOString().replaceAll(":", "-");
for (const file of checks) {
  if (file.unchanged) continue;
  const backup = `${file.target}.bak-voice-agent-edit-${suffix}`;
  await copyFile(file.target, backup);
  await copyFile(file.source, file.target);
  console.log(`Updated ${file.target}; backup: ${backup}`);
}
console.log("Voice-agent editing installed. Run node --check on both files, then restart the API.");
