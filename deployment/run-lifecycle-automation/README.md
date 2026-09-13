# Run lifecycle automation

Stage 1 lifecycle automation makes Sarvam callbacks the authoritative trigger
for Run and Iteration status transitions.

- A Run completes only when every selected contact and call execution is
  terminal.
- Failed voters remain retry eligible after Runs 1 and 2.
- After three terminal Runs, the final unresolved cohort is marked retry
  exhausted.
- An Iteration completes only after Runs 1, 2 and 3 are terminal and no
  callback or contact remains pending.
- Campaign Managers and assigned Campaigners may invoke the idempotent manual
  reconciliation endpoint when validating operational status.

## Deploy

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/run-lifecycle-automation/install-run-lifecycle.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/run-lifecycle.repository.js
node --check src/repositories/sarvam-outbound-webhook.repository.js
node --check src/routes/run-lifecycle.routes.js
node --check src/server.js

node src/db/reconcile-open-runs.js
node src/db/reconcile-open-runs.js --apply

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```

The manual endpoint is `POST /api/runs/:runId/reconcile`. It does not allow a
caller to choose a status; it derives the only valid state from stored contact
and execution outcomes.
