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
- `campaigns.repository.js` → `src/repositories/campaigns.repository.js`
- `campaigns.routes.js` → `src/routes/campaigns.routes.js`
- `campaign-programs.repository.js` → `src/repositories/campaign-programs.repository.js`
- `campaign-programs.routes.js` → `src/routes/campaign-programs.routes.js`

## Register the route

Add this import to `src/server.js`:

```js
import campaignsRoutes from "./routes/campaigns.routes.js";
import campaignProgramsRoutes from "./routes/campaign-programs.routes.js";
```

Register it alongside the other `/api` route modules:

```js
app.use("/api", campaignsRoutes);
app.use("/api", campaignProgramsRoutes);
```

## Apply the migration

Run the included migration after copying the files. It uses the API's existing database connection and the SQL file is idempotent:

```bash
node src/db/migrate-campaign-operations.js
node src/db/migrate-campaign-ownership.js
node src/db/migrate-campaign-program-requirement.js
node src/db/migrate-campaign-survey-stage.js
```

Then restart `psephology-api.service` and verify:

```text
GET  /api/campaigns
GET  /api/campaigns/:id
GET  /api/campaigns/:id/voters
POST /api/campaigns
DELETE /api/campaigns/:id
GET  /api/campaign-programs
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
