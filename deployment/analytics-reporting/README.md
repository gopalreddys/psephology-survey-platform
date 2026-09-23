# Aggregate Analytics reporting

Creates `analytics_campaign_run_dashboard_v1`, a non-PII reporting view for a future Amazon QuickSight campaign dashboard.

The view exposes the Campaign → Iteration → Run hierarchy, lifecycle statuses, execution funnel, evidence coverage, average duration and `campaign_manager_user_id` for row-level security. It deliberately excludes voter identity, phone numbers, transcripts and raw response variables.

Install and migrate on the API host:

```bash
node deployment/analytics-reporting/install-analytics-reporting.js \
  /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-analytics-reporting.js
```

For QuickSight, create a SPICE dataset from this view and configure row-level security by `campaign_manager_user_id` or `campaign_id`. Use registered-user embedding for the platform. Do not enable public embedding.

Research-response distributions remain in the native Analytics workspace until response taxonomies and minimum-cell suppression are governed. A geographic heat map also remains deferred until reliable coordinates or administrative boundary mappings are available.
