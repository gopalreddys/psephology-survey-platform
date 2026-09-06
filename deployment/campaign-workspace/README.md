# Campaign workspace API deployment

This package adds the operational campaign tables and the two endpoints required by the Campaigns page.

## Files to copy into the API repository

- `008_campaign_operations.sql` → `sql/008_campaign_operations.sql`
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

Run the SQL file through the API database connection in one transaction. The file is idempotent and can safely be run again.

Then restart `psephology-api.service` and verify:

```text
GET  /api/campaigns
POST /api/campaigns
```

Both endpoints require authentication. Creating campaigns is restricted to Super Admin, Admin and Campaign Manager roles.

Voter totals are calculated dynamically from each campaign's selected Mandals and all child geography records. No voter row is copied into campaign tables.
