# Controlled voter demo calls

This module provides an audited, Admin-only path for launching exactly one AI
demonstration call from Voter Data. It is deliberately separate from the
Campaign → Iteration → Run workflow and its records are excluded from research
analytics.

## Safety contract

- Only `SUPER_ADMIN` and `ADMIN` can access the endpoints.
- The voter must be active and have an active phone contact.
- The caller must explicitly confirm that the number is a consented test number.
- A client-generated idempotency key prevents request replay.
- A two-minute per-voter cooldown prevents accidental repeated calls.
- The audit table stores no phone-number snapshot.
- The provider payload is marked `VOTER_MASTER_DEMO` and
  `analytics_excluded: true`.

## Files to copy into the API repository

```bash
cd /opt/psephology-survey-ui/psephology

cp deployment/voter-demo-call/017_voter_demo_calls.sql \
  /opt/sarvam-voice-analytics/sql/

cp deployment/voter-demo-call/migrate-voter-demo-calls.js \
  /opt/sarvam-voice-analytics/src/db/

cp deployment/voter-demo-call/voter-demo-calls.repository.js \
  /opt/sarvam-voice-analytics/src/repositories/

cp deployment/voter-demo-call/voter-demo-call.service.js \
  /opt/sarvam-voice-analytics/src/services/

cp deployment/voter-demo-call/voter-demo-calls.routes.js \
  /opt/sarvam-voice-analytics/src/routes/

cp deployment/voter-demo-call/register-voter-demo-call-route.js \
  /opt/sarvam-voice-analytics/src/db/
```

## Runtime adapter contract

Set `DEMO_CALL_RUNTIME_URL` in the API service environment to an internal HTTPS
endpoint that accepts one call request. Optionally set
`DEMO_CALL_RUNTIME_TOKEN`. The API sends:

```json
{
  "demo_call_id": "uuid",
  "voter_id": "uuid",
  "recipient_name": "Test recipient",
  "phone_number": "+91...",
  "preferred_language": "Telugu",
  "source": "VOTER_MASTER_DEMO",
  "analytics_excluded": true
}
```

The runtime should return HTTP 2xx with `provider_call_id`, `call_id`, or `id`.
It must use its configured default demo agent and must not insert Program,
Campaign, Iteration, Run, survey-response, or analytical records.

## Install and verify

```bash
cd /opt/sarvam-voice-analytics

node src/db/migrate-voter-demo-calls.js
node src/db/register-voter-demo-call-route.js

node --check src/repositories/voter-demo-calls.repository.js
node --check src/services/voter-demo-call.service.js
node --check src/routes/voter-demo-calls.routes.js
node --check src/server.js

sudo systemctl restart psephology-api.service
curl --retry 5 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:3000/health
```

The protected routes are:

```text
POST /api/voters/:voterId/demo-calls
GET  /api/voters/:voterId/demo-calls?limit=10
```

A request without an authenticated token should return `401`; a signed-in
Campaign Manager or Campaigner should receive `403`.
