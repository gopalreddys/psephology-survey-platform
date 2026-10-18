import { readFile, writeFile, stat, lstat, realpath, mkdir, rename, unlink, chmod, chown, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchOutboundClient } from './patch-outbound-client.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
export const runtimeFiles = [
  ['../sarvam-outbound-webhook/call-completion-policy.js','src/repositories/call-completion-policy.js','fcae6af3c536ae1da9743bff0501934c63710b957d642a3e93b7c04d20d3d62d'],
  ['../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js','src/repositories/sarvam-outbound-webhook.repository.js','ac2218f776de44aa6c244b4c1f6e037a478637dc5eec000502a60a625d26b658'],
  ['../interview-completion/interview-completion.js','src/repositories/interview-completion.js','ebbd6b65ae63ebb1e418255d364fb681401f75c939e25fa7476b11d5c63f6750'],
  ['../output-variable-standardization/normalization-rules.json','src/repositories/normalization-rules.json','f481a6099b0d5d10eba44195ce5e86df9937d947942fb3a20a225d5e05e17d0c'],
  ['../research-reporting-foundation/research-report.js','src/repositories/research-report.js','b4ded32d1e6acdb9bc8afb7d434f4e42c31194392911900222984094ed365fc6'],
  ['../run-bulk-launch/run-launch-preview.repository.js','src/repositories/run-launch-preview.repository.js','bba9b08f2aa916cf176a954b1721f4f6ba1c0e7290794bbeb1ba6f9cb5c3d766'],
  ['../campaign-workspace/campaign-voter-selection.repository.js','src/repositories/campaign-voter-selection.repository.js','ad1fda44e43e73925c487d40d06b76b6896b70f2f86d4d8b6eb00470386b6b16'],
  ['../voter-demo-call/voter-demo-calls.repository.js','src/repositories/voter-demo-calls.repository.js','29a359b425dc444fffca391e677cf128f6fe83eb75e8dbb1a9670636e57e9a21'],
  ['../voter-demo-call/voter-demo-call.service.js','src/services/voter-demo-call.service.js','229b423bca8a9dd66daf04901f7019244d8ab623858b051116e34fcea8c25704'],
  ['outbound-consent.repository.js','src/repositories/outbound-consent.repository.js',null],
  ['035_outbound_contact_suppression.sql','sql/035_outbound_contact_suppression.sql',null],
  ['migrate-outbound-consent.mjs','src/db/migrate-outbound-consent.mjs',null],
  ['reconcile-recorded-optouts.mjs','src/db/reconcile-recorded-optouts.mjs',null]
];
export const dependencies = [
  ['src/repositories/output-normalization.repository.js','b848c438697b5ad7fbfd772ba3e352d4077196589dcdfa98dc4fbe2f04245094'],
  ['src/repositories/interview-completion.repository.js','a27d8212b760b61d909e57ab871db0653faaca7d3e082ce0d1f0ddfb8c130eee']
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function existing(file) {
  try {
    const info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink())throw new Error('Expected a regular runtime file: '+file);
    return { bytes:await readFile(file),info };
  }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}
function checkSyntax(source, target) {
  if (/\.(?:mjs|js)$/.test(target)) execFileSync(process.execPath,['--input-type=module','--check'],{input:source,stdio:['pipe','pipe','pipe']});
  if(target.endsWith('.json'))JSON.parse(source);
}

export async function installOutboundConsent(root, { dryRun = true, apiStopped = false, afterWrite } = {}) {
  root=await realpath(resolve(root));
  if(root==='/' || root===process.env.HOME)throw new Error('A specific API runtime directory is required');
  if(!dryRun&&!apiStopped)throw new Error('Stop the API, verify no active calls, then explicitly acknowledge apiStopped');
  // Do not follow managed-directory symlinks into an unrelated checkout.
  for(const relative of ['src/clients','src/repositories','src/services','src/db','sql']){
    const resolved=await realpath(join(root,relative));
    if(resolved!==join(root,relative))throw new Error('Symlinked runtime directory requires review: '+relative);
  }
  for(const relative of ['var','var/deployment-backups']){
    try{const info=await lstat(join(root,relative));
      if(!info.isDirectory()||info.isSymbolicLink()||await realpath(join(root,relative))!==join(root,relative))throw new Error('Symlinked backup directory requires review: '+relative);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  for(const [relative,expected] of dependencies){
    const item=await existing(join(root,relative));
    if(!item || hash(item.bytes)!==expected)throw new Error('Unreviewed runtime dependency: '+relative);
  }
  const plan=[];
  for(const [source,target,baseline] of runtimeFiles){
    const bytes=await readFile(resolve(packageRoot,source));
    const old=await existing(join(root,target));
    if((baseline&&!old) || (old&&hash(old.bytes)!==hash(bytes)&&hash(old.bytes)!==baseline)){
      throw new Error('Runtime drift; review before replacing '+target);
    }
    checkSyntax(bytes,target);
    plan.push({target,bytes,old,changed:!old||hash(old.bytes)!==hash(bytes)});
  }
  const target='src/clients/sarvam.js', old=await existing(join(root,target));
  if(!old)throw new Error('Outbound client is unavailable');
  const bytes=Buffer.from(patchOutboundClient(old.bytes.toString('utf8')));
  checkSyntax(bytes,target);
  plan.push({target,bytes,old,changed:hash(old.bytes)!==hash(bytes)});
  const changed=plan.filter(item=>item.changed);
  const summary={dryRun,changed:changed.map(item=>item.target),schemaMigrationRequired:true,
    apiRestartPerformed:false,sqlNormalizerSyncPerformed:false,quickPublicationPerformed:false};
  if(dryRun||!changed.length)return summary;
  const lock=await open(join(root,'.outbound-consent-install.lock'),'wx',0o600);
  const backupRoot=join(root,'var','deployment-backups','outbound-consent-'+Date.now()+'-'+randomUUID());
  const written=[];
  try{
    await mkdir(backupRoot,{recursive:true,mode:0o700});
    for(const item of changed){
      const current=await existing(join(root,item.target));
      if(Boolean(current)!==Boolean(item.old)||(current&&hash(current.bytes)!==hash(item.old.bytes)))throw new Error('Runtime changed after preflight: '+item.target);
      if(item.old){
        const backup=join(backupRoot,item.target);await mkdir(dirname(backup),{recursive:true,mode:0o700});
        await writeFile(backup,item.old.bytes,{flag:'wx',mode:0o600});
      }
      const destination=join(root,item.target);await mkdir(dirname(destination),{recursive:true});
      const parent=await stat(dirname(destination));
      const temp=destination+'.outbound-consent-'+randomUUID()+'.tmp';
      try{
        await writeFile(temp,item.bytes,{flag:'wx',mode:item.old?item.old.info.mode&0o777:0o640});
        await chmod(temp,item.old?item.old.info.mode&0o777:0o640);
        await chown(temp,item.old?.info.uid??parent.uid,item.old?.info.gid??parent.gid);
        await rename(temp,destination);
      }finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      written.push(item);
      if(afterWrite)await afterWrite(item.target);
    }
    await writeFile(join(backupRoot,'manifest.json'),JSON.stringify({files:plan.map(item=>({path:item.target,before:item.old?hash(item.old.bytes):null,after:hash(item.bytes)}))},null,2),{flag:'wx',mode:0o600});
    return {...summary,backupRoot};
  }catch(error){
    const conflicts=[];
    for(const item of [...written].reverse()){
      const destination=join(root,item.target),now=await existing(destination);
      if(!now||hash(now.bytes)!==hash(item.bytes)){conflicts.push(item.target);continue;}
      if(!item.old){await unlink(destination);continue;}
      const temp=destination+'.rollback-'+randomUUID()+'.tmp';
      await writeFile(temp,item.old.bytes,{flag:'wx',mode:item.old.info.mode&0o777});
      await chown(temp,item.old.info.uid,item.old.info.gid);await rename(temp,destination);
      await chmod(destination,item.old.info.mode&0o777);
    }
    error.backupRoot=backupRoot;error.rollbackConflicts=conflicts;throw error;
  }finally{await lock.close();await unlink(join(root,'.outbound-consent-install.lock'));}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),root=args.find(arg=>!arg.startsWith('--'))||'/opt/sarvam-voice-analytics';
  if(args.some(arg=>arg.startsWith('--')&&!['--apply','--dry-run','--api-stopped'].includes(arg)))throw new Error('Unknown installer option');
  if(args.includes('--apply')&&args.includes('--dry-run'))throw new Error('Choose --apply or --dry-run');
  console.log(JSON.stringify(await installOutboundConsent(root,{dryRun:!args.includes('--apply'),apiStopped:args.includes('--api-stopped')}),null,2));
}
