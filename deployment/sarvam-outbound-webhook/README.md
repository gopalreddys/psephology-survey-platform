# Sarvam instant-outbound result webhook

This package adds a secret-protected, idempotent callback for Sarvam instant
outbound calls. It records provider outcomes, duration, interaction IDs,
transcripts, final agent variables, normalized Run contact status and response
variables. Demo-voter responses are retained for verification in
`calls.response_variables` only; they are not inserted into analytical
`survey_responses`.

Sarvam only sends a result when the create-call request contains
`webhook_config.url`. The installer makes `src/clients/sarvam.js` use
`SARVAM_OUTBOUND_WEBHOOK_URL` by default.

## Deploy

Run from the UI repository on the API server:

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service

node deployment/sarvam-outbound-webhook/install-sarvam-outbound-webhook.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/clients/sarvam.js
node --check src/routes/sarvam-outbound-webhook.routes.js
node --check src/repositories/sarvam-outbound-webhook.repository.js
node --check src/db/finalize-resolved-runs.js
node --check src/server.js
node src/db/migrate-sarvam-outbound-webhook.js
```

Create a high-entropy callback token. Replace `https://API_PUBLIC_HOST` with the
public HTTPS origin that routes to this Express API; do not use localhost.

```bash
WEBHOOK_TOKEN="$(openssl rand -hex 32)"
sudo sh -c "printf '\nSARVAM_OUTBOUND_WEBHOOK_TOKEN=%s\nSARVAM_OUTBOUND_WEBHOOK_URL=https://API_PUBLIC_HOST/api/sarvam/outbound-results/%s\n' '$WEBHOOK_TOKEN' '$WEBHOOK_TOKEN' >> /etc/psephology-api.env"
unset WEBHOOK_TOKEN
sudo systemctl daemon-reload
sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/health
```

The token is deliberately not printed. Ensure the systemd service loads
`/etc/psephology-api.env`. Treat the full webhook URL as a secret and redact it
from proxy access logs.

## Verify before placing a real call

```bash
sudo systemctl show psephology-api.service -p EnvironmentFiles
API_PID="$(sudo systemctl show psephology-api.service -p MainPID --value)"
sudo tr '\0' '\n' < "/proc/$API_PID/environ" \
  | cut -d= -f1 \
  | grep '^SARVAM_OUTBOUND_WEBHOOK_' \
  | sort -u
unset API_PID

grep -nE 'SARVAM_OUTBOUND_WEBHOOK_V1|sarvamOutboundWebhookRoutes' \
  src/clients/sarvam.js src/server.js

curl -i -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:3000/api/sarvam/outbound-results/not-the-token
```

The environment check must print both configured variable names. The route
probe must return `404 Not Found`; that proves the public route exists while an
invalid secret cannot use it.

The callback is intentionally unauthenticated by Cognito. It is protected by
the high-entropy path token and also requires correlation to an existing
`call_executions.provider_attempt_id` before operational records are changed.
An unmatched attempt returns a retryable HTTP 503 so a callback arriving before
the provider attempt ID is committed cannot be silently lost.

## Validate a completed call

After placing one approved demo call, query the most recent result:

```sql
SELECT
  execution.provider_attempt_id,
  execution.status AS execution_status,
  execution.callback_received_at,
  call.connectivity_status,
  call.duration_seconds,
  call.interaction_id,
  jsonb_array_length(call.interaction_transcript) AS transcript_turns,
  jsonb_object_length(call.response_variables) AS response_variables,
  contact.attempt_status,
  contact.final_status,
  contact.retry_eligible
FROM call_executions execution
LEFT JOIN calls call
  ON call.attempt_id = execution.provider_attempt_id
LEFT JOIN campaign_run_contacts contact
  ON contact.id = execution.run_contact_id
ORDER BY execution.created_at DESC
LIMIT 10;
```

For event-level diagnostics:

```sql
SELECT attempt_id, delivery_status, error_message, received_at, processed_at
FROM sarvam_outbound_webhook_events
ORDER BY received_at DESC
LIMIT 20;
```

The call made before this feature was configured cannot generate a new webhook
automatically. Recover it through Sarvam Analytics using its provider attempt
ID. The command loads the same protected environment used by the API service:

```bash
sudo bash -c '
  set -a
  source /etc/psephology-api.env
  set +a
  cd /opt/sarvam-voice-analytics
  exec /usr/bin/node src/db/reconcile-sarvam-outbound-attempt.js \
    271d8c05-4b27-4850-b3aa-8f06691736f7 \
    2026-09-11T07:30:00Z \
    2026-09-11T08:30:00Z
'
```

The utility retrieves the authoritative Sarvam attempt and transcript and
passes them through the same idempotent callback processor. It can be safely
re-run with the same attempt ID.

## Finalize Runs completed before automatic roll-up was installed

Every new callback now checks the complete Run cohort. The final callback
closes the active cycle and Run only when no selected contact remains pending
or submitted. The Run-level advisory lock prevents concurrent final callbacks
from missing the roll-up.

When the final callback closes Run 3, the same transaction also exhausts any
remaining retry-eligible contacts and marks the linked Iteration completed.
The completed Iteration becomes read-only without requiring a separate manual
closeout action.

Use the repair utility once for Runs whose callbacks were processed before
this behavior was deployed. It is read-only without `--apply`:

```bash
cd /opt/sarvam-voice-analytics
node src/db/finalize-resolved-runs.js
node src/db/finalize-resolved-runs.js --apply
```
