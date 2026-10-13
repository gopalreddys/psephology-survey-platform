import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let source = await readFile(new URL('./research-scope.repository.js', import.meta.url), 'utf8');
source = source.replace("'./campaign-visibility.repository.js'", JSON.stringify(new URL('../campaign-draft-privacy/campaign-visibility.repository.js', import.meta.url).href))
  .replace("'./output-normalization.repository.js'", JSON.stringify(new URL('../output-variable-standardization/output-normalization.repository.js', import.meta.url).href));
const { resolveResearchScope } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const uid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
let active = true, visible = true, linked = true, runMatches = true;
const queries = [];
const db = { query: async (sql, values) => {
  queries.push({ sql, values });
  if (sql.includes('FROM users')) return { rows: active ? [{ id: uid(1) }] : [] };
  if (sql.includes('FROM campaigns campaign')) return { rows: visible ? [{ id: uid(2), name: 'Synthetic Campaign', status: 'ACTIVE' }] : [] };
  if (sql.includes('FROM program_iterations')) return { rows: linked ? [{ id: uid(3), number: 1, name: 'Iteration 1', completed: true }] : [] };
  if (sql.includes('FROM campaign_runs')) return { rows: runMatches ? [{ id: uid(4), number: 2, status: 'RUNNING' }] : [] };
  return { rows: [{ respondent_base: 10 }] };
} };
const actor = { id: uid(1), role_code: 'CAMPAIGN_MANAGER' };
let scope = await resolveResearchScope(db, uid(2), actor);
assert.equal(scope.scope.iteration.id, uid(3));
assert.equal(scope.segment.respondentBase, 10);
assert.equal(queries.length, 4, 'Hierarchy and aggregate base only; no full strategic analytics');
assert.ok(queries.every(({ sql }) => !/interaction_transcript|SELECT\s+call_record\.response_variables/i.test(sql)));
assert.ok(queries[1].sql.includes('campaign.campaign_manager_user_id = $2'));
assert.ok(queries[2].sql.includes('COUNT(*) FROM campaign_iteration_links'));
scope = await resolveResearchScope(db, uid(2), actor, { iterationId: uid(3), runId: uid(4), ageBand: '30–39', gender: 'Female', mandal: 'Demo Mandal' });
assert.equal(scope.scope.run.id, uid(4));
assert.equal(scope.scope.insightScope.filters.ageBand, '30–39');
assert.equal(scope.demographicProvenance, 'CURRENT_MASTER_DATA');
for (const role of ['CAMPAIGNER', 'UNKNOWN']) await assert.rejects(resolveResearchScope(db, uid(2), { ...actor, role_code: role }), (error) => error.statusCode === 403);
active = false; await assert.rejects(resolveResearchScope(db, uid(2), actor), (error) => error.statusCode === 403); active = true;
visible = false; await assert.rejects(resolveResearchScope(db, uid(2), actor), (error) => error.statusCode === 404); visible = true;
linked = false; await assert.rejects(resolveResearchScope(db, uid(2), actor, { iterationId: uid(3) }), (error) => error.statusCode === 404); linked = true;
runMatches = false; await assert.rejects(resolveResearchScope(db, uid(2), actor, { iterationId: uid(3), runId: uid(4) }), (error) => error.statusCode === 404);
for (const selection of [{ runId: uid(4) }, { ageBand: '18–30' }, { gender: 'Invented' }, { sentimentConstruct: 'candidate_criterion_fit' }, { iterationId: uid(8), voterId: uid(1) }])
  await assert.rejects(resolveResearchScope(db, uid(2), actor, selection), (error) => error.statusCode === 400);
console.log('Lightweight research scope passed: active actor, assignment, exact hierarchy, allowed filters, bounded aggregate query and no transcript loading.');

if (process.env.PGLITE_MODULE_PATH) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE roles (id uuid PRIMARY KEY, code text, is_active boolean);
      CREATE TABLE users (id uuid PRIMARY KEY, role_id uuid, status text);
      CREATE TABLE campaigns (id uuid PRIMARY KEY, campaign_code text, campaign_name text, status text,
        campaign_manager_user_id uuid, created_by_user_id uuid);
      CREATE TABLE program_iterations (id uuid PRIMARY KEY, iteration_number int, iteration_name text, status text);
      CREATE TABLE campaign_iteration_links (campaign_id uuid, iteration_id uuid, status text);
      CREATE TABLE campaign_runs (id uuid PRIMARY KEY, iteration_id uuid, run_number int, status text);
      CREATE TABLE voter_master (id uuid PRIMARY KEY, gender text, age int, mandal_name_source text);
      CREATE TABLE calls (id uuid PRIMARY KEY, iteration_id uuid, voter_id uuid, connectivity_status text, response_variables jsonb);`);
    await pg.query("INSERT INTO roles VALUES ($1,'CAMPAIGN_MANAGER',TRUE),($2,'ADMIN',TRUE)", [uid(10), uid(11)]);
    await pg.query("INSERT INTO users VALUES ($1,$2,'ACTIVE'),($3,$4,'ACTIVE'),($5,$4,'ACTIVE')", [actor.id, uid(10), uid(8), uid(11), uid(9)]);
    await pg.query("INSERT INTO campaigns VALUES ($1,'C1','Synthetic Campaign','ACTIVE',$2,$3),($4,'C2','Other','ACTIVE',NULL,$3)", [uid(2), actor.id, uid(8), uid(7)]);
    await pg.query("INSERT INTO program_iterations VALUES ($1,1,'Iteration 1','DRAFT'),($2,2,'Iteration 2','ACTIVE')", [uid(3), uid(5)]);
    await pg.query("INSERT INTO campaign_iteration_links VALUES ($1,$2,'COMPLETED'),($1,$3,'ACTIVE')", [uid(2), uid(3), uid(5)]);
    await pg.query("INSERT INTO campaign_runs VALUES ($1,$2,1,'COMPLETED'),($3,$4,1,'READY')", [uid(4), uid(3), uid(6), uid(5)]);
    await pg.query("INSERT INTO voter_master VALUES ($1,'female',35,'Demo Mandal')", [uid(100)]);
    for (let index=0; index<3; index++) await pg.query("INSERT INTO calls VALUES ($1,$2,$3,'connected','{\"graduate_issue_priority\":\"jobs\"}')", [uid(200+index), uid(3), uid(100)]);
    scope = await resolveResearchScope(pg, uid(2), actor);
    assert.equal(scope.scope.iteration.id, uid(3), 'Default selects effective completed link status, never a later active wave');
    assert.equal(scope.segment.respondentBase, 1, 'Repeated attempts do not inflate the authorized aggregate base');
    scope = await resolveResearchScope(pg, uid(2), actor, { iterationId: uid(3), gender: 'Male' });
    assert.equal(scope.segment.respondentBase, 0, 'The authorized empty segment is not widened');
    await assert.rejects(resolveResearchScope(pg, uid(2), actor, { iterationId: uid(3), runId: uid(6) }), { statusCode: 404 });
    await pg.query("UPDATE users SET status='INACTIVE' WHERE id=$1", [actor.id]);
    await assert.rejects(resolveResearchScope(pg, uid(2), actor), { statusCode: 403 });
    await pg.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [actor.id]);
    await pg.query("UPDATE campaigns SET campaign_manager_user_id=NULL WHERE id=$1", [uid(2)]);
    await assert.rejects(resolveResearchScope(pg, uid(2), actor), { statusCode: 404 });
    await assert.rejects(resolveResearchScope(pg, uid(2), { id: uid(9), role_code: 'ADMIN' }), { statusCode: 404 });
    assert.equal((await resolveResearchScope(pg, uid(2), { id: uid(8), role_code: 'ADMIN' })).campaign.id, uid(2), 'The creator retains review of their unassigned campaign');
    await pg.query("INSERT INTO campaign_iteration_links VALUES ($1,$2,'COMPLETED')", [uid(7), uid(3)]);
    await assert.rejects(resolveResearchScope(pg, uid(2), { id: uid(8), role_code: 'ADMIN' }, { iterationId: uid(3) }), { statusCode: 404 });
    console.log('PostgreSQL lightweight scope passed: current role/account, revoked assignment, private drafts, ambiguous links, effective completion, exact Run and distinct filtered base.');
  } finally { await pg.close(); }
}
