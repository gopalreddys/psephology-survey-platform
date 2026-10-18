import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { reconcileRecordedOptOuts } from './reconcile-recorded-optouts.mjs';
import { requestsDoNotCall } from '../sarvam-outbound-webhook/call-completion-policy.js';
import { normalizeOutboundMobile, recordOutboundOptOut } from './outbound-consent.repository.js';

// Entirely synthetic local PostgreSQL. No application adapter, secret or client.
const { PGlite }=await import(process.env.PGLITE_MODULE_PATH
  ?pathToFileURL(process.env.PGLITE_MODULE_PATH).href:'@electric-sql/pglite');
const pg=new PGlite();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const db={async query(sql,values=[]){
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};
  const result=await pg.query(sql,values);
  return {...result,rowCount:result.rows.length||result.affectedRows||0};
}};
const helpers={requestsDoNotCall,normalizeOutboundMobile,recordOutboundOptOut};
const snapshot=async()=>JSON.stringify(await Promise.all(['calls','voter_demo_calls','voter_master','call_executions']
  .map(table=>pg.query(`SELECT * FROM ${table} ORDER BY id`))));
try{
  await pg.exec(`CREATE TABLE voter_master(id uuid PRIMARY KEY,phone_number text);
    CREATE TABLE calls(id uuid PRIMARY KEY,voter_id uuid,attempt_id text,run_id uuid,response_variables jsonb,raw_payload jsonb);
    CREATE TABLE call_executions(id uuid PRIMARY KEY,voter_id uuid,provider_attempt_id text,run_id uuid,request_payload jsonb);
    CREATE TABLE voter_demo_calls(id uuid PRIMARY KEY,voter_id uuid,provider_call_id text,final_agent_variables jsonb,disposition text,callback_payload jsonb);`);
  await pg.exec(await readFile(new URL('./035_outbound_contact_suppression.sql',import.meta.url),'utf8'));
  await pg.query('INSERT INTO voter_master VALUES ($1,$2)',[id(1),'+919999999999']);
  const explicitStops=[{do_not_call:true},{do_not_call:' YES '},{do_not_call:'DO NOT CALL.'},
    ...['disposition','call_disposition','respondent_status','survey_consent','consent','consent_status']
      .map(key=>({[key]:' Do-not-call. '}))];
  const nonStops=[{disposition:'survey_completed',graduate_issue_priority:'jobs'},
    {do_not_call:false},{do_not_call:'no'},{disposition:'callback_requested'},
    {consent:'no'}, {do_not_call:'unknown'}, {disposition:'not do not call'}];
  for(const [index,variables]of [...explicitStops,...nonStops].entries()){
    const attempt='synthetic-'+index;
    await pg.query('INSERT INTO calls VALUES ($1,$2,$3,$4,$5::jsonb,NULL)',[id(index+10),id(1),attempt,id(2),JSON.stringify(variables)]);
    // Exercise both retained request shapes; one old attempt has no phone.
    if(index!==0)await pg.query('INSERT INTO call_executions VALUES ($1,$2,$3,$4,$5::jsonb)',
      [id(index+50),id(1),attempt,id(2),JSON.stringify(index%2?{body:{user_config:{user_phone_number:'9876543210'}}}:{user_config:{user_phone_number:'+91 98765-43210'}})]);
  }
  await pg.query('INSERT INTO voter_demo_calls VALUES ($1,$2,$3,$4::jsonb,$5,NULL,NULL)',[id(100),id(1),'demo-1','{}','DO NOT CALL.']);
  await pg.query('INSERT INTO voter_demo_calls VALUES ($1,$2,$3,$4::jsonb,$5,NULL,NULL)',[id(101),id(1),'demo-2',JSON.stringify({consent_status:'do_not_call'}),'completed']);
  await pg.query('INSERT INTO voter_demo_calls VALUES ($1,$2,$3,$4::jsonb,$5,NULL,NULL)',[id(102),id(1),'demo-3','{}','callback_requested']);
  const conflicting=JSON.stringify({output_agent_variables:{disposition:'do_not_call'},final_agent_variables:{disposition:'survey_completed'}});
  await pg.query('INSERT INTO calls VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[id(103),id(1),'raw-run-stop',id(2),'{"disposition":"survey_completed"}',conflicting]);
  await pg.query('INSERT INTO voter_demo_calls VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)',[id(104),id(1),'raw-demo-stop','{}','survey_completed',conflicting,'9876543210']);
  const rawBefore=await snapshot();
  await pg.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const dry=await reconcileRecordedOptOuts(db,{...helpers,recordOutboundOptOut:()=>{throw new Error('Dry run attempted a write');}});
  await pg.exec('COMMIT');
  assert.deepEqual(dry,{dryRun:true,recordedRunOptOuts:explicitStops.length+1,recordedDemoOptOuts:3,
    insertedIdentifiers:0,missingAnyValidPhone:0,missingRetainedOriginalPhone:4,
    rawHistoricalRecordsModified:false,providerSubmissionPerformed:false});
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM public.outbound_contact_suppressions_v1')).rows[0].n,0);
  await pg.exec('BEGIN');
  const applied=await reconcileRecordedOptOuts(db,{...helpers,apply:true});
  await pg.exec('COMMIT');
  assert.equal(applied.insertedIdentifiers,3,'One voter plus retained original and current phones');
  assert.equal(await snapshot(),rawBefore,'No calls, raw variables, outcomes, voters or request history are rewritten');
  await pg.exec('BEGIN');
  assert.equal((await reconcileRecordedOptOuts(db,{...helpers,apply:true})).insertedIdentifiers,0);
  await pg.exec('COMMIT');
  await pg.query('INSERT INTO calls VALUES ($1,NULL,$2,$3,$4::jsonb,NULL)',[id(200),'missing-voter',id(2),'{"do_not_call":true}']);
  await pg.exec('BEGIN');
  await assert.rejects(reconcileRecordedOptOuts(db,{...helpers,apply:true}),/valid retained voter identity/);
  await pg.exec('ROLLBACK');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM public.outbound_contact_suppressions_v1')).rows[0].n,3);
  const tooMany={query:async()=>({rows:Array(10001).fill({})})};
  await assert.rejects(reconcileRecordedOptOuts(tooMany,helpers),/safety bound/);
  console.log('Recorded opt-out audit passed: read-only default, SQL/JS token parity, both request shapes, bounded apply, idempotence, identity failure and historical preservation.');
}finally{await pg.close();}
