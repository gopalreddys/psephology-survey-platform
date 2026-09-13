# Program lifecycle governance

This package completes the role-separated operational hierarchy:

- Campaign Managers complete Campaigns after every governed Iteration and Run is resolved.
- Admin and Super Admin users can review Program readiness.
- A Program can be completed only after every non-archived Campaign is formally completed and no operational blocker remains.
- Program completion is stored in the immutable lifecycle audit trail.
- Completed Programs reject creation of additional Campaigns at the API boundary.

The Campaign lifecycle governance migration (`021_operational_lifecycle_audit.sql`)
must already be installed before this package is deployed.

## Deploy

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main
sudo systemctl stop psephology-api.service
node deployment/program-lifecycle-governance/install-program-lifecycle.js \
  /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-program-lifecycle.js
node --check src/repositories/program-dashboard.repository.js
node --check src/routes/program-dashboard.routes.js
node --check src/server.js
sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```
