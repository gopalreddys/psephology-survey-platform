# Campaign workspace API deployment

This package adds the operational campaign tables and secured endpoints required by the Campaigns workspace.

## Files to copy into the API repository

- `008_campaign_operations.sql` → `sql/008_campaign_operations.sql`
- `migrate-campaign-operations.js` → `src/db/migrate-campaign-operations.js`
- `009_campaign_ownership_allocations.sql` → `sql/009_campaign_ownership_allocations.sql`
- `migrate-campaign-ownership.js` → `src/db/migrate-campaign-ownership.js`
- `campaigns.repository.js` → `src/repositories/campaigns.repository.js`
- `campaigns.routes.js` → `src/routes/campaigns.routes.js`

## Register the route

Add this import to `src/server.js`:

```js
import campaignsRoutes from "./routes/campaigns.routes.js";
```

Register it alongside the other `/api` route modules:

```js
app.use("/api", campaignsRoutes);
```

## Apply the migration

Run the included migration after copying the files. It uses the API's existing database connection and the SQL file is idempotent:

```bash
node src/db/migrate-campaign-operations.js
node src/db/migrate-campaign-ownership.js
```

Then restart `psephology-api.service` and verify:

```text
GET  /api/campaigns
GET  /api/campaigns/:id
GET  /api/campaigns/:id/voters
POST /api/campaigns
```

All endpoints require authentication. Creating campaigns is restricted to Super Admin, Admin and Campaign Manager roles.

Campaign visibility is enforced from `req.platformUser`: Admin roles see all campaigns, Campaign Managers see only campaigns they created, and Campaigners see only campaigns assigned to them. Campaigner detail and voter endpoints are limited to assigned work geography.

Voter totals are calculated dynamically from each campaign's selected Mandals and all child geography records. No voter row is copied into campaign tables.
