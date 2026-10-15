import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRelease } from '../platform-consolidation/install-platform-consolidation.mjs';

const manifest = JSON.parse(await readFile(new URL('./reporting-completion-release.json', import.meta.url), 'utf8'));

export function installReportingCompletion(options) {
  return installRelease({ ...options, manifest });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const runtimeRoot = args[0] && !args[0].startsWith('--') ? args.shift() : '/opt/sarvam-voice-analytics';
    if (new Set(args).size !== args.length || args.some((arg) => !['--dry-run', '--apply', '--ack-api-stopped'].includes(arg))
        || (args.includes('--dry-run') && args.includes('--apply'))) {
      throw new Error('Usage: node install-reporting-completion.mjs [runtime-root] [--dry-run | --apply --ack-api-stopped]');
    }
    console.log(JSON.stringify(await installReportingCompletion({ runtimeRoot,
      apply: args.includes('--apply'), ackApiStopped: args.includes('--ack-api-stopped') }), null, 2));
    console.log('No SQL, provider update, Quick publication or service restart performed. Complete the reviewed function-sync and frontend release steps separately.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Reporting completion installation failed');
    process.exitCode = 1;
  }
}
