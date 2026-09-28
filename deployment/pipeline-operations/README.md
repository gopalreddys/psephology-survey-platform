# Super Admin Platform Health

Read-only system diagnostics and a governed pre-launch checklist for the API,
database, Sarvam catalogue, Iteration configuration, callbacks, evidence
capture, the stale-callback recovery timer and the latest end-to-end
conversation proof. The endpoint remains `GET /api/pipeline`, is authenticated
and restricted to `SUPER_ADMIN`. It does not launch calls, change lifecycle
state, or return webhook payloads, transcripts or voter phone numbers.

The sidebar and page call this workspace **Platform Health**. Its launch status
is one of:

- `READY`: every critical check passes;
- `READY_WITH_WARNINGS`: launch is not blocked, but historical evidence needs
  review;
- `ATTENTION_REQUIRED`: at least one blocking readiness check has failed or is
  stale.

The end-to-end canary is not inferred from a ringing phone or static Greeting.
It requires a connected call with at least four transcript turns, retained
response variables and a `SUCCESS_COMPLETE` normalized outcome. Evidence older
than seven days is stale and blocks bulk-launch readiness until a new controlled
call succeeds.

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

Build and redeploy the frontend using the existing hosting workflow. Then sign
in as Super Admin, open **Platform Health**, and verify that the readiness banner,
eight checklist items and operational diagnostics load. A different role must
receive `403` from the API and cannot see the sidebar entry. No database
migration is required; the endpoint uses the existing voice-agent, Iteration,
call, webhook and lifecycle tables.
