# Program executive dashboard

Adds an Admin and Super Admin-only Program oversight endpoint. The endpoint
rolls up Campaign ownership, lifecycle, Iteration and Run completion, call
callbacks, transcripts and structured response capture without granting
Admins any Campaign Manager or Campaigner execution controls.

## API deployment

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/program-executive-dashboard/install-program-dashboard.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/program-dashboard.repository.js
node --check src/routes/program-dashboard.routes.js
node --check src/server.js

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```

The UI uses `GET /api/programs/:programId/dashboard`. Campaign Managers and
Campaigners are denied access to this Program-wide intelligence endpoint.
