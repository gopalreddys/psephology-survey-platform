# Run bulk launch with voter preview

Campaigners can review the exact pending demo voters before submitting up to
50 calls through the existing Run launch endpoint. The preview returns the
voter name, geography, language and only the final four phone digits.

The API independently re-checks campaign allocation and demo-voter eligibility.
The existing launch service remains the authority for reserving and submitting
eligible contacts.

Completed, failed, cancelled and archived Runs are read-only. Their preview and
launch endpoints return HTTP 409, while the UI keeps Review & Launch visibly
disabled so a frozen completed cohort cannot be submitted again.

## Deploy the API addition

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/run-bulk-launch/install-run-bulk-launch.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/run-launch-preview.repository.js
node --check src/repositories/run-access.repository.js
node --check src/routes/run-launch-preview.routes.js
node --check src/server.js

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```

Deploy the UI normally after pulling the same commit and running `npm run build`.
