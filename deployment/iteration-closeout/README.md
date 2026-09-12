# Governed Iteration closeout

The closeout workbench consolidates unique voter outcomes and Run-by-Run call,
callback and transcript counts. Only the assigned Campaign Manager may complete
an Iteration. The API blocks completion while Runs or callbacks are still open,
or while another retry Run is required. Remaining failures after Run 3 are
recorded as retry-exhausted during closeout.

Campaigner allocation may be changed between completed Runs. Allocation is
locked while a Run or callback is active, and permanently locked after the
three-Run cycle completes. Reassignment affects only subsequent Runs; historic
Run ownership and evidence remain unchanged for auditability.

## Deploy

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/iteration-closeout/install-iteration-closeout.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/iteration-closeout.repository.js
node --check src/routes/iteration-closeout.routes.js
node --check src/server.js

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```

Deploy the UI from the same commit after `npm run build` succeeds.
