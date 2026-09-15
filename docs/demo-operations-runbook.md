# Demo operations runbook

This runbook covers the validated controlled demonstration. It does not enable
calling production voters.

## Release baseline

1. Confirm the UI repository is on the approved commit and has no local edits.
2. Confirm the API process and database readiness endpoints return HTTP 200.
3. Run the release baseline auditor for the completed reference Campaign.
4. Create a manual RDS snapshot from an AWS account authorized to manage RDS.
5. Record the commit, snapshot identifier, UTC time and auditor report together.

```bash
cd /opt/psephology-survey-ui/psephology
git status --short --branch
git log -1 --oneline

curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/ready

node deployment/demo-release-baseline/capture-demo-release-baseline.js \
  /opt/sarvam-voice-analytics \
  --output=/tmp/psephology-demo-baseline.json
```

The auditor is read-only and does not include phone numbers, transcripts,
response payloads or secret values. Copy the report to the approved operational
evidence location and remove the temporary copy according to the environment's
retention policy.

`PASS_WITH_WARNINGS` is an acceptable release capture only when each warning is
listed with the snapshot. Historical Iterations without questionnaire identity
may be demonstrated as directional conversation evidence; do not describe their
comparisons as instrument-matched or statistically predictive.

## Demonstration path

1. Sign in as Super Admin and open **Programs**.
2. Open the reference Program and review its Campaign roll-up.
3. Open the completed Campaign and show ownership, Iterations and lifecycle
   activity.
4. Open each Iteration to show three completed Runs and voter outcome coverage.
5. Open Iteration Analysis to review question-level evidence.
6. Open Campaign Analysis to compare thought and sentiment movement across
   Iterations.
7. Return to the Program dashboard for the executive summary.

Do not use reset utilities, create new Runs, rotate credentials or change voice
agents during the demonstration.

## Role demonstration

- Super Admin: full review across Programs and Campaigns.
- Admin: Program and Campaign setup/review; no Run execution.
- Campaign Manager: assigned Campaign, Iteration creation/allocation and
  governed Campaign completion.
- Campaigner: allocated Iterations and Run execution only.

Use separate browser or private sessions when switching roles. A hidden button
is not an authorization test; restricted direct URLs must return 403 or 404.

## Operational recovery

### API is alive but pages cannot load

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/ready
sudo journalctl -u psephology-api.service --since "15 minutes ago" --no-pager
```

`/health` returning 200 with `/ready` returning 503 identifies a database
dependency problem. Allow the credential-resilience layer to reload the managed
secret before restarting the service.

### A provider callback does not arrive

```bash
sudo systemctl start psephology-lifecycle-recovery.service
sudo systemctl show psephology-lifecycle-recovery.service \
  -p Result -p ExecMainStatus
```

Review the stale-callback recovery dry run before applying any manual recovery.
Do not fabricate a callback or directly mark a call successful.

### Rollback

Deployment installers write timestamped backups beside modified API files.
Rollback must target the exact package and backup timestamp. Do not use broad
Git resets or replace the complete API directory.
