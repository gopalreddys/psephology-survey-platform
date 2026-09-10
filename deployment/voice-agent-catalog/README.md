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

Sarvam's documented Deployment API does not enumerate Agent Apps that exist only in the Build/Campaigns workflow. Those Agent Apps must be registered in the platform catalog using the values shown in Sarvam. This avoids depending on a private dashboard endpoint and allows multiple Agent Apps to coexist safely.

The migration is deliberately re-runnable. Deployments installed before Agent App registration was added should copy the latest SQL and run the same migration runner again.

## API

```text
GET   /api/voice-agents
GET   /api/voice-agents?selectable=true
POST  /api/voice-agents/sync
POST  /api/voice-agents/register
PATCH /api/voice-agents/:id
```

The runtime patch removes the legacy hardcoded App ID/version/connection/phone values and resolves the exact iteration snapshot for every Run contact.
