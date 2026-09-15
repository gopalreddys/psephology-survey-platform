# Demo release baseline

This read-only utility captures a sanitized, reproducible acceptance report for
one completed Campaign. By default it selects the most recently updated
completed Campaign. Pass `--campaign-id` to select an exact Campaign.

The audit verifies:

- Campaign ownership and completion;
- completed, configured Iterations;
- exactly three closed Runs per Iteration;
- fully resolved, demo-only Run contacts;
- completed executions and recorded callbacks;
- transcripts and response variables for connected calls;
- retained lifecycle events;
- UI revision and SHA-256 fingerprints of critical API files.

It never reads or exports phone numbers, transcript content, response payloads,
callback payloads or secret values.

## Run on the application host

```bash
cd /opt/psephology-survey-ui/psephology

node deployment/demo-release-baseline/test-baseline-evaluation.js

node deployment/demo-release-baseline/capture-demo-release-baseline.js \
  /opt/sarvam-voice-analytics \
  --output=/tmp/psephology-demo-baseline.json
```

To target an exact Campaign:

```bash
node deployment/demo-release-baseline/capture-demo-release-baseline.js \
  /opt/sarvam-voice-analytics \
  --campaign-id=CAMPAIGN_UUID \
  --output=/tmp/psephology-demo-baseline.json
```

The process exits with `0` when every check passes, `2` when the report was
created with one or more failed checks, and `1` when the report could not be
created. Output files are created with mode `0600`.

The JSON report is operational evidence, not a database backup. Create and
record an encrypted RDS snapshot separately using an authorized AWS account.
