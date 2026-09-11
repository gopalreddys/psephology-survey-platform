# Controlled voter demo calls

This module provides an audited, Admin-only path for launching exactly one AI
demonstration call from Voter Data. It is deliberately separate from the
Campaign → Iteration → Run workflow and its records are excluded from research
analytics.

## Safety contract

- Only `SUPER_ADMIN` and `ADMIN` can access the endpoints.
- Only voters explicitly classified with `is_demo_contact = true` and without
  a qualification can receive a demo call; the database default is `false`.
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

cp deployment/voter-demo-call/018_voter_demo_contact_flag.sql \
  /opt/sarvam-voice-analytics/sql/

cp deployment/voter-demo-call/migrate-voter-demo-calls.js \
  /opt/sarvam-voice-analytics/src/db/

cp deployment/voter-demo-call/migrate-voter-demo-contact-flag.js \
  /opt/sarvam-voice-analytics/src/db/

cp deployment/voter-demo-call/mark-demo-voters.js \
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

## Sarvam integration

The demo service directly reuses the API's existing
`createInstantOutboundCall` Sarvam client. It defaults to the same Sarvam
application, application version, connection and caller number currently used
by `sarvam-execution.service.js`. No provider secret or API key is duplicated.

The following optional service environment variables allow the demo profile to
be changed later without a code deployment:

```text
SARVAM_DEMO_APP_ID
SARVAM_DEMO_APP_VERSION
SARVAM_DEMO_CONNECTION_ID
SARVAM_DEMO_AGENT_PHONE_NUMBER
SARVAM_DEMO_AGENT_CODE
SARVAM_DEMO_VOICE_CODE
SARVAM_DEMO_QUESTIONNAIRE_CODE
```

The Sarvam request carries `source=VOTER_MASTER_DEMO` and
`analytics_excluded=true`. It does not contain Run, Iteration, Campaign or
Program identifiers. The demo prompt requires transparent AI identification,
neutral questions and immediate termination when the participant asks to stop.

## Install and verify

```bash
cd /opt/sarvam-voice-analytics

node src/db/migrate-voter-demo-calls.js
node src/db/migrate-voter-demo-contact-flag.js
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
GET  /api/voter-demo-contacts
```

A request without an authenticated token should return `401`; a signed-in
Campaign Manager or Campaigner should receive `403`.

## Approve demo voters

Approval uses exact EPIC IDs and never prints phone numbers. Run the utility
without `--apply` first to validate the records, then repeat it with `--apply`:

```bash
cd /opt/sarvam-voice-analytics

node src/db/mark-demo-voters.js DEMO_EPIC_1 DEMO_EPIC_2
node src/db/mark-demo-voters.js --apply DEMO_EPIC_1 DEMO_EPIC_2
```

For the current controlled demo cohort, select the 10 records without a
qualification. The required expected count prevents a changed dataset from
approving more or fewer records accidentally:

```bash
node src/db/mark-demo-voters.js \
  --missing-qualification --expected-count=10

node src/db/mark-demo-voters.js \
  --apply --missing-qualification --expected-count=10
```

Only active voters with active phone contacts and a blank qualification can be
approved. Each change is recorded in `voter_demo_contact_audit`. Qualified
voters remain ineligible even if accidentally flagged or if an administrator
crafts the API request manually.

## Restrict campaign Run calls during the demo

Campaign Run calling has a separate launch path from the single-voter demo-call
endpoint. Apply the same allow-list at cohort selection, launch eligibility and
immediately before Sarvam submission:

```bash
cd /opt/sarvam-voice-analytics

cp deployment/voter-demo-call/enforce-demo-only-run-calls.js src/db/
node src/db/enforce-demo-only-run-calls.js /opt/sarvam-voice-analytics

sudo systemctl restart psephology-api.service
```

The patch supports both the legacy single-selection backend and the newer
initial/retry selection implementation. It is idempotent and creates
timestamped backups. It requires
`is_demo_contact = true`, an active contact and a blank qualification. This
three-layer check protects existing Runs created before the restriction as well
as newly selected Run cohorts.
