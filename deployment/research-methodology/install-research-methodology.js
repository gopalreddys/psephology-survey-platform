import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installQuestionnaireLaunchGuard } from './install-questionnaire-launch-guard.js';

const root = path.resolve(process.argv[2] || '/opt/sarvam-voice-analytics');
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await readFile(path.join(root, 'src/server.js'), 'utf8');
if (!/import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/.test(server)
  || !/import\s+campaignsRoutes[\s\S]*?from\s+["']\.\/routes\/campaigns\.routes\.js["'];/.test(server)
  || !/app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/.test(server)
  || !/app\.use\(\s*["']\/api["']\s*,\s*campaignsRoutes\s*\);/.test(server)) {
  throw new Error('Expected existing API route anchors; no methodology files were installed');
}
const creationPath = path.join(root, 'src/repositories/campaign-iterations.repository.js');
const existing = await readFile(creationPath);
// The launch installer validates its required service anchors before writing.
await installQuestionnaireLaunchGuard(root);
execFileSync(process.execPath, [path.join(here, '../research-comparability/install-research-comparability.js'), root], { stdio: 'inherit' });
const source = path.join(here, '../campaign-workspace/campaign-iterations.repository.js');
if (!existing.equals(await readFile(source))) {
  await copyFile(creationPath, `${creationPath}.bak-methodology-${Date.now()}`);
  await copyFile(source, creationPath);
}
console.log(`Audited methodology and future questionnaire provenance installed in ${root}`);
console.log('Run node src/db/migrate-amazon-quick-dashboard.js before restarting the API.');
console.log('No methods or historical question content were backfilled. No services restarted, calls submitted or Amazon Quick assets republished.');
