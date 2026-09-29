# Campaign Iteration visibility refresh

The role Dashboard and Campaign detail must use the same governed
`campaign_iteration_links` relationship. A stale API repository can leave the
Dashboard showing valid Iterations while the Campaign detail incorrectly says
that no Iterations exist.

This package refreshes the existing Campaign Iteration repository and routes.
It does not migrate, create, delete or update campaign data. The current
repository grants:

- Super Admin the complete review scope;
- Admin the governed review scope;
- the assigned Campaign Manager access to their Campaign Iterations; and
- Campaigners access only to Iterations with a current work allocation.

## Validate locally

```bash
node deployment/campaign-iteration-visibility/test-campaign-iteration-visibility.js
```

## Install on the API host

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/campaign-iteration-visibility/install-campaign-iteration-visibility.js /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/campaign-iterations.repository.js
node --check src/routes/campaign-iterations.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

After deployment, compare the Iteration count and names on the role Dashboard
with the same Campaign detail page for a Campaign Manager and an allocated
Campaigner.
