# Explicit Run contact selection

Campaigners can select one or more named pending demo voters in the Run launch
preview instead of relying on database ordering. The browser submits immutable
`campaign_run_contacts.id` values, and the API applies the same IDs to its
eligible-contact query before creating executions.

The API rejects the batch with HTTP 409 if any selected contact has become
ineligible since the preview was loaded. This prevents a different voter from
being substituted when two Campaigners act at the same time or a callback
changes Run state.

## Test locally

```bash
node deployment/run-contact-selection/test-run-contact-selection.js
npm run lint
npm run build
```

## Install on EC2

From the UI repository:

```bash
node deployment/run-contact-selection/install-run-contact-selection.js \
  /opt/sarvam-voice-analytics
```

Then validate and restart the API:

```bash
cd /opt/sarvam-voice-analytics
node --check src/routes/runs.routes.js
node --check src/services/run-launch.service.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/ready
```
