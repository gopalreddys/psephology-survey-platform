# Voter electorate management

This package completes the election-specific eligibility layer without creating separate voter databases.

It provides Admin/Super Admin APIs to:

- record and verify EPIC, MLC roll, local-body roll and internal demo identifiers;
- register a canonical voter in a Parliamentary, Assembly, MLC, local-body or demo electorate;
- inactivate or reject registrations without deleting history;
- expose the complete identifier and electorate profile to the Voter Data UI.

Run selection always calls `voter_is_eligible_for_campaign`. The existing controlled-demo boundary remains in force, so this deployment does not authorize non-demo provider calls.

## Deployment

The `023_voter_electorate_model.sql` migration must be applied first.

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/voter-electorate-management/install-voter-electorate-management.js /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/voter-electorate.validation.js
node --check src/repositories/voter-electorate.repository.js
node --check src/routes/voter-electorate.routes.js
node --check src/repositories/campaign-voter-selection.repository.js
node --check src/repositories/campaigns.repository.js
node --check src/server.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

## Safety rules

- Write endpoints are restricted to Admin and Super Admin.
- A registration cannot be verified without a matching typed identifier.
- Legislative registrations require a live constituency.
- Local-body registrations require a live local body; an optional area must belong to that body.
- Selection still retains the explicit demo-only call boundary until a separately governed production release enables real-election dialing.
