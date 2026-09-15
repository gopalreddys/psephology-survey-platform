import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "../campaign-workspace");
const backupSuffix = new Date().toISOString().replaceAll(":", "-");
const expectedRuntimeHashes = new Map([
  ["campaign-iterations.repository.js", "e7d7c6795802b19f9fabd3cd0823a28adc39ff1b92860c3d45016ed40fbb4cb2"],
  ["campaign-iterations.routes.js", "c13802677e3c397d9c624538878178d21eeac76d7fc9613b6ca9009de374106e"]
]);

for (const [name, expectedHash] of expectedRuntimeHashes) {
  const target = path.join(runtimeRoot, name.endsWith("repository.js") ? "src/repositories" : "src/routes", name);
  const source = path.join(workspaceRoot, name);
  const existing = await readFile(target);
  const currentHash = createHash("sha256").update(existing).digest("hex");
  const incomingHash = createHash("sha256").update(await readFile(source)).digest("hex");
  if (currentHash !== expectedHash && currentHash !== incomingHash) {
    throw new Error(`${target} differs from the known platform version. Review and merge its existing changes before installing; nothing was overwritten.`);
  }
}

for (const [source, target] of [
  [path.join(packageRoot, "022_iteration_questionnaire_snapshot.sql"), path.join(runtimeRoot, "sql/022_iteration_questionnaire_snapshot.sql")],
  [path.join(packageRoot, "migrate-iteration-questionnaire-snapshot.js"), path.join(runtimeRoot, "src/db/migrate-iteration-questionnaire-snapshot.js")],
  [path.join(workspaceRoot, "campaign-iterations.repository.js"), path.join(runtimeRoot, "src/repositories/campaign-iterations.repository.js")],
  [path.join(workspaceRoot, "campaign-iterations.routes.js"), path.join(runtimeRoot, "src/routes/campaign-iterations.routes.js")]
]) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await stat(target);
    await copyFile(target, `${target}.bak-questionnaire-provenance-${backupSuffix}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(source, target);
}

console.log(`Installed future Iteration questionnaire provenance in ${runtimeRoot}`);
console.log("Run node src/db/migrate-iteration-questionnaire-snapshot.js before restarting the API.");
