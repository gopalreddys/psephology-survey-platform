# Sarvam agent-variable handoff

This guarded patch fixes the instant-outbound request so per-contact agent
variables are sent inside `app_config`, where Sarvam expects them. Previously
they were nested under `user_config`, causing the `load_runtime_context`
on-start hook to receive an empty `run_contact_id` and preventing the correct
voter name from being loaded.

The V2 patch also removes `null` and `undefined` values before submission.
Sarvam validates every supplied agent-variable value, so optional database
fields must be omitted rather than sent as JSON `null`. Provider validation
errors now retain only safe field locations and messages, making a future 422
diagnosable without persisting phone numbers or request values.

The change does not place a call. It preserves a timestamped copy of the
previous client and is safe to run repeatedly.

## Verify locally

```bash
node deployment/sarvam-agent-variable-handoff/test-sarvam-agent-variable-handoff.js
```

## Install on the API host

From the checked-out UI repository:

```bash
node deployment/sarvam-agent-variable-handoff/install-sarvam-agent-variable-handoff.js \
  /opt/sarvam-voice-analytics
```

Then verify and restart the API:

```bash
node --check /opt/sarvam-voice-analytics/src/clients/sarvam.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i \
  http://127.0.0.1:3000/ready
```

Before launching another Run, place one controlled demo call. The corresponding
API log must show a non-empty `run_contact_id`, and the completed callback must
retain the intended `user_name`.

If a provider-rejected execution already occupies the contact's idempotency
key, preview the guarded recovery first and then apply it:

```bash
node deployment/sarvam-agent-variable-handoff/recover-provider-rejected-execution.js \
  --execution-id=<execution-uuid>

node deployment/sarvam-agent-variable-handoff/recover-provider-rejected-execution.js \
  --execution-id=<execution-uuid> \
  --apply
```

The recovery does not delete the failed execution. It archives that execution's
key with a unique suffix, preserving the audit record while allowing the same
pending contact attempt to be submitted again after the client fix is active.
