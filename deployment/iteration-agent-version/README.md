# Iteration agent-version control

Adds a governed Campaign Manager action to move an active Iteration to a newer
committed version of the same Sarvam Agent App. The change applies only to
future calls. Every prior execution retains its original provider-deployment
snapshot in `call_executions.request_payload`.

The API rejects the change when the Campaign Manager is not assigned to the
Campaign, the Campaign or Iteration is closed, calls are active, the target is
not newer, the App ID changes, or telephony/category settings differ.

```bash
node deployment/iteration-agent-version/test-iteration-agent-version.js
node deployment/iteration-agent-version/install-iteration-agent-version.js /opt/sarvam-voice-analytics
node --check /opt/sarvam-voice-analytics/src/repositories/iteration-agent-version.policy.js
node --check /opt/sarvam-voice-analytics/src/repositories/campaign-iterations.repository.js
node --check /opt/sarvam-voice-analytics/src/routes/campaign-iterations.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

After the frontend build is deployed, the assigned Campaign Manager sees
**Change agent version** on any open Iteration with a newer selectable version.
Confirming the action records the previous version and actor in the Iteration
snapshot and preserves all earlier executions unchanged.
