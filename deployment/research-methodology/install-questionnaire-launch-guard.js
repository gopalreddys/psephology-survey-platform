import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { installQuestionnaireSnapshot } from "./install-questionnaire-snapshot.js";
import { patchQuestionnaireLaunchGuard } from "./questionnaire-launch-guard.patch.js";

export async function installQuestionnaireLaunchGuard(runtimeRoot) {
  const target = path.join(runtimeRoot, "src/services/run-launch.service.js");
  // Validate the required service before copying any dependency or changing a
  // service. A missing/unknown launch entrypoint cannot silently skip safety.
  const source = await readFile(target, "utf8");
  const prepared = patchQuestionnaireLaunchGuard(source);
  await installQuestionnaireSnapshot(runtimeRoot);
  if (!prepared.changed) return { changed: false, path: target };
  const backup = `${target}.bak-questionnaire-launch-guard-${Date.now()}`;
  await copyFile(target, backup);
  await writeFile(target, prepared.source);
  return { changed: true, path: target, backup };
}
