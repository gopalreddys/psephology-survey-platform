# Campaign comparative analysis

Adds a protected Campaign-level comparison between the latest completed
Iteration and its actual consecutive completed predecessor. It reads normalized response variables, callback status
and transcripts already stored in AWS PostgreSQL. No Sarvam network request is
made while viewing analysis.

The endpoint deliberately reports demo or unweighted results as directional.
The canonical `analytics_iteration_comparability_v1` gate approves declared
questionnaire and research-method compatibility. Shared output keys or matching
questionnaire IDs cannot substitute for the gate, and missing gate metadata fails
closed. Active or missing waves cannot be skipped to create a comparison.

Both endpoints use the latest connected nonempty structured response per identified
voter and Iteration. Measures below five answers in either wave withhold percentage
movement; incompatible methods withhold every movement and largest shift.

The endpoint also reports small bases and respondent overlap so
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

Run fixture behavior tests with `node deployment/campaign-comparative-analysis/test-campaign-analysis.js`
and installer integration tests with `node deployment/campaign-comparative-analysis/test-analysis-installers.js`.
