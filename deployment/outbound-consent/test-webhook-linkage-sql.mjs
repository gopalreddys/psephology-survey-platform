import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite }=await import(process.env.PGLITE_MODULE_PATH
  ?pathToFileURL(process.env.PGLITE_MODULE_PATH).href:'@electric-sql/pglite');
const pg=new PGlite(),temporary=await mkdtemp(join(tmpdir(),'outbound-linkage-sql-'));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
try{
  await pg.exec(`CREATE TABLE voter_master(id uuid PRIMARY KEY,phone_number text,is_demo_contact boolean,
      full_name text,preferred_language text,occupation text,qualification text,age int,gender text,mandal_name_source text,
      assembly_constituency_name text,contact_status text DEFAULT 'ACTIVE',is_active boolean DEFAULT true,geo_unit_id uuid);
    CREATE TABLE geo_units(id uuid PRIMARY KEY,name text,geo_type text,parent_id uuid,is_active boolean);
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE campaign_runs(id uuid PRIMARY KEY,iteration_id uuid);
    CREATE TABLE program_iterations(id uuid PRIMARY KEY,study_id uuid);
    CREATE TABLE call_executions(id uuid PRIMARY KEY,provider_attempt_id text,run_id uuid,voter_id uuid,created_at timestamptz DEFAULT now());
    CREATE TABLE sarvam_outbound_webhook_events(id uuid DEFAULT gen_random_uuid(),attempt_id text,event_hash text UNIQUE,
      delivery_status text DEFAULT 'RECEIVED',raw_payload jsonb,processed_at timestamptz,error_message text);`);
  for(const file of ['../voter-demo-call/017_voter_demo_calls.sql','../voter-demo-call/027_voter_demo_call_outcomes.sql','./035_outbound_contact_suppression.sql'])
    await pg.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  await pg.query('INSERT INTO voter_master(id,phone_number,is_demo_contact) VALUES ($1,$2,true),($3,$2,true)',[id(1),'+919876543210',id(6)]);
  await pg.query('INSERT INTO call_executions(id,provider_attempt_id,voter_id) VALUES ($1,$2,$3),($4,NULL,$3)',[id(2),'bound-attempt',id(1),id(3)]);
  await pg.exec(`INSERT INTO voter_demo_calls(id,voter_id,idempotency_key,consent_confirmed,provider_call_id,submitted_phone_snapshot)
    VALUES ('${id(4)}','${id(1)}','synthetic-bound',true,'bound-demo','+919876543210'),
    ('${id(5)}','${id(1)}','synthetic-unbound',true,NULL,'+919876543210')`);
  await mkdir(join(temporary,'src/repositories'),{recursive:true});await mkdir(join(temporary,'src/db'),{recursive:true});
  await writeFile(join(temporary,'package.json'),'{"type":"module"}');
  for(const [source,target]of [
    ['../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js','sarvam-outbound-webhook.repository.js'],
    ['../sarvam-outbound-webhook/call-completion-policy.js','call-completion-policy.js'],
    ['../voter-demo-call/voter-demo-calls.repository.js','voter-demo-calls.repository.js'],
    ['./outbound-consent.repository.js','outbound-consent.repository.js']])
    await writeFile(join(temporary,'src/repositories',target),await readFile(new URL(source,import.meta.url)));
  await writeFile(join(temporary,'src/db/postgres.js'),'export let pool; export function setPool(value){pool=value;} export async function getDb(){return pool;}');
  await writeFile(join(temporary,'src/repositories/run-lifecycle.repository.js'),'export async function reconcileRunLifecycle(){throw new Error("Must not reconcile in linkage probe");}');
  let expectedExecution=null;
  const db={async query(sql,values=[]){
    if(sql.includes('advisory_xact_lock'))return {rows:[]};
    const result=await pg.query(sql,values);
    if(sql.includes('execution.*')&&result.rows.length){
      assert.equal(result.rows[0].id,expectedExecution);
      throw new Error('EXPECTED_LINK_ONLY'); // Stop before mutating any outcome.
    }
    return {...result,rowCount:result.rows.length||result.affectedRows||0};
  },release(){}};
  const {setPool}=await import(pathToFileURL(join(temporary,'src/db/postgres.js')));setPool({connect:async()=>db});
  const {recordSarvamOutboundResult}=await import(pathToFileURL(join(temporary,'src/repositories/sarvam-outbound-webhook.repository.js')));
  const payload=(attempt,execution)=>({attempt_id:attempt,connectivity_status:'connected',metadata:{execution_id:execution},
    final_agent_variables:{disposition:'do_not_call'}});
  let result=await recordSarvamOutboundResult(payload('foreign-attempt',id(2)));
  assert.equal(result.matched,false,'Metadata cannot select another already-bound Run attempt');
  expectedExecution=id(2);
  await assert.rejects(recordSarvamOutboundResult(payload('bound-attempt',id(3))),/EXPECTED_LINK_ONLY/);
  expectedExecution=id(3);
  await assert.rejects(recordSarvamOutboundResult(payload('new-attempt',id(3))),/EXPECTED_LINK_ONLY/);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM outbound_contact_suppressions_v1')).rows[0].n,0);
  const {recordVoterDemoCallOutcome,reserveVoterDemoCall}=await import(pathToFileURL(join(temporary,'src/repositories/voter-demo-calls.repository.js')));
  const demoBefore=(await pg.query('SELECT * FROM voter_demo_calls WHERE id=$1',[id(4)])).rows[0];
  const options={demoCallId:id(4),providerCallId:'foreign-demo',providerStatus:'connected',disposition:'do_not_call'};
  assert.equal(await recordVoterDemoCallOutcome(db,options),null);
  assert.deepEqual((await pg.query('SELECT * FROM voter_demo_calls WHERE id=$1',[id(4)])).rows[0],demoBefore);
  assert.equal(await recordVoterDemoCallOutcome(db,{...options,providerCallId:null}),null);
  assert.equal((await recordVoterDemoCallOutcome(db,{...options,providerCallId:'bound-demo'})).voter_id,id(1));
  assert.equal((await recordVoterDemoCallOutcome(db,{...options,demoCallId:id(5),providerCallId:'new-demo'})).submitted_phone_snapshot,'+919876543210');
  assert.equal((await recordVoterDemoCallOutcome(db,{...options,demoCallId:null,providerCallId:'new-demo'})).id,id(5));
  const reserved=await reserveVoterDemoCall({voterId:id(6),requestedBy:null,idempotencyKey:'new-snapshot-request'});
  assert.equal(reserved.repeated,false);
  await pg.query('UPDATE voter_master SET phone_number=$2 WHERE id=$1',[id(6),'+919999999999']);
  assert.equal((await pg.query('SELECT submitted_phone_snapshot FROM voter_demo_calls WHERE id=$1',[reserved.request.id])).rows[0].submitted_phone_snapshot,'+919876543210',
    'New reservation retains the actual destination even when the master number later changes');
  console.log('Actual linkage SQL passed: bound attempt mismatch quarantined, exact match/unbound fallback retained, standalone identity veto and original destination retained.');
}finally{await pg.close();await rm(temporary,{recursive:true,force:true});}
