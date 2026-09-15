# Demo release baseline

This read-only utility captures a sanitized, reproducible acceptance report for
one completed Campaign. By default it selects the most recently updated
completed Campaign. Pass `--campaign-id` to select an exact Campaign.

The audit verifies:

- Campaign ownership and completion;
- completed Iterations with recorded voice-agent identity;
- recorded questionnaire identity, with an explicit warning when historical
  Iterations lack it;
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

The process exits with `0` for `PASS` or `PASS_WITH_WARNINGS`, `2` when the
report contains one or more failed checks, and `1` when the report could not be
created. Output files are created with mode `0600`.

## Preserve the EC2 report

`/tmp` is not a durable evidence location. After reviewing the generated
report, archive it on the EC2 application's persistent volume without
overwriting an existing archive:

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/demo-release-baseline/archive-demo-release-baseline.js \
  /tmp/psephology-demo-baseline.json \
  /opt/sarvam-voice-analytics/var/demo-release-baselines
```

The script accepts only a regular, successful baseline report, creates a
timestamped, campaign-specific file with mode `0600`, and verifies SHA-256.
Record the printed path and checksum in the release log. The local archive
survives ordinary `/tmp` cleanup, but is **not** an off-host backup; copy it to
an approved encrypted evidence store if long-term disaster recovery is
required. An RDS snapshot protects the database separately and does not
include this JSON file.

Missing historical questionnaire identity must not be backfilled by guessing.
The retained transcripts and final agent variables still support a directional
demo, but instrument-level comparisons and predictive claims require a proven
questionnaire/version snapshot for each Iteration. Record the warning alongside
the snapshot and resolve the creation workflow before future live research.

The JSON report is operational evidence, not a database backup. Create and
record an encrypted RDS snapshot separately using an authorized AWS account.
