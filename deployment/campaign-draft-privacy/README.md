# Private unassigned Campaign drafts

This package enforces the Campaign ownership boundary consistently across API
lists, direct detail access, Iterations, analytics, lifecycle views and Program
oversight:

- Super Admin can review every Campaign.
- An unassigned Campaign is visible only to the Admin who created it and Super Admin.
- Once assigned, Admin users can review the Campaign and only its assigned Campaign Manager can operate it.
- Campaigners continue to receive access only through active iteration work allocations.
- Only the creating Admin or Super Admin can assign an unassigned Campaign.

No database migration is required.

## Deploy

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main
sudo systemctl stop psephology-api.service
node deployment/campaign-draft-privacy/install-campaign-draft-privacy.js \
  /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node --check src/repositories/campaign-visibility.repository.js
node --check src/repositories/campaigns.repository.js
node --check src/repositories/campaign-iterations.repository.js
node --check src/repositories/iteration-access.repository.js
node --check src/repositories/campaign-lifecycle.repository.js
node --check src/repositories/campaign-analysis.repository.js
node --check src/repositories/program-dashboard.repository.js
sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/health
```
