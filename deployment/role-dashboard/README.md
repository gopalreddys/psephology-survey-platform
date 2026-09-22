# Role-specific Dashboard

Replaces the fixed demo homepage metrics with read-only, role-scoped operational data.

- Super Admin: visible portfolio, ownership gaps, active Runs and evidence exceptions.
- Admin: assigned campaigns and drafts created by that Admin.
- Campaign Manager: assigned Campaigns, Iterations and closeout readiness.
- Campaigner: only actively allocated Campaigns and Iterations, with ready Runs and call follow-up.

The Dashboard never launches calls or changes lifecycle state. It does not infer vote share from demo respondents.

Each role receives a distinct operating brief and decision boundary:

- Super Admin sees platform governance, ownership and evidence exceptions.
- Admin sees campaign administration, assignment readiness and operational exceptions.
- Campaign Manager sees research completion, successful outcomes and evidence readiness.
- Campaigner sees only their execution queue, pending/retry contacts and callback follow-up.

Install on the API host:

```bash
node deployment/role-dashboard/install-role-dashboard.js \
  /opt/sarvam-voice-analytics
```

Then syntax-check the installed files, restart the API and verify `/ready` plus the authenticated `/api/dashboard` endpoint for every role. No database migration is required.
