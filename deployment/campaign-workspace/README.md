# Campaign workspace API deployment

This package adds the operational campaign tables and secured endpoints required by the Campaigns workspace.

## Files to copy into the API repository

- `008_campaign_operations.sql` → `sql/008_campaign_operations.sql`
- `migrate-campaign-operations.js` → `src/db/migrate-campaign-operations.js`
- `009_campaign_ownership_allocations.sql` → `sql/009_campaign_ownership_allocations.sql`
- `migrate-campaign-ownership.js` → `src/db/migrate-campaign-ownership.js`
- `010_campaign_program_requirement.sql` → `sql/010_campaign_program_requirement.sql`
- `migrate-campaign-program-requirement.js` → `src/db/migrate-campaign-program-requirement.js`
- `011_campaign_survey_stage.sql` → `sql/011_campaign_survey_stage.sql`
- `migrate-campaign-survey-stage.js` → `src/db/migrate-campaign-survey-stage.js`
- `012_campaign_iteration_ownership.sql` → `sql/012_campaign_iteration_ownership.sql`
- `migrate-campaign-iteration-ownership.js` → `src/db/migrate-campaign-iteration-ownership.js`
- `campaign-iterations.repository.js` → `src/repositories/campaign-iterations.repository.js`
- `campaign-iterations.routes.js` → `src/routes/campaign-iterations.routes.js`
- `iteration-access.repository.js` → `src/repositories/iteration-access.repository.js`
- `013_run_deduplication.sql` → `sql/013_run_deduplication.sql`
- `migrate-run-deduplication.js` → `src/db/migrate-run-deduplication.js`
- `run-access.repository.js` → `src/repositories/run-access.repository.js`
- `campaign-voter-selection.repository.js` → `src/repositories/campaign-voter-selection.repository.js`
- `harden-run-route-permissions.js` → `src/db/harden-run-route-permissions.js`
- `harden-run-voter-selection.js` → `src/db/harden-run-voter-selection.js`
- `harden-run-route-access.js` → `src/db/harden-run-route-access.js`
- `assign-test-campaigners.js` → `src/db/assign-test-campaigners.js`
- `harden-user-creation-access.js` → `src/db/harden-user-creation-access.js`
- `014_user_profiles.sql` → `sql/014_user_profiles.sql`
- `015_user_role_changes.sql` → `sql/015_user_role_changes.sql`
- `016_campaign_manager_workflow.sql` → `sql/016_campaign_manager_workflow.sql`
- `migrate-user-profiles.js` → `src/db/migrate-user-profiles.js`
- `migrate-user-role-changes.js` → `src/db/migrate-user-role-changes.js`
- `migrate-campaign-manager-workflow.js` → `src/db/migrate-campaign-manager-workflow.js`
- `user-profiles.repository.js` → `src/repositories/user-profiles.repository.js`
- `user-profiles.routes.js` → `src/routes/user-profiles.routes.js`
- `register-user-profiles-route.js` → `src/db/register-user-profiles-route.js`
- `campaigns.repository.js` → `src/repositories/campaigns.repository.js`
- `campaigns.routes.js` → `src/routes/campaigns.routes.js`
- `campaign-programs.repository.js` → `src/repositories/campaign-programs.repository.js`
- `campaign-programs.routes.js` → `src/routes/campaign-programs.routes.js`
- `reset-demo-operations.js` → `src/db/reset-demo-operations.js`

## Register the route

Add this import to `src/server.js`:

```js
import campaignsRoutes from "./routes/campaigns.routes.js";
import campaignProgramsRoutes from "./routes/campaign-programs.routes.js";
import campaignIterationsRoutes from "./routes/campaign-iterations.routes.js";
```

Register it alongside the other `/api` route modules:

```js
app.use("/api", campaignsRoutes);
app.use("/api", campaignProgramsRoutes);
app.use("/api", campaignIterationsRoutes);
```

## Apply the migration

Run the included migration after copying the files. It uses the API's existing database connection and the SQL file is idempotent:

```bash
node src/db/migrate-campaign-operations.js
node src/db/migrate-campaign-ownership.js
node src/db/migrate-campaign-program-requirement.js
node src/db/migrate-campaign-survey-stage.js
node src/db/migrate-campaign-iteration-ownership.js
node src/db/migrate-run-deduplication.js
```

Then restart `psephology-api.service` and verify:

```text
GET  /api/campaigns
GET  /api/campaigns/:id
GET  /api/campaigns/:id/voters
POST /api/campaigns
DELETE /api/campaigns/:id
GET  /api/campaign-programs
GET  /api/campaigns/:id/iterations
POST /api/campaigns/:id/iterations
PATCH /api/campaigns/:campaignId/iterations/:iterationId/status
GET  /api/campaigns/:campaignId/iterations/:iterationId/allocations
PUT  /api/campaigns/:campaignId/iterations/:iterationId/allocations
PATCH /api/campaigns/:id/manager
```

All endpoints require authentication. Creating campaigns is restricted to Super Admin and Admin roles. A campaign must reference an Admin-created research program; the API rejects campaigns without `program_id`. Admins assign Draft campaigns to Campaign Managers after creation.

Campaign visibility is enforced from `req.platformUser`: Admin roles see all campaigns, Campaign Managers see only campaigns assigned to them, and Campaigners see only campaigns with an active iteration allocation for them. Campaigner detail and voter endpoints are limited to assigned work geography.

Only Admin or Super Admin users can delete a campaign, and deletion is allowed only while the campaign is still `DRAFT`. Active, paused and completed campaigns are retained for audit history.

Voter totals are calculated dynamically from each campaign's selected Mandals and all child geography records. No voter row is copied into campaign tables.

## Reset the demo operational chain

`reset-demo-operations.js` provides a controlled way to restart Program,
Campaign, Iteration and Run testing. Its default mode is read-only. With
`--apply`, it creates a timestamped PostgreSQL backup schema and removes the
linked operational chain in one transaction. Users, roles, geography, voters,
questionnaires and agent profiles are counted before and after and must remain
unchanged or the transaction is rolled back. Unrelated legacy call rows are
preserved.

Stop the API so no new operational record can be written during the reset:

```bash
node src/db/reset-demo-operations.js
sudo systemctl stop psephology-api.service
node src/db/reset-demo-operations.js --apply
sudo systemctl start psephology-api.service
curl -i http://127.0.0.1:3000/health
```

## Program governance contract

The existing Programs API must enforce this role model:

- `SUPER_ADMIN` and `ADMIN` can list, create, update and review all programs.
- `CAMPAIGN_MANAGER` can list only programs assigned to that manager, and cannot create or edit programs.
- `CAMPAIGNER` cannot access the Programs workspace or list programs.
- Program creation must validate `ownerUserId` as an active `CAMPAIGN_MANAGER`.

The campaign form sends the selected program id as `programId`. The Programs list used by Campaign Managers must therefore be filtered server-side by the authenticated manager’s assigned owner id; hiding the navigation item alone is not an access control boundary.

## Campaign iteration governance contract

Campaigns are the operational parent of research iterations. The API must enforce:

- `SUPER_ADMIN` and `ADMIN` can review campaign iterations and program status, but do not create iterations.
- `CAMPAIGN_MANAGER` can create, update and review iterations only for campaigns assigned to them by an Admin; the campaign must reference an Admin-assigned program.
- `CAMPAIGNER` can view iterations and runs only when a current iteration-scoped `campaign_work_allocations` row assigns work to them. Campaigners create execution Runs; they do not create iterations.
- `GET /api/campaigns/:id/iterations` returns the canonical iteration record plus `campaign_id`, stage, status, target sample and run count.
- `POST /api/campaigns/:id/iterations` creates the canonical iteration through the existing iteration service and inserts a row in `campaign_iteration_links` in the same transaction. The service must derive `study_id` from the campaign’s `program_id` and reject a campaign without a verified program.
- `PATCH /api/campaigns/:campaignId/iterations/:iterationId/status` is limited to the owning Campaign Manager and Admin/Super Admin review roles, with valid transitions only (`PLANNED → ACTIVE → PAUSED/COMPLETED`, and `PAUSED → ACTIVE/COMPLETED`).
- Run creation remains protected by the existing iteration/run API and must additionally verify that the caller is a Campaigner with an active allocation inside the exact linked iteration.

The `campaign_iteration_links` table is deliberately a bridge rather than a second iteration table. This preserves one canonical iteration/run model while making campaign ownership auditable and queryable.

The repository adapter uses the existing `survey_studies` and `program_iterations` tables and creates the iteration plus ownership link in one transaction. Run counts are initially returned as zero by this adapter; connect the existing run repository’s aggregate when the API exposes the run table used by `/api/iterations/:id/runs`.

## Direct iteration access hardening

Copy `iteration-access.repository.js` into the API repository and call `assertIterationAccess(req.params.id, req.platformUser)` at the start of every protected handler for:

- `GET /api/iterations/:id`
- `GET /api/iterations/:id/coverage`
- `GET /api/iterations/:id/questionnaire-analysis`
- `GET /api/iterations/:id/runs`
- `POST /api/iterations/:id/runs`

The helper preserves Admin/Super Admin read access to legacy iterations, restricts Campaign Managers to iterations in campaigns assigned to them, and requires Campaigners to have an active allocation for that exact iteration. The Run repository must call the same helper before selecting voters or creating a Run; hiding the button in the frontend is not an authorization boundary.

## Run ownership and duplicate-work hardening

The Run routes must use this role contract:

- `GET /api/iterations/:iterationId/runs`: all permitted roles may review status after `assertIterationAccess`.
- `POST /api/iterations/:iterationId/runs`: `CAMPAIGNER` only, with an active allocation for the linked campaign.
- `POST /api/runs/:runId/retry-cycle`: assigned `CAMPAIGNER` only.
- `POST /api/runs/:runId/launch`: assigned `CAMPAIGNER` only.

The existing `createInitialRun` query currently selects voters by the whole program jurisdiction. Replace that selection with the caller’s active `campaign_work_allocations` and a recursive `geo_units` scope, plus `local_body_area_geo_mapping` for local-body allocations. Run 1 freezes that assigned cohort; later Runs require the immediately preceding Run to be completed and select only its unresolved contacts. Pass `createdBy` into the repository and call `assertIterationAccess` before opening the transaction.

`campaign-voter-selection.repository.js` provides the allocation-scoped query. Import `selectAssignedVoters` into `runs.repository.js` and replace the current `voter_jurisdiction_mapping` selection with:

```js
const selected = await selectAssignedVoters(db, {
  iterationId,
  campaignerUserId: createdBy,
  runNumber,
  targetContacts,
  sourceName
});
```

Then iterate over `selected` directly (`for (const voter of selected)`) and use `selected.length` for the Run and first-cycle counts.

Migration 013 adds unique Run and retry-cycle numbers and a transaction-level advisory lock plus trigger that prevents an active voter from being selected into two active Runs within the same Iteration.

Run waves follow the coverage policy: Run 1 freezes the initial voter cohort, Run 2 contains only unresolved contacts from completed Run 1, and Run 3 contains only unresolved contacts from completed Run 2. The API can continue with later waves when unresolved contacts remain, but it never introduces a fresh unattempted voter into a retry wave or creates an empty retry Run. A `campaign_run_cycle` remains an attempt within one Run; it is not a replacement for the next Run wave.

To change the three Run mutation routes to Campaigner-only without manually editing the route file, run this after copying the script:

```bash
node src/db/harden-run-route-permissions.js
```

The script creates a timestamped backup and is idempotent. It changes only the `requireRole` blocks for Run creation, retry-cycle creation and Run launch.

The remaining Run hardening can be applied without manually editing the backend files:

```bash
node src/db/harden-run-route-access.js
node src/db/harden-run-voter-selection.js
```

Both scripts create timestamped backups and fail before writing if the expected existing route or jurisdiction-wide selection block is not found.

`harden-run-route-access.js` also removes the legacy `requireGeographyAccess`
middleware from the protected Run handlers. Campaign Run authorization is based
on the active `campaign_work_allocations` row for the exact iteration; retaining
the legacy middleware would incorrectly require a second `user_geo_assignments`
record and produce “No active geography assignment” for valid Campaigners.
Re-run the latest script even if an earlier version was applied: the current
version removes both bare middleware references and configured
`requireGeographyAccess({...})` calls, then verifies that no protected Run route
still contains the legacy gate before writing the file.

To grant the three designated test accounts the Campaigner role, copy and run:

```bash
node src/db/assign-test-campaigners.js
```

The script is transactional and idempotent. It verifies that all accounts exist and are active before changing only `users.role_id`; it does not change passwords, user status or geography allocations. Assign each Campaigner to a campaign geography before they create Runs.

To enforce user-creation permissions at the API boundary, copy and run:

```bash
node src/db/harden-user-creation-access.js
```

This restricts `POST /api/users` to `SUPER_ADMIN` and `ADMIN`, creates a timestamped route backup, and is safe to rerun.

User profile storage keeps only masked government-ID metadata and private object-storage keys; raw government ID numbers must not be stored in PostgreSQL. Copy the profile files, run the migration, then register the route without manually editing `src/server.js`:

```bash
node src/db/migrate-user-profiles.js
node src/db/register-user-profiles-route.js
node src/db/migrate-user-role-changes.js
node src/db/migrate-campaign-manager-workflow.js
```

## Role management

The Users page exposes role changes only to `SUPER_ADMIN` and `ADMIN` users. The API endpoint is:

```text
PATCH /api/users/:id/role
Body: { "roleCode": "ADMIN" | "CAMPAIGN_MANAGER" | "CAMPAIGNER" | "SUPER_ADMIN" }
```

Role changes are recorded in `user_role_change_audit`. The API prevents self-role changes, prevents an Admin from modifying or granting the Super Admin role, and prevents demoting the last active Super Admin. The current user is never shown an enabled role selector. Regular users see the role as a read-only badge.

The create-user form applies the same UI restriction: Admins can create Admin, Campaign Manager and Campaigner accounts, while only Super Admins can create another Super Admin. The POST `/api/users` route must remain protected by `requireRole(["SUPER_ADMIN", "ADMIN"])`; enforce the role-grant policy in that route/repository as well when maintaining the API copy.

## Campaign ownership workflow

Campaign ownership is deliberately staged:

1. `SUPER_ADMIN` or `ADMIN` creates the research program and campaign geography.
2. `SUPER_ADMIN` or `ADMIN` assigns the Draft campaign to one active `CAMPAIGN_MANAGER` with `PATCH /api/campaigns/:id/manager`.
3. The assigned Campaign Manager creates the campaign iterations.
4. The assigned Campaign Manager allocates Districts/Mandals or local electoral areas for each iteration with `PUT /api/campaigns/:campaignId/iterations/:iterationId/allocations`.
5. Campaigners see only iterations where they have an active iteration allocation and create the Runs for those areas.

Campaign creation no longer accepts Campaigner allocations. Migration 016 adds campaign-manager ownership and iteration-scoped allocation records while preserving legacy campaign data. Run voter selection and iteration access must use the allocation’s `iteration_id`, so work assigned to one iteration cannot leak into another iteration.
