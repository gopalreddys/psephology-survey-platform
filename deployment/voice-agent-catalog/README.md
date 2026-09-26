# Sarvam voice-agent catalog

This package maintains callable Sarvam Voice Agents in the platform. It synchronizes formal Sarvam deployment records when available and lets an Admin register outbound Agent App configurations when the workspace uses Sarvam Campaigns or Instant Outbound without Deployment records. Each entry is classified as Urban Male, Urban Female, Rural Male or Rural Female. Campaign Managers select one categorized, active outbound Agent App when creating each iteration. The iteration stores an immutable App ID/version/telephony snapshot, and all of its runs inherit that configuration.

## Required API service environment

```text
SARVAM_VOICE_API_KEY=<Voice Agents API key>
SARVAM_ORG_ID=<Sarvam organization id>
SARVAM_WORKSPACE_ID=<Sarvam workspace id>
```

`SARVAM_API_KEY` is accepted as a fallback for the API key. Keep all values in the EC2 service environment; never add them to the frontend or Git.

## Copy and install

From the UI repository root:

```bash
sudo cp deployment/voice-agent-catalog/019_sarvam_voice_agent_catalog.sql /opt/sarvam-voice-analytics/sql/
sudo cp deployment/voice-agent-catalog/migrate-sarvam-voice-agent-catalog.js /opt/sarvam-voice-analytics/src/db/
sudo cp deployment/voice-agent-catalog/sarvam-voice-agents.service.js /opt/sarvam-voice-analytics/src/services/
sudo cp deployment/voice-agent-catalog/voice-agents.repository.js /opt/sarvam-voice-analytics/src/repositories/
sudo cp deployment/voice-agent-catalog/voice-agents.routes.js /opt/sarvam-voice-analytics/src/routes/
sudo cp deployment/voice-agent-catalog/register-voice-agent-routes.js /opt/sarvam-voice-analytics/src/db/
sudo cp deployment/voice-agent-catalog/patch-sarvam-runtime-agent-selection.js /opt/sarvam-voice-analytics/src/db/
sudo cp deployment/campaign-workspace/campaigns.repository.js /opt/sarvam-voice-analytics/src/repositories/
sudo cp deployment/campaign-workspace/campaign-iterations.repository.js /opt/sarvam-voice-analytics/src/repositories/
sudo cp deployment/campaign-workspace/campaign-iterations.routes.js /opt/sarvam-voice-analytics/src/routes/

cd /opt/sarvam-voice-analytics
node src/db/migrate-sarvam-voice-agent-catalog.js
node src/db/register-voice-agent-routes.js
node src/db/patch-sarvam-runtime-agent-selection.js
sudo systemctl restart psephology-api.service
```

Use the Admin **Voice Agents** page to synchronize deployment records or register every committed Agent App ID/version and outbound telephony configuration shown in Sarvam. A catalog entry is iteration-selectable only when it is active, outbound/both, categorized, and has both a connection id and outbound phone number. Campaign Managers have read-only access to this ready catalog; only Admins can synchronize, register, classify or disable agents.

For manually registered Agent Apps, **Edit** lets an Admin update the display name and note in place. Increasing the committed version registers a separate catalog entry and leaves the previous entry intact. Connection ID, outbound number, audience category and App ID are locked during a version change; use the classification control for a category-only correction, or register a separate Agent App when the Sarvam identity or telephony configuration genuinely changes. Existing iteration snapshots and Runs never change automatically. First commit the agent change in Sarvam, then update the platform catalog and explicitly select the new entry for an active Iteration's future calls. Sarvam Deployment API entries remain provider-managed; edit them in Sarvam and use **Sync Deployments**.

The identity guard treats App ID, outbound connection, phone number and audience
category as one controlled configuration. A version edit can only increase the
committed version for the same App ID; it cannot silently change telephony or
move backward. Two enabled Agent Apps with nearly identical names, the same
connection, phone and category are marked as an identity conflict and cannot be
selected until the incorrect App ID is disabled.

Audit the live catalog before the next outbound call. This command is read-only
and does not print voter names, phone numbers or transcript text:

```bash
node deployment/voice-agent-catalog/audit-and-disable-confusable-agent.js \
  /opt/sarvam-voice-analytics
```

After confirming the correct App ID directly in Sarvam, dry-run the reversible
catalog correction. It refuses to disable an App ID assigned to an active
Iteration:

```bash
node deployment/voice-agent-catalog/audit-and-disable-confusable-agent.js \
  /opt/sarvam-voice-analytics \
  --keep-app-id=VERIFIED_APP_ID \
  --disable-app-id=INCORRECT_APP_ID
```

Only then repeat the same command with `--apply`. This disables the incorrect
catalog identity; it does not delete history or alter completed Iteration
snapshots.

To install the edit endpoint on an already deployed API, pull the latest UI repository and run this from its root. The installer checks both existing API files against the known catalog version and makes backups; it stops without overwriting customized files.

No database migration is required. Run `node deployment/voice-agent-catalog/test-voice-agent-edit.js` locally before installation if you want to repeat the edit-flow checks.

```bash
sudo node deployment/voice-agent-catalog/install-voice-agent-edit.js /opt/sarvam-voice-analytics
node --check /opt/sarvam-voice-analytics/src/repositories/voice-agents.repository.js
node --check /opt/sarvam-voice-analytics/src/routes/voice-agents.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Rebuild and deploy the Next.js UI separately for the **Edit** button to appear.

Sarvam's documented Deployment API does not enumerate Agent Apps that exist only in the Build/Campaigns workflow. Those Agent Apps must be registered in the platform catalog using the values shown in Sarvam. This avoids depending on a private dashboard endpoint and allows multiple Agent Apps to coexist safely.

The migration is deliberately re-runnable. Deployments installed before Agent App registration was added should copy the latest SQL and run the same migration runner again.

## API

```text
GET   /api/voice-agents
GET   /api/voice-agents?selectable=true
POST  /api/voice-agents/sync
POST  /api/voice-agents/register
PATCH /api/voice-agents/:id
PATCH /api/voice-agents/:id/config
```

The runtime patch removes the legacy hardcoded App ID/version/connection/phone values and resolves the exact iteration snapshot for every Run contact.
