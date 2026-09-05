# Geography explorer API deployment

These are read-only endpoints over the already imported Geography V2 tables. No data is changed or re-imported.

From the UI repository checkout on EC2, copy the files into the API application:

```bash
cp deployment/geography-explorer-api/local-bodies.repository.js /opt/sarvam-voice-analytics/src/repositories/
cp deployment/geography-explorer-api/local-bodies.routes.js /opt/sarvam-voice-analytics/src/routes/
```

Add this import to `/opt/sarvam-voice-analytics/src/server.js`:

```js
import localBodiesRoutes from "./routes/local-bodies.routes.js";
```

Register it beside the other `/api` routes:

```js
app.use("/api", localBodiesRoutes);
```

Restart `psephology-api.service`. The endpoints require an authenticated geography role:

- `GET /api/local-bodies?limit=10000`
- `GET /api/local-bodies/:id/electoral-areas?limit=5000`

ZPTC, MPTC and GP ward results intentionally remain empty until official source rows are imported.
