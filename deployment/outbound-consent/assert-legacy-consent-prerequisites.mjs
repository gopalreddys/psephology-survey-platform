import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchOutboundClient } from './patch-outbound-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const required = [
  ['outbound-consent.repository.js', 'src/repositories/outbound-consent.repository.js'],
  ['035_outbound_contact_suppression.sql', 'sql/035_outbound_contact_suppression.sql']
];

async function regularFile(root, relative) {
  const file = join(root, relative);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== file) {
    throw new Error('Consent prerequisite is not a regular runtime file');
  }
  return readFile(file);
}

/** Read-only compatibility gate, called before any legacy installer write.
 * Artifact presence is not proof that migration 035 ran. The operator must
 * execute and verify it through the coordinated release; no DB is contacted.
 */
export async function assertLegacyConsentPrerequisites(runtimeRoot) {
  try {
    const root = await realpath(resolve(runtimeRoot));
    for (const [source, relative] of required) {
      const [expected, installed] = await Promise.all([
        readFile(join(here, source)), regularFile(root, relative)
      ]);
      if (!installed.equals(expected)) throw new Error('Consent prerequisite version differs');
    }
    const client = (await regularFile(root, 'src/clients/sarvam.js')).toString('utf8');
    if (patchOutboundClient(client) !== client) throw new Error('Consent boundary is not installed');
    return { verified: true, databaseMigrationVerified: false };
  } catch (cause) {
    const error = new Error('Use the coordinated outbound-consent installer and 035 migration before this legacy feature installer. Consent prerequisites are absent, changed or unverified; no files were changed.', { cause });
    error.code = 'OUTBOUND_CONSENT_PREREQUISITES_REQUIRED';
    throw error;
  }
}
