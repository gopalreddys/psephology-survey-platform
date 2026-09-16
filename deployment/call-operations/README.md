# Call Operations workspace

Adds the role-scoped API behind the Calls sidebar page.

- Super Admin: all call attempts.
- Admin: assigned campaigns plus drafts created by that Admin.
- Campaign Manager: campaigns assigned to that manager.
- Campaigner: only iterations allocated to that Campaigner.

Phone numbers are masked to the last four digits. The list response contains only transcript/response counts; full stored transcript and response variables are loaded on demand for one authorized call.

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/call-operations/install-call-operations.js /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/call-operations.repository.js
node --check src/routes/call-operations.routes.js
node --check src/server.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```
