import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || '/opt/sarvam-voice-analytics');
const deployment = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'src/server.js');
const server = await readFile(serverPath, 'utf8');
if (!/import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/.test(server) ||
    !/import\s+campaignsRoutes[\s\S]*?from\s+["']\.\/routes\/campaigns\.routes\.js["'];/.test(server) ||
    !/app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/.test(server) ||
    !/app\.use\(\s*["']\/api["']\s*,\s*campaignsRoutes\s*\);/.test(server)) {
  throw new Error('Expected existing Psephology API route anchors; no files were installed.');
}
const installers = [
  'amazon-quick-enterprise-dashboard/install-amazon-quick-dashboard.js',
  'campaign-comparative-analysis/install-campaign-analysis.js',
  'analytics-workspace/install-analytics-workspace.js',
  'program-executive-dashboard/install-program-dashboard.js',
  'role-dashboard/install-role-dashboard.js'
];
for (const installer of installers) {
  if (!existsSync(path.join(deployment, installer))) throw new Error(`Missing installer ${installer}`);
}
const backups = [
  'src/server.js', 'src/repositories/research-comparability.repository.js',
  'src/repositories/campaign-analysis.repository.js',
  'src/repositories/analytics-workspace.repository.js',
  'src/repositories/program-dashboard.repository.js',
  'src/repositories/dashboard.repository.js',
  'src/routes/amazon-quick-dashboard.routes.js', 'src/db/migrate-amazon-quick-dashboard.js'
];
const backupRoot = path.join(root, 'var/deployment-backups', `research-comparability-${Date.now()}`);
for (const relative of backups) {
  const source = path.join(root, relative);
  if (!existsSync(source)) continue;
  const destination = path.join(backupRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
for (const installer of installers) execFileSync(process.execPath,
  [path.join(deployment, installer), root], { stdio: 'inherit' });
console.log(`Research comparison consistency installed. Backup: ${backupRoot}`);
console.log('Run node src/db/migrate-amazon-quick-dashboard.js from the API directory before restarting it.');
console.log('This installer does not run migrations, restart services, change research declarations or update Amazon Quick assets.');
