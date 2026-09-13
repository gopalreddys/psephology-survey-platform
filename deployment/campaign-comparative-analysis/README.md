# Campaign comparative analysis

Adds a protected Campaign-level comparison across the two most recent
completed Iterations. It reads normalized response variables, callback status
and transcripts already stored in AWS PostgreSQL. No Sarvam network request is
made while viewing analysis.

The endpoint deliberately reports demo or unweighted results as directional.
It detects questionnaire compatibility, small bases and respondent overlap so
panel/recontact evidence is not presented as an independent repeated
cross-section or as predictive polling.

## API deployment

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/campaign-comparative-analysis/install-campaign-analysis.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/campaign-analysis.repository.js
node --check src/routes/campaign-analysis.routes.js
node --check src/server.js

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```

The UI uses `GET /api/campaigns/:campaignId/analysis`. Access is read-only for
Admin and Super Admin, and limited to the assigned Campaign Manager. Campaigners
cannot access cross-Iteration Campaign intelligence.
