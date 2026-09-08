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
- `harden-run-route-permissions.js` → `src/db/harden-run-route-permissions.js`
- `campaigns.repository.js` → `src/repositories/campaigns.repository.js`
- `campaigns.routes.js` → `src/routes/campaigns.routes.js`
- `campaign-programs.repository.js` → `src/repositories/campaign-programs.repository.js`
- `campaign-programs.routes.js` → `src/routes/campaign-programs.routes.js`

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
```

All endpoints require authentication. Creating campaigns is restricted to Super Admin, Admin and Campaign Manager roles. A campaign must reference an Admin-created research program; the API rejects campaigns without `program_id`.

Campaign visibility is enforced from `req.platformUser`: Admin roles see all campaigns, Campaign Managers see only campaigns they created, and Campaigners see only campaigns assigned to them. Campaigner detail and voter endpoints are limited to assigned work geography.

Only the campaign owner or an Admin can delete a campaign, and deletion is allowed only while the campaign is still `DRAFT`. Active, paused and completed campaigns are retained for audit history.

Voter totals are calculated dynamically from each campaign's selected Mandals and all child geography records. No voter row is copied into campaign tables.

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
- `CAMPAIGN_MANAGER` can create, update and review iterations only for campaigns they created; the campaign must reference an Admin-assigned program.
- `CAMPAIGNER` can view iterations and runs only when a current `campaign_work_allocations` row assigns work to them. Campaigners create execution Runs; they do not create iterations.
- `GET /api/campaigns/:id/iterations` returns the canonical iteration record plus `campaign_id`, stage, status, target sample and run count.
- `POST /api/campaigns/:id/iterations` creates the canonical iteration through the existing iteration service and inserts a row in `campaign_iteration_links` in the same transaction. The service must derive `study_id` from the campaign’s `program_id` and reject a campaign without a verified program.
- `PATCH /api/campaigns/:campaignId/iterations/:iterationId/status` is limited to the owning Campaign Manager and Admin/Super Admin review roles, with valid transitions only (`PLANNED → ACTIVE → PAUSED/COMPLETED`, and `PAUSED → ACTIVE/COMPLETED`).
- Run creation remains protected by the existing iteration/run API and must additionally verify that the caller is a Campaigner with an active allocation inside the linked campaign.

The `campaign_iteration_links` table is deliberately a bridge rather than a second iteration table. This preserves one canonical iteration/run model while making campaign ownership auditable and queryable.

The repository adapter uses the existing `survey_studies` and `program_iterations` tables and creates the iteration plus ownership link in one transaction. Run counts are initially returned as zero by this adapter; connect the existing run repository’s aggregate when the API exposes the run table used by `/api/iterations/:id/runs`.

## Direct iteration access hardening

Copy `iteration-access.repository.js` into the API repository and call `assertIterationAccess(req.params.id, req.platformUser)` at the start of every protected handler for:

- `GET /api/iterations/:id`
- `GET /api/iterations/:id/coverage`
- `GET /api/iterations/:id/questionnaire-analysis`
- `GET /api/iterations/:id/runs`
- `POST /api/iterations/:id/runs`

The helper preserves Admin/Super Admin read access to legacy iterations, restricts Campaign Managers to their own campaign iterations, and requires Campaigners to have an active campaign allocation. The Run repository must call the same helper before selecting voters or creating a Run; hiding the button in the frontend is not an authorization boundary.

## Run ownership and duplicate-work hardening

The Run routes must use this role contract:

- `GET /api/iterations/:iterationId/runs`: all permitted roles may review status after `assertIterationAccess`.
- `POST /api/iterations/:iterationId/runs`: `CAMPAIGNER` only, with an active allocation for the linked campaign.
- `POST /api/runs/:runId/retry-cycle`: assigned `CAMPAIGNER` only.
- `POST /api/runs/:runId/launch`: assigned `CAMPAIGNER` only.

The existing `createInitialRun` query currently selects voters by the whole program jurisdiction. Replace that selection with the caller’s active `campaign_work_allocations` and a recursive `geo_units` scope, plus `local_body_area_geo_mapping` for local-body allocations. Pass `createdBy` into the repository and call `assertIterationAccess` before opening the transaction.

Migration 013 adds unique Run and retry-cycle numbers and a transaction-level advisory lock plus trigger that prevents an active voter from being selected into two active Runs within the same Iteration.

To change the three Run mutation routes to Campaigner-only without manually editing the route file, run this after copying the script:

```bash
node src/db/harden-run-route-permissions.js
```

The script creates a timestamped backup and is idempotent. It changes only the `requireRole` blocks for Run creation, retry-cycle creation and Run launch.
