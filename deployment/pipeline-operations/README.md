# Super Admin Platform Health

Read-only system diagnostics and a governed pre-launch checklist for the API,
database, Sarvam catalogue, Iteration configuration, callbacks, evidence
capture, the stale-callback recovery timer and the latest end-to-end
conversation proof. The endpoint remains `GET /api/pipeline`, is authenticated
and restricted to `SUPER_ADMIN`. It does not launch calls, change lifecycle
state, or return webhook payloads, transcripts or voter phone numbers.

## Call workflow issue tracer

Platform Health separates issue information into two deliberately different
views. The **Runtime issue tracer** is a priority queue: it contains only
unresolved conditions that affect the latest attempt of an open Run contact,
unprocessed callbacks, or an open Run with lifecycle drift. A completed or
superseded execution cannot remain in this queue. Normal busy and no-answer
outcomes are never presented as current software bugs.

For each runtime issue the API correlates the launch audit, frozen voice-agent
snapshot, provider acceptance, callback, stored conversation evidence and Run
lifecycle without sending a provider request. It returns the workflow stage,
sanitized evidence, involved programs and functions, preliminary checks, and a
matched previously implemented control that gives operators a proven starting
point. Its deterministic classifications include:

- provider rejection before an attempt ID is issued;
- accepted attempts with callbacks delayed beyond 30 minutes;
- unmatched or unsuccessfully processed webhook events;
- an active latest attempt whose submitted agent identity differs from the
  frozen Iteration snapshot;
- repeated opening-like agent turns inside one provider interaction;
- connected calls missing transcript or structured-response evidence;
- connected conversations that do not meet completion policy;
- overlapping provider starts for one Run contact (sequential governed retries
  are retained as history, not reported as duplicate launches); and
- resolved contacts left inside an open Run.

The separate **Historical issues and implemented controls** view covers the
previous 90 days. Resolved and superseded observations are bucketed by issue
type and workflow functionality. Each bucket shows occurrence count, first and
last observation, the implemented solution, and the deployment packages that
contain the control. Historical rows are not counted as runtime issues or
showstoppers.

The tracer links to existing role-protected call evidence when an active
execution is available. It never returns voter identity or transcript text;
phone-like sequences in diagnostic messages are redacted.

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
eight checklist items, issue tracer and operational diagnostics load. A different role must
receive `403` from the API and cannot see the sidebar entry. No database
migration is required; the endpoint uses the existing voice-agent, Iteration,
call, webhook and lifecycle tables.
