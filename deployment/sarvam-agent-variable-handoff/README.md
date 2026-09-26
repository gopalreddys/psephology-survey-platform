# Sarvam agent-variable handoff

This guarded patch fixes the instant-outbound request so per-contact agent
variables are sent inside `app_config`, where Sarvam expects them. Previously
they were nested under `user_config`, causing the `load_runtime_context`
on-start hook to receive an empty `run_contact_id` and preventing the correct
voter name from being loaded.

The V4 patch also removes `null` and `undefined` values and restricts the
outbound payload to the ten input variables registered on
`Political_Agent_Base`: `agent_style_context`, `knowledge_context`,
`preferred_language`, `probe_context`, `questionnaire_context`,
`research_context`, `run_contact_id`, `run_id`, `user_name`, and `voter_id`.
Sarvam rejects the entire request when `agent_variables` contains unregistered
platform-internal fields, even if the registered values are correct. Provider
validation errors retain only safe field locations and messages, making a
future 422 diagnosable without persisting phone numbers or request values.

V4 additionally keeps the live LLM handoff equivalent to the successful
committed-agent phone test. The five large dynamic context variables are sent
with the agent's compact defaults (`Agent style`, `Probe`, or an empty value),
both in the instant-outbound request and in the on-start runtime hook. The full
compiled questionnaire, research context, knowledge and execution correlation
remain frozen in `call_executions.request_payload` and the Iteration snapshot;
they are not deleted or weakened for audit and analytics. This avoids injecting
roughly 11 KB of duplicate runtime instructions before the first generated
agent response.

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
node --check /opt/sarvam-voice-analytics/src/routes/sarvam-runtime.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i \
  http://127.0.0.1:3000/ready
```

Before launching another Run, place one controlled demo call. The corresponding
API log must show a non-empty `run_contact_id`, and the completed callback must
retain the intended `user_name`.

If a provider-rejected execution already occupies the contact's idempotency
key, preview the guarded recovery first and then apply it. Use either the exact
execution ID or a Run ID. Run selection inspects only the newest execution and
still applies every untouched-422 safety check:

```bash
node deployment/sarvam-agent-variable-handoff/recover-provider-rejected-execution.js \
  --execution-id=<execution-uuid>

node deployment/sarvam-agent-variable-handoff/recover-provider-rejected-execution.js \
  --execution-id=<execution-uuid> \
  --apply

node deployment/sarvam-agent-variable-handoff/recover-provider-rejected-execution.js \
  --run-id=<run-uuid>

node deployment/sarvam-agent-variable-handoff/recover-provider-rejected-execution.js \
  --run-id=<run-uuid> \
  --apply
```

The recovery does not delete the failed execution. It archives that execution's
key with a unique suffix, preserving the audit record while allowing the same
pending contact attempt to be submitted again after the client fix is active.
