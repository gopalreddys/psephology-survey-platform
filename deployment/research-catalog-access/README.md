# Research catalog access governance

The canonical Voter Master contains direct identifiers and contact details, and
the questionnaire library controls the research instrument used by future
Iterations. Those two workspaces are therefore limited to `SUPER_ADMIN` and
`ADMIN` users.

Campaign Managers continue to select an approved questionnaire through the
campaign-specific Iteration endpoint. Campaigners continue to receive only
their allocated Iterations, masked Run contacts and execution evidence.

The frontend removes both sidebar entries for Campaign Manager and Campaigner
roles and rejects direct page navigation. The installer adds the same Admin-only
guard to the existing voter and questionnaire routers so hiding a link is never
treated as the authorization boundary.

## Validate locally

```bash
node deployment/research-catalog-access/test-research-catalog-access.js
```

## Install on the API host

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/research-catalog-access/install-research-catalog-access.js /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/routes/voters.routes.js
node --check src/routes/questionnaires.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

After deployment, verify that Admin and Super Admin can use both workspaces and
that authenticated Campaign Manager and Campaigner requests to `/api/voters`,
`/api/voters/summary` and `/api/questionnaires` receive `403`.
