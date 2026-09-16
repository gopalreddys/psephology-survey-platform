# Analytics Workspace

Adds the role-scoped API behind the Analytics sidebar page.

The workspace is hierarchical: Campaigns contain Iterations, and detailed analysis remains available from the existing Campaign and Iteration analysis pages.

- Super Admin: all non-archived Campaigns.
- Admin: assigned Campaigns plus unassigned drafts created by that Admin.
- Campaign Manager: Campaigns assigned to that manager.
- Campaigner: no Analytics workspace access.

The overview reports survey coverage and evidence completeness independently:

- successful voter coverage;
- callback coverage;
- transcript coverage for connected calls;
- structured response coverage for connected calls.

Install on the API host:

```bash
node deployment/analytics-workspace/install-analytics-workspace.js \
  /opt/sarvam-voice-analytics
```

Then syntax-check and restart the API.
