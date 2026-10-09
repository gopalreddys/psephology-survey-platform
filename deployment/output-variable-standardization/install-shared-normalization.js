import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function installOutputNormalization(runtimeRoot) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const destination = path.join(runtimeRoot, "src/repositories");
  await mkdir(destination, { recursive: true });
  for (const name of ["output-normalization.repository.js", "normalization-rules.json"]) {
    await copyFile(path.join(here, name), path.join(destination, name));
  }
}
