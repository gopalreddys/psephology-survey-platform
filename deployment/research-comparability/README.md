# Step 1: consistent research comparisons

Analysis, the native Dashboard, Program oversight and Amazon Quick reporting
use `analytics_iteration_comparability_v1` as the sole method gate. Matching
response keys or having two completed Iterations no longer establishes
comparability. The common helper fails closed on an old or missing schema.

Movement requires consecutive Campaign Iterations, recorded frozen questionnaire
identity and compatible declared population, sample frame, sampling/selection,
weighting and fieldwork mode. Missing waves are never bridged. Methodology is
not automatically declared and historical questionnaire identity is not inferred.
The five-response reporting threshold is a disclosure guard, not evidence of
representative sampling or statistical precision.

Native Dashboard trends and Analysis movement apply the same age, gender and
Mandal filters to both waves. Age bands remain 18–29, 30–39, 40–49 and 50+.
Each movement question and trend point requires at least five answered respondents per
wave. Both analysis comparison waves must be completed. Dashboard trends can
show directional in-progress evidence, but stop at missing/incompatible waves
and never project from fewer than two reportable points. Selecting an older
Iteration excludes later waves.

Run selection is operational-only in strategic Analysis; insight cards explicitly
cover all Runs in the selected Iteration, with the latest connected nonempty
structured response per respondent. Invalid scopes are rejected rather than
silently selecting a different Iteration.

Amazon Quick's existing movement dataset is full-Iteration, not demographic-
filtered. Its native quality/movement panel explicitly states that it is
independent of embedded filters. The blueprint declares supported filter scope;
publishing native Quick sheets remains a separate rollout. Suppressed SQL values
remain null in the API/UI, not zero. The scoring and sentiment definitions are
unchanged in this step.

## Install on the existing API

From the checked-out UI repository:

```bash
node deployment/research-comparability/install-research-comparability.js /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-amazon-quick-dashboard.js
node --check src/repositories/research-comparability.repository.js
node --check src/repositories/campaign-analysis.repository.js
node --check src/repositories/analytics-workspace.repository.js
node --check src/repositories/program-dashboard.repository.js
node --check src/repositories/dashboard.repository.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

The coordinated installer backs up existing repositories/server under
`var/deployment-backups/`, updates all dependent repositories and installs SQL
029. The existing migration runner replays its idempotent reporting migrations;
028 also carries the updated view shape so a later rerun cannot drop the new
preceding-Iteration column. No survey records, calls or declarations are modified.
Deploy the changed Next.js UI using the existing Amplify release workflow.
For SPICE datasets, refresh after migration and verify the dataset includes the
updated view results before presenting comparisons. SQL changes do not republish
already-authored Quick visuals or their controls.

## Validate before release

Run the shared, campaign, Analytics, Dashboard, Program and Quick tests below,
then TypeScript/lint and a production UI build.

```bash
node deployment/research-comparability/test-research-comparability.js
node deployment/research-comparability/test-install-research-comparability.js
node deployment/campaign-comparative-analysis/test-campaign-analysis.js
node deployment/campaign-comparative-analysis/test-analysis-installers.js
node deployment/analytics-workspace/test-analytics-workspace.js
node deployment/analytics-workspace/test-analytics-behavior.js
node deployment/analytics-workspace/test-analytics-ui.js
node deployment/role-dashboard/test-role-dashboard.js
node deployment/program-executive-dashboard/test-program-comparability.js
node deployment/amazon-quick-enterprise-dashboard/test-amazon-quick-dashboard.js
```

The optional SQL-engine regression test uses an isolated test-only
`@electric-sql/pglite@0.5.8` installation (no production database connection):

```bash
PGLITE_MODULE_PATH=/absolute/path/to/test/node_modules/@electric-sql/pglite/dist/index.js node deployment/research-comparability/test-shared-comparison-gate-sql.js
```

It covers SQL upgrade/replay, declared methods, provenance, missing evidence,
consecutive wave IDs and four/five-response boundaries. `--legacy-git-head`
also tests the pre-change 028 migration while HEAD still contains that version.

In the UI verify: undeclared/changed instruments suppress movement; identical
filters are named and applied to both waves; a four-response cell is withheld;
an empty/missing intermediate wave does not create a trend; Run selection does
not relabel Iteration insights as Run-only; Program comparable counts match
Campaign Analysis eligibility. Existing historical demo waves can legitimately
remain not comparable until their real design is declared; do not fill guessed
metadata merely to enable a chart.
