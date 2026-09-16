# Super Admin Pipeline

Read-only system diagnostics for callbacks, Sarvam webhook events, evidence capture, and the stale-callback recovery timer. The endpoint is `GET /api/pipeline`, authenticated and restricted to `SUPER_ADMIN`. It does not launch calls, change lifecycle state, or return webhook payloads or voter phone numbers.

The API reads the systemd timer and service on the API host with fixed `systemctl show` arguments. If systemd is unavailable, the timer is reported as **unknown**, not healthy. A timer in `waiting` state proves only that it is scheduled; inspect the last service result and a consented end-to-end test for actual delivery health. A quiet webhook feed is shown as idle activity, not proof that callbacks are working.

Install on EC2 after pulling this commit into the UI repository:

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/pipeline-operations/test-pipeline.js
node deployment/pipeline-operations/install-pipeline.js /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node --check src/repositories/pipeline.repository.js
node --check src/routes/pipeline.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Build and redeploy the frontend using the existing hosting workflow. Then sign in as Super Admin, open **Pipeline**, and verify that the diagnostics load. A different role must receive `403` from the API and cannot see the sidebar entry. No database migration is required; the endpoint uses the previously installed webhook and lifecycle tables.
