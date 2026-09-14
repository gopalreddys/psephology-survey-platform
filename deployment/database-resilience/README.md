# Database credential resilience and readiness

This package prevents an RDS-managed password rotation from leaving the API on
a stale PostgreSQL password until its next service restart.

- PostgreSQL authentication error `28P01` retires the stale pool.
- The current managed secret is fetched again through the existing Secrets
  Manager integration.
- One replacement is shared by concurrent failures.
- The failed query or connection acquisition is retried exactly once.
- Other database errors are never retried automatically.
- Checked-out transaction clients are not replayed.
- `GET /ready` verifies the database with `SELECT 1`; `GET /health` remains the
  process liveness check.
- Passwords and secret contents are never written to application logs.

No database migration is required. The installer creates timestamped backups
of the existing `src/db/postgres.js` and, when route registration is required,
`src/server.js` before changing them.

## Deploy

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/database-resilience/install-database-resilience.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/db/resilient-database.js
node --check src/db/postgres.js
node --check src/routes/readiness.routes.js
node --check src/server.js
node src/db/test-database-resilience.js

sudo systemctl start psephology-api.service

curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/ready
```

Expected readiness response:

```json
{"status":"ready","service":"psephology-api","database":"reachable"}
```

## Step 2 role-access acceptance

Complete these checks using separate browser sessions so authentication state
is not reused between roles:

1. Super Admin can review the Program, completed Campaign, Iterations, lifecycle
   history and analysis.
2. Admin can review the assigned Campaign but cannot create or launch Runs.
3. Assigned Campaign Manager can review the completed Campaign and analysis;
   creation, allocation, reassignment and completion actions remain locked.
4. Allocated Campaigner can review the completed Iteration but cannot create or
   launch another Run.
5. A restricted direct Campaign or Iteration URL returns 403/404 rather than
   relying only on hidden navigation.
6. A temporary unassigned Campaign draft is visible only to its creating Admin
   and Super Admin; delete that Draft after the check.

## Controlled rotation acceptance

Perform this only in a maintenance window with an AWS principal authorized to
modify the RDS instance:

1. Confirm `/health`, `/ready` and `/api/me` are successful.
2. Rotate the RDS-managed master secret while the API remains running.
3. Confirm `/ready` recovers without restarting `psephology-api.service`.
4. Confirm `/api/me`, one read-only Campaign request, webhook processing and the
   lifecycle recovery timer still reach PostgreSQL.
5. Inspect logs for one credential-refresh warning and confirm no secret value
   was logged.

The application currently connects as the RDS master user. Replacing it with a
least-privilege application account remains a separate production-hardening
task.
