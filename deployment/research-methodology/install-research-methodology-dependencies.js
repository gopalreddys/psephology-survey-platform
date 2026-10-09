import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function installResearchMethodologyDependencies(runtimeRoot) {
  const copies = [
    ['research-methodology.repository.js', 'research-methodology.repository.js'],
    ['research-methodology-validation.js', 'research-methodology-validation.js'],
    ['../campaign-draft-privacy/campaign-visibility.repository.js', 'campaign-visibility.repository.js']
  ];
  await mkdir(path.join(runtimeRoot, 'src/repositories'), { recursive: true });
  for (const [source, name] of copies) {
    const destination = path.join(runtimeRoot, 'src/repositories', name);
    const contents = await readFile(path.join(here, source));
    let existing;
    try { existing = await readFile(destination); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing?.equals(contents)) continue;
    if (existing) await copyFile(destination, `${destination}.bak-methodology-${Date.now()}`);
    await copyFile(path.join(here, source), destination);
  }
}
