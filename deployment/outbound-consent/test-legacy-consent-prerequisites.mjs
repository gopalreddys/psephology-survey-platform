import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLegacyConsentPrerequisites } from './assert-legacy-consent-prerequisites.mjs';
import { patchOutboundClient } from './patch-outbound-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'legacy-consent-prerequisites-'));
const client = 'export async function createInstantOutboundCall(options) { return options; }\n';
const legacyInstallers = [
  'sarvam-outbound-webhook/install-sarvam-outbound-webhook.js',
  'campaign-lifecycle-governance/install-campaign-lifecycle.js',
  'run-lifecycle-automation/install-run-lifecycle.js',
  'voter-demo-call/install-voter-demo-call-outcomes.js',
  'run-bulk-launch/install-run-bulk-launch.js',
  'run-retry-cohort/install-run-retry-cohort.js',
  'voter-electorate-management/install-voter-electorate-management.js',
  'iteration-closeout/install-iteration-closeout.js'
];
async function fixture(name) {
  const root = join(temporary, name);
  for (const directory of ['src/clients', 'src/repositories', 'sql']) await mkdir(join(root, directory), { recursive: true });
  return root;
}
async function contents(root, relative = '') {
  const result = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const key = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result[key] = await contents(root, key);
    else result[key] = (await readFile(join(root, key))).toString('base64');
  }
  return result;
}
const rejected = async root => assert.rejects(assertLegacyConsentPrerequisites(root), error =>
  error.code === 'OUTBOUND_CONSENT_PREREQUISITES_REQUIRED'
  && /coordinated outbound-consent installer and 035 migration/.test(error.message));

try {
  for (const installer of legacyInstallers) {
    const root = await fixture(installer.split('/')[0]);
    const before = await contents(root);
    assert.throws(() => execFileSync(process.execPath, [join(repo, 'deployment', installer), root], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000
    }), error => /coordinated outbound-consent installer and 035 migration/.test(error.stderr), `${installer}: guard must precede all legacy writes`);
    assert.deepEqual(await contents(root), before, `${installer}: a missing consent prerequisite must not leave partial feature files`);
  }
  const root = await fixture('good');
  await rejected(root);
  const helperPath = join(root, 'src/repositories/outbound-consent.repository.js');
  const sqlPath = join(root, 'sql/035_outbound_contact_suppression.sql');
  const clientPath = join(root, 'src/clients/sarvam.js');
  const helper = await readFile(join(here, 'outbound-consent.repository.js'));
  const sql = await readFile(join(here, '035_outbound_contact_suppression.sql'));
  await writeFile(helperPath, helper);
  await rejected(root);
  await writeFile(sqlPath, sql);
  await writeFile(clientPath, client);
  await rejected(root);
  const patched = patchOutboundClient(client);
  await writeFile(clientPath, patched);
  const before = await contents(root);
  assert.deepEqual(await assertLegacyConsentPrerequisites(root), { verified: true, databaseMigrationVerified: false });
  assert.deepEqual(await contents(root), before, 'A valid installed boundary passes without touching artifacts or contacting a database');
  await writeFile(helperPath, Buffer.concat([helper, Buffer.from('\n// unreviewed helper edit')]));
  await rejected(root);
  await writeFile(helperPath, helper);
  await writeFile(sqlPath, Buffer.concat([sql, Buffer.from('\n-- unreviewed migration edit')]));
  await rejected(root);
  await writeFile(sqlPath, sql);
  await writeFile(clientPath, patched.replace('async function createInstantOutboundCallUnchecked(', 'export async function createInstantOutboundCallUnchecked('));
  await rejected(root);
  console.log('Legacy consent compatibility passed: eight entrypoints fail before writes; exact helper/migration and guarded client required; valid artifact checks are read-only and do not certify DB migration.');
} finally { await rm(temporary, { recursive: true, force: true }); }
