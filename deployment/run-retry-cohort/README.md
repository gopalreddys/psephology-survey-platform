# Strict retry cohorts

Run 2 and every later Run now freeze every retry-eligible voter from the
immediately preceding Run. Successful, terminal and retry-exhausted voters are
excluded at the API layer. The client-supplied target cannot truncate the retry
cohort.

## Deploy the API change

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/run-retry-cohort/install-run-retry-cohort.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/campaign-voter-selection.repository.js

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```

Deploy the UI normally after pulling the same commit and running
`npm run build`.
