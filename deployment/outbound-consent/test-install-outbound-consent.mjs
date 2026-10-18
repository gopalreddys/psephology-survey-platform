import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, chmod, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOutboundConsent, runtimeFiles, dependencies } from './install-outbound-consent.mjs';
import { patchOutboundClient } from './patch-outbound-client.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const temporary=await mkdtemp(join(tmpdir(),'outbound-consent-install-'));
const clientSource=`// createInstantOutboundCall mentioned in a comment must not confuse the parser.
export async function createInstantOutboundCall(options) {
  return { exactPayload:options, providerInvoked:true };
}
export const untouchedConfiguration = "preserved";
`;
// Reviewed pre-release source, not the moving HEAD after this fix is committed.
// A shallow test checkout must fetch this baseline object first.
const baselineCommit='0d33ad4d2c8eefa95140993877f5147a9237a512';
const shaSource=(source)=>execFileSync('git',['show',baselineCommit+':'+source],{cwd:root});
async function fixture(name){
  const runtime=join(temporary,name);
  for(const directory of ['src/clients','src/repositories','src/services','src/db','sql'])await mkdir(join(runtime,directory),{recursive:true});
  await writeFile(join(runtime,'package.json'),'{"type":"module"}');
  for(const [source,target,baseline]of runtimeFiles){if(!baseline)continue;
    await writeFile(join(runtime,target),shaSource(relative(root,resolve(root,'deployment/outbound-consent',source))));
    await chmod(join(runtime,target),0o640);
  }
  for(const [target]of dependencies){const source=target.includes('output-normalization')
    ?'deployment/output-variable-standardization/output-normalization.repository.js':'deployment/interview-completion/interview-completion.repository.js';
    await writeFile(join(runtime,target),shaSource(source));}
  await writeFile(join(runtime,'src/clients/sarvam.js'),clientSource);
  return runtime;
}
async function contents(runtime){
  const result={};
  for(const [,target]of runtimeFiles){try{result[target]=(await readFile(join(runtime,target))).toString('base64');}catch(error){if(error.code!=='ENOENT')throw error;result[target]=null;}}
  result.client=(await readFile(join(runtime,'src/clients/sarvam.js'))).toString('base64');return result;
}
try{
  const runtime=await fixture('good'); const before=await contents(runtime);
  const dry=await installOutboundConsent(runtime);
  assert.equal(dry.dryRun,true);assert.equal(dry.changed.length,14);
  assert.deepEqual(await contents(runtime),before);
  assert.equal((await readdir(runtime)).includes('var'),false,'Dry run creates no backups or files');
  await assert.rejects(installOutboundConsent(runtime,{dryRun:false}),/apiStopped/);
  const applied=await installOutboundConsent(runtime,{dryRun:false,apiStopped:true});
  assert.equal(applied.apiRestartPerformed,false);assert.equal(applied.sqlNormalizerSyncPerformed,false);
  assert.equal((await stat(applied.backupRoot)).mode&0o777,0o700);
  assert.equal((await stat(join(applied.backupRoot,'src/repositories/call-completion-policy.js'))).mode&0o777,0o600);
  assert.equal((await stat(join(runtime,'src/repositories/call-completion-policy.js'))).mode&0o777,0o640);
  assert.equal((await installOutboundConsent(runtime,{dryRun:false,apiStopped:true})).changed.length,0);
  const patched=await readFile(join(runtime,'src/clients/sarvam.js'),'utf8');
  assert.equal(patchOutboundClient(patched),patched);
  assert.ok(patched.includes('return { exactPayload:options, providerInvoked:true };'),'Original payload function unchanged');
  const modeRuntime = await fixture('mode-preservation');
  const modePolicy = join(modeRuntime, 'src/repositories/call-completion-policy.js');
  await chmod(modePolicy, 0o664);
  const modeBefore = await stat(modePolicy);
  const previousUmask = process.umask(0o022);
  try {
    await installOutboundConsent(modeRuntime, { dryRun: false, apiStopped: true });
  } finally { process.umask(previousUmask); }
  const modeAfter = await stat(modePolicy);
  assert.equal(modeAfter.mode & 0o777, 0o664, 'Promotion preserves group-write mode even when the process umask would strip it');
  assert.equal(modeAfter.uid, modeBefore.uid);
  assert.equal(modeAfter.gid, modeBefore.gid);
  for(const bad of [
    '/* export async function createInstantOutboundCall(options) {} */',
    'export function createInstantOutboundCall(options) {}',
    'export async function createInstantOutboundCall(phone, variables) { return [phone, variables]; }',
    'export async function createInstantOutboundCall(...options) { return options; }',
    'export async function createInstantOutboundCall() { return arguments[0]; }',
    clientSource+'\ncreateInstantOutboundCall({});',
    clientSource+'\nexport {createInstantOutboundCall as other};',
    '/* OUTBOUND_CONSENT_BOUNDARY_V1 */'+clientSource,
    clientSource+'\nconst createInstantOutboundCallUnchecked = true;'
  ])assert.throws(()=>patchOutboundClient(bad));
  for (const parameters of ['options', 'options = {}', '{ userPhoneNumber, agentVariables }', '{ userPhoneNumber, agentVariables } = {}']) {
    const source = `export async function createInstantOutboundCall(${parameters}) { return { providerInvoked: false }; }`;
    const result = patchOutboundClient(source);
    assert.equal(patchOutboundClient(result), result, `Known single-options signature remains idempotent: ${parameters}`);
  }
  const boundary = patchOutboundClient(clientSource);
  const beforeWrapper = '\n/* OUTBOUND_CONSENT_BOUNDARY_V1:';
  for (const source of [
    boundary.replace('async function createInstantOutboundCallUnchecked(', 'export async function createInstantOutboundCallUnchecked('),
    boundary.replace(beforeWrapper, '\nexport { createInstantOutboundCallUnchecked as uncheckedOutbound };' + beforeWrapper),
    boundary.replace(beforeWrapper, '\nconst uncheckedAlias = createInstantOutboundCallUnchecked;' + beforeWrapper),
    boundary.replace(beforeWrapper, '\ncreateInstantOutboundCallUnchecked({});' + beforeWrapper),
    boundary.replace(beforeWrapper, '\nexport { createInstantOutboundCall as launchAgain };' + beforeWrapper),
    boundary.replace(beforeWrapper, '\nconst guardAlias = withOutboundConsentGuard;' + beforeWrapper),
    boundary.replace(beforeWrapper, '\nimport { withOutboundConsentGuard as anotherGuard } from "../repositories/outbound-consent.repository.js";' + beforeWrapper),
    boundary.replace('createInstantOutboundCallUnchecked(options)', 'createInstantOutboundCallUnchecked(phone, variables)')
  ]) assert.throws(() => patchOutboundClient(source), /outbound|boundary|references|options/i, 'An existing marker cannot certify altered calling conventions or unchecked bypass exports');

  const drift=await fixture('drift');
  await writeFile(join(drift,'src/repositories/call-completion-policy.js'),'// unrelated user change');
  const driftBefore=await contents(drift);
  await assert.rejects(installOutboundConsent(drift,{dryRun:false,apiStopped:true}),/Runtime drift/);
  assert.deepEqual(await contents(drift),driftBefore,'Unknown edits never overwritten');
  const rollback=await fixture('rollback');const rollbackBefore=await contents(rollback);let count=0;
  await assert.rejects(installOutboundConsent(rollback,{dryRun:false,apiStopped:true,afterWrite:()=>{if(++count===11)throw new Error('synthetic promotion failure');}}),/synthetic/);
  assert.deepEqual(await contents(rollback),rollbackBefore,'Existing files restored and new files removed');
  assert.equal((await readdir(rollback)).includes('.outbound-consent-install.lock'),false);
  const link=await fixture('symlink');const policy=join(link,'src/repositories/call-completion-policy.js');
  await rm(policy);await symlink(join(runtime,'src/repositories/call-completion-policy.js'),policy);
  await assert.rejects(installOutboundConsent(link),/regular runtime file/);
  for (const ancestor of ['var', 'var/deployment-backups']) {
    const backupLinkRuntime = await fixture('backup-symlink-' + ancestor.replaceAll('/', '-'));
    if (ancestor.includes('/')) await mkdir(join(backupLinkRuntime, 'var'));
    await symlink(join(runtime, ancestor), join(backupLinkRuntime, ancestor));
    const beforeBackupLink = await contents(backupLinkRuntime);
    await assert.rejects(installOutboundConsent(backupLinkRuntime), /Symlinked backup directory/);
    await assert.rejects(installOutboundConsent(backupLinkRuntime, { dryRun: false, apiStopped: true }), /Symlinked backup directory/);
    assert.deepEqual(await contents(backupLinkRuntime), beforeBackupLink, 'Backup-ancestor symlinks fail before any runtime promotion');
    assert.equal((await readdir(backupLinkRuntime)).includes('.outbound-consent-install.lock'), false);
  }

  // Execute the actual generated wrapper with a provider-free guard stub.
  const guardRuntime=join(temporary,'guard');await mkdir(join(guardRuntime,'src/clients'),{recursive:true});
  await mkdir(join(guardRuntime,'src/repositories'),{recursive:true});await writeFile(join(guardRuntime,'package.json'),'{"type":"module"}');
  await writeFile(join(guardRuntime,'src/clients/sarvam.js'),patchOutboundClient(clientSource));
  await writeFile(join(guardRuntime,'src/repositories/outbound-consent.repository.js'),`export async function withOutboundConsentGuard(identity,submit){
    if(identity.phoneNumber==='blocked'){const e=new Error('suppressed');e.code='OUTBOUND_CONTACT_SUPPRESSED';throw e;}
    return submit();
  }`);
  const client=await import(pathToFileURL(join(guardRuntime,'src/clients/sarvam.js')));
  const options={agentVariables:{voter_id:'ID-A'},webhookMetadata:{voter_id:'id-a'},userPhoneNumber:'synthetic',appVersion:7};
  assert.equal((await client.createInstantOutboundCall(options)).exactPayload,options);
  await assert.rejects(client.createInstantOutboundCall({...options,userPhoneNumber:'blocked'}),error=>error.code==='OUTBOUND_CONTACT_SUPPRESSED');
  await assert.rejects(client.createInstantOutboundCall({...options,webhookMetadata:{voter_id:'different'}}),error=>error.code==='OUTBOUND_IDENTITY_CONFLICT');
  assert.equal(client.untouchedConfiguration,'preserved');
  console.log('Guarded outbound installer passed: dry-run, pinned baselines, all-target preflight, private backups, ownership/modes, rollback, idempotence, unknown layouts and generated shared boundary.');
}finally{await rm(temporary,{recursive:true,force:true});}
