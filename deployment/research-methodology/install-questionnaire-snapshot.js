import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export async function installQuestionnaireSnapshot(runtimeRoot) {
  await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
  const source = path.join(packageRoot, "questionnaire-snapshot.repository.js");
  const target = path.join(runtimeRoot, "src/repositories/questionnaire-snapshot.repository.js");
  let existing;
  try { existing = await readFile(target); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing?.equals(await readFile(source))) return;
  if (existing) await copyFile(target, `${target}.bak-questionnaire-content-${Date.now()}`);
  await copyFile(source, target);
}
