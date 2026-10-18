import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temporary=await mkdtemp(join(tmpdir(),'outbound-webhook-fixture-'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
  await mkdir(join(temporary,'src/repositories'),{recursive:true});await mkdir(join(temporary,'src/db'),{recursive:true});
  await writeFile(join(temporary,'package.json'),'{"type":"module"}');
  for(const [source,target]of [
    ['../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js','sarvam-outbound-webhook.repository.js'],
    ['../sarvam-outbound-webhook/call-completion-policy.js','call-completion-policy.js'],
    ['./outbound-consent.repository.js','outbound-consent.repository.js']
  ])await writeFile(join(temporary,'src/repositories',target),await readFile(new URL(source,import.meta.url)));
  await writeFile(join(temporary,'src/db/postgres.js'),'export let pool; export function setPool(value){pool=value;} export async function getDb(){return pool;}');
  await writeFile(join(temporary,'src/repositories/run-lifecycle.repository.js'),'export async function reconcileRunLifecycle(){return {runFinalized:false,iterationFinalized:false};}');
  await writeFile(join(temporary,'src/repositories/voter-demo-calls.repository.js'),`export async function recordVoterDemoCallOutcome(db,options){return db.demoOutcome(options);}`);
  const {setPool}=await import(pathToFileURL(join(temporary,'src/db/postgres.js')));
  const {recordSarvamOutboundResult}=await import(pathToFileURL(join(temporary,'src/repositories/sarvam-outbound-webhook.repository.js')));
  const state={suppressed:new Set(),events:new Map(),contact:null,rawVariables:null,statements:[],failContact:false,demo:false,release:0};
  let staged;
  const db={
    async demoOutcome(){return state.demo?{id:id(9),voter_id:id(4),status:'COMPLETED',disposition:'do_not_call',submitted_phone_snapshot:'+918888888888'}:null;},
    async query(sql,values=[]){
      state.statements.push({sql,values});
      if(sql==='BEGIN'){staged={suppressed:new Set(state.suppressed),events:new Map(state.events),contact:state.contact,rawVariables:state.rawVariables};return {rows:[]};}
      if(sql==='COMMIT'){Object.assign(state,staged);return {rows:[]};}
      if(sql==='ROLLBACK'){staged=null;return {rows:[]};}
      if(sql.includes('advisory_xact_lock'))return {rows:[]};
      if(sql.includes('SELECT id, delivery_status')){const item=staged.events.get(values[0]);return {rows:item?[item]:[]};}
      if(sql.includes('INSERT INTO sarvam_outbound_webhook_events')){const item={id:values[1],delivery_status:'RECEIVED'};staged.events.set(values[1],item);return {rows:[item]};}
      if(sql.includes('execution.*'))return {rows:state.demo?[]:[{id:id(1),run_id:id(2),run_contact_id:id(3),voter_id:id(4),
        iteration_id:id(5),study_id:id(6),attempt_number:1,is_demo_contact:true,current_phone_number:'+919999999999',
        request_payload:{user_config:{user_phone_number:'+919876543210'}}}]};
      if(sql.includes('INSERT INTO public.outbound_contact_suppressions_v1')){const key=values[0]+':'+values[1],exists=staged.suppressed.has(key);staged.suppressed.add(key);return {rows:exists?[]:[{identifier_kind:values[0]}],rowCount:exists?0:1};}
      if(sql.includes('SELECT EXISTS')&&sql.includes('outbound_contact_suppressions_v1'))return {rows:[{suppressed:staged.suppressed.has('VOTER:'+values[0])||values[1].some(hash=>staged.suppressed.has('PHONE:'+hash))}]};
      if(sql.startsWith('SELECT phone_number FROM voter_master'))return {rows:[{phone_number:'+919876543210'}]};
      if(sql.includes('UPDATE call_executions'))return {rows:[]};
      if(sql.includes('UPDATE calls')&&sql.includes('RETURNING id')){staged.rawVariables=JSON.parse(values[6]);return {rows:[{id:id(7)}]};}
      if(sql.includes('UPDATE calls')&&sql.includes('SET study_id'))return {rows:[]};
      if(sql.includes('UPDATE campaign_run_contacts')){if(state.failContact)throw new Error('synthetic contact failure');staged.contact={attempt:values[1],final:values[2],retry:values[3],successful:values[4],reason:values[7]};return {rows:[]};}
      if(sql.includes('UPDATE sarvam_outbound_webhook_events')){staged.events.get(values[0]).delivery_status='PROCESSED';return {rows:[]};}
      throw new Error('Unexpected fixture SQL: '+sql.slice(0,65));
    },release(){state.release++;}
  };
  setPool({connect:async()=>db});
  const payload=extra=>({attempt_id:'synthetic-attempt',connectivity_status:'connected',interaction_transcript:[{en_text:'Synthetic only'}],
    final_agent_variables:{disposition:'do_not_call'},...extra});
  let result=await recordSarvamOutboundResult(payload());
  assert.equal(result.researchSuccessful,false);assert.equal(state.contact.final,'DO_NOT_CALL');assert.equal(state.contact.retry,false);
  assert.equal(state.suppressed.size,3,'Voter, submitted phone and current phone suppressed');
  assert.deepEqual(state.rawVariables,{disposition:'do_not_call'},'Provider output not rewritten');
  const stopped=state.suppressed.size;
  assert.equal((await recordSarvamOutboundResult(payload())).duplicate,true);
  assert.equal(state.suppressed.size,stopped);
  result=await recordSarvamOutboundResult(payload({final_agent_variables:{disposition:'survey_completed',graduate_issue_priority:'Jobs'}}));
  assert.equal(result.researchSuccessful,false);assert.equal(state.contact.final,'DO_NOT_CALL');assert.equal(state.contact.retry,false);
  assert.deepEqual(state.rawVariables,{disposition:'survey_completed',graduate_issue_priority:'Jobs'},'Conflicting raw history remains exact');
  state.suppressed=new Set();state.events=new Map();
  result=await recordSarvamOutboundResult(payload({output_agent_variables:{disposition:'do_not_call'},
    final_agent_variables:{disposition:'survey_completed',graduate_issue_priority:'Jobs'}}));
  assert.equal(result.researchSuccessful,false);assert.equal(state.contact.final,'DO_NOT_CALL');
  assert.equal(state.suppressed.size,3,'A stop in one container cannot be overwritten by the other');
  assert.deepEqual(state.rawVariables,{disposition:'survey_completed',graduate_issue_priority:'Jobs'});
  state.suppressed=new Set();state.events=new Map();state.contact=null;state.failContact=true;
  await assert.rejects(recordSarvamOutboundResult(payload()),/synthetic contact failure/);
  assert.equal(state.suppressed.size,0,'No orphan suppression on callback rollback');
  assert.equal(state.events.size,0);
  state.failContact=false;state.demo=true;
  result=await recordSarvamOutboundResult(payload({metadata:{demo_call_id:id(9)}}));
  assert.equal(result.demoCall,true);assert.equal(state.suppressed.size,3,'Matched standalone request suppresses voter, original and current phone');
  state.suppressed=new Set();state.events=new Map();
  result=await recordSarvamOutboundResult(payload({metadata:{demo_call_id:id(9)},output_agent_variables:{do_not_call:true},
    final_agent_variables:{do_not_call:false,disposition:'survey_completed'}}));
  assert.equal(result.demoCall,true);assert.equal(state.suppressed.size,3,'Standalone conflicting containers retain the opt-out');
  assert.ok(state.statements.some(item=>item.sql.includes('ROLLBACK')));
  assert.ok(state.release>=5);
  const demoSource=await readFile(new URL('../voter-demo-call/voter-demo-calls.repository.js',import.meta.url),'utf8');
  assert.match(demoSource,/RETURNING id, voter_id, status, submitted_phone_snapshot/);
  assert.match(demoSource,/voter\.outbound_suppressed !== false/);
  for(const file of ['../run-bulk-launch/run-launch-preview.repository.js','../campaign-workspace/campaign-voter-selection.repository.js']){
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const active=(source.match(/voter.contact_status = 'ACTIVE'/g)||[]).length;
    assert.equal((source.match(/NOT public\.outbound_contact_is_suppressed_v1\(voter.id, voter.phone_number\)/g)||[]).length,active);
  }
  console.log('Actual webhook fixture passed: Run/standalone opt-out, original/current destination, duplicate callback, conflicting later success, atomic rollback, source preservation and cohort/reservation wiring.');
}finally{await rm(temporary,{recursive:true,force:true});}
