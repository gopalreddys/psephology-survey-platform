// Default is read-only. --apply adds opt-out identifiers only; it never changes
// calls, transcripts, responses, voters, contact outcomes or Run states.
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const tokenSql=value=>`btrim(regexp_replace(lower(btrim(COALESCE(${value},''))), '[^a-z0-9]+', '_', 'g'),'_')`;
const normalizedToken=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
function stopWhere(variable){
  const keys=['disposition','call_disposition','respondent_status','survey_consent','consent','consent_status'];
  return `(${tokenSql(variable+"->>'do_not_call'")} IN ('yes','true','do_not_call') OR `+
    keys.map(key=>`${tokenSql(variable+"->>'"+key+"'")}='do_not_call'`).join(' OR ')+')';
}
const payloadStopWhere=payload=>`(${stopWhere('('+payload+"->'output_agent_variables')")} OR ${stopWhere('('+payload+"->'final_agent_variables')")})`;
export async function reconcileRecordedOptOuts(db,{apply=false,requestsDoNotCall,recordOutboundOptOut,normalizeOutboundMobile}){
  if([requestsDoNotCall,recordOutboundOptOut,normalizeOutboundMobile].some(helper=>typeof helper!=='function'))throw new TypeError('Reviewed outbound consent helpers are required');
  const run=await db.query(`SELECT c.voter_id,c.attempt_id AS source_attempt_id,c.response_variables AS variables,c.raw_payload AS callback_payload,
    voter.phone_number,COALESCE(e.request_payload #>> '{user_config,user_phone_number}',
      e.request_payload #>> '{body,user_config,user_phone_number}') AS submitted_phone
    FROM calls c LEFT JOIN voter_master voter ON voter.id=c.voter_id
    LEFT JOIN call_executions e ON e.provider_attempt_id=c.attempt_id AND e.voter_id=c.voter_id AND e.run_id=c.run_id
    WHERE ${stopWhere('c.response_variables')} OR ${payloadStopWhere('c.raw_payload')} ORDER BY c.id LIMIT 10001`);
  const demo=await db.query(`SELECT d.voter_id,d.provider_call_id AS source_attempt_id,d.final_agent_variables AS variables,
    d.disposition AS recorded_disposition,d.callback_payload,d.submitted_phone_snapshot AS submitted_phone,voter.phone_number
    FROM voter_demo_calls d LEFT JOIN voter_master voter ON voter.id=d.voter_id
    WHERE ${stopWhere('d.final_agent_variables')} OR ${tokenSql('d.disposition')}='do_not_call' OR ${payloadStopWhere('d.callback_payload')}
    ORDER BY d.id LIMIT 10001`);
  if(run.rows.length>10000||demo.rows.length>10000)throw new Error('Historical opt-out audit exceeds demo safety bound; use a reviewed paginated audit');
  let inserted=0,phoneUnavailable=0,originalPhoneUnavailable=0;
  const candidates=[...run.rows.map(row=>({...row,source:'RECORDED_RUN_OPTOUT_AUDIT'})),...demo.rows.map(row=>({...row,source:'RECORDED_DEMO_OPTOUT_AUDIT'}))];
  for(const row of candidates){
    const variables={...(row.variables||{})};
    if(normalizedToken(row.recorded_disposition)==='do_not_call')variables.do_not_call=true;
    if(![variables,row.callback_payload?.output_agent_variables,row.callback_payload?.final_agent_variables]
      .some(value=>value&&typeof value==='object'&&requestsDoNotCall(value)))throw new Error('Historical opt-out candidate cannot be resolved safely');
    if(typeof row.voter_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.voter_id))throw new Error('Historical opt-out has no valid retained voter identity');
    const phones=[row.submitted_phone,row.phone_number];
    if(!phones.some(normalizeOutboundMobile))phoneUnavailable++;
    if(!normalizeOutboundMobile(row.submitted_phone))originalPhoneUnavailable++;
    if(apply){const result=await recordOutboundOptOut(db,{voterId:row.voter_id,phoneNumbers:phones,
      sourceAttemptId:row.source_attempt_id||null,source:row.source});inserted+=result.inserted;}
  }
  return {dryRun:!apply,recordedRunOptOuts:run.rows.length,recordedDemoOptOuts:demo.rows.length,
    insertedIdentifiers:inserted,missingAnyValidPhone:phoneUnavailable,missingRetainedOriginalPhone:originalPhoneUnavailable,
    rawHistoricalRecordsModified:false,providerSubmissionPerformed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),root=resolve(args.find(x=>!x.startsWith('--'))||'/opt/sarvam-voice-analytics');
  if(args.some(x=>x.startsWith('--')&&!['--apply','--dry-run'].includes(x))||args.includes('--apply')&&args.includes('--dry-run'))throw new Error('Choose --dry-run or --apply');
  const apply=args.includes('--apply');
  const {getDb}=await import(pathToFileURL(resolve(root,'src/db/postgres.js')));
  const helpers=await import(pathToFileURL(resolve(root,'src/repositories/outbound-consent.repository.js')));
  const {requestsDoNotCall}=await import(pathToFileURL(resolve(root,'src/repositories/call-completion-policy.js')));
  const pool=await getDb(),db=await pool.connect();
  try{
    await db.query(apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report=await reconcileRecordedOptOuts(db,{...helpers,requestsDoNotCall,apply});
    await db.query('COMMIT');console.log(JSON.stringify(report));
  }catch(error){await db.query('ROLLBACK');throw error;}
  finally{db.release();await pool.end();}
}
