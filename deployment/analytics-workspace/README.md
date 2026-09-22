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

The Analytics landing page applies a role-specific decision lens without changing data scope:

- Super Admin receives portfolio lifecycle and evidence-governance signals.
- Admin receives delivery progress and data-assurance signals for administered Campaigns.
- Campaign Manager receives respondent coverage and analysis-readiness signals for assigned Campaigns.
- Campaigner remains excluded from portfolio Analytics and uses the execution Dashboard instead.

Phase 1 strategic Campaign analysis adds:

- a directional/demo validity banner;
- comparable Iteration movement;
- questionnaire answer and missing-data performance;
- issue-priority coding;
- candidate awareness and criterion-fit distributions;
- party salience, perceived issue leadership and association visibility;
- deterministic transcript themes with links back to stored call evidence;
- evidence-qualified finding cards.

Install on the API host:

```bash
node deployment/analytics-workspace/install-analytics-workspace.js \
  /opt/sarvam-voice-analytics
```

Then syntax-check and restart the API.
