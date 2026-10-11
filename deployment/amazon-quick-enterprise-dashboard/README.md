# Amazon Quick enterprise dashboard

This deployment adds a governed, non-PII research dataset and an authenticated
Amazon Quick Sight embedding endpoint. Quick Sight is the BI capability within
Amazon Quick. The platform dashboard remains the operational fallback while
the enterprise dashboard is authored and published in AWS.

## What leadership will see

For this demo, sparse test responses and unavailable values are acceptable;
technical dataset/session failures are not. The report-to-source coverage and
remaining collection contracts are documented in
[`docs/demo-dashboard-readiness.md`](../../docs/demo-dashboard-readiness.md).
This is a reporting capability preview, not a representative survey or evidence
that every desired report has an implemented extraction field.

- leadership overview: separate unique-participant and respondent–Iteration
  observation bases, recorded party salience, candidate impression, issue
  leadership, issue priorities, incumbent performance assessment and issue
  answer coverage;
- demographic pulse: the age bands 18–29, 30–39, 40–49 and 50+, age-band
  incumbent assessment, gender composition, party salience by gender, issue
  priorities and candidate impression by age/gender, and an age–gender
  participation heat table;
- geographic intelligence: constituency and Mandal count-intensity heat tables,
  issue priorities, candidate impression and incumbent assessment by Mandal,
  Mandal–Iteration evidence coverage, and a party-filtered Mandal observation
  map over Amazon Quick's native base-map layer;
- Iteration movement: qualified descriptive positive incumbent-assessment and
  candidate-impression changes, standalone wave bases and withheld-change reasons;
- research quality: connection, transcript and structured-output coverage,
  demographic completeness, fieldwork dates and a qualified evidence status;
- Measurement guide: source, counting base, filter scope and limitations for
  each chart, available as a tab even when no data is reportable, and through
  the native **How it's measured** data-point menu when supported.

`quick-insight-catalog.mjs` adds ten demographic, geographic and answer-coverage
charts using existing governed v2 columns. Titles and captions stay concise;
detailed explanations live on the sixth Measurement guide sheet. Demographic
charts show counts, and darker heat-table cells mean more observations, not
stronger opinion. Larger sampled groups can therefore have larger counts.
Candidate awareness, candidate suitability and development outcomes are
unavailable in these governed sources and are not inferred or filled in.
The catalog introduces no personal details, source extraction or forecasts.

Admin and Super Admin users can declare the target population, sample frame,
sampling method, selection method, weighting approach and fieldwork mode for
each Iteration. The platform compares those declarations with the questionnaire
snapshot before exposing change from the previous Iteration. A failed gate
suppresses the movement value instead of presenting incomparable waves as a
trend.

The research quality status describes operational evidence completeness. It is
not a statistical confidence level, margin of error or election forecast. The
deterministic authoring specification is in
`quick-dashboard-blueprint.json`. After filters, a displayed research cell must
contain at least **five distinct people**, not merely five repeated-wave
observations. Pooled charts count respondent–Iteration observations; only the
separate unique-participant KPI deduplicates people across waves. Do not
describe an unweighted demo result as an election forecast.

## Standardized output labels and answer bases (Step 2)

Migration `030_normalized_output_reporting.sql` adds normalized **v2** research,
geographic and movement views. Their party, candidate, issue and leadership
labels use the same audited `normalization-rules.json` as native Analysis and
Dashboard reporting. Raw source values remain in privileged call records;
stored responses are never overwritten. Public BI views expose the selected
source key and normalization version, but never raw free-text answers, which
could incidentally contain personal information. Multiple, negated or unrecognized
answers remain explicitly uncoded rather than becoming a guessed preference.

“No response,” “Can't say,” “Declined to answer,” “None” and “Uncoded response”
are distinct. A percentage denominator includes **all non-missing recorded
answers**, including explicit uncertainty, declined and uncoded answers; missing
answers are counted separately. Always show the filtered answer base next to
percentages. Sentiment and candidate shares, and their adjacent-wave changes,
are unavailable below five answered values for that measure in each required
wave. No party mention is converted into an inferred rating. With migration
032 applied, the sentiment construct is **incumbent performance assessment
only**, from `incumbent_assessment`. Candidate impression uses only
`candidate_impression`, `candidate_sentiment` and `veeresh_impression`; criterion
fit remains separate and never supplies a missing impression. Mixed remains
distinct from Neutral. No response is excluded from the construct mix and
reported in separate missing-answer cards.

The governed authoring generator uses count-only charts, not auto-renormalized
pie percentages: suppressing a small category must not silently change a valid
denominator. Its conditional answer keys count non-missing observations, while
the corresponding respondent keys enforce the five-distinct-person minimum.
Repeated participation in three Iterations does not turn two people into a
reportable cell of six people.

The legacy direct-rating field combines generic and BRS-specific aliases but
does not identify the measurement's target party. The leadership publication
therefore omits average direct-rating, party-strength movement and numeric
party-strength maps. Party salience is recorded mention/attention, not vote
choice or inferred alignment.

The platform's native enterprise evidence panel uses the v2 movement view.
The authoring blueprint targets v2 datasets, but installing/migrating the API
**does not republish existing Amazon Quick datasets or dashboards**. Existing
v1 assets remain intact until an explicitly approved authoring/publication
step is verified. The transition staged separate governed v2 datasets and kept
published version **3** live until replacement checks passed. The existing
dashboard is now published as version **7**; see the dated publication evidence
below. The historical source datasets were not mutated as a shortcut.

Local regressions:

```bash
node deployment/amazon-quick-enterprise-dashboard/test-amazon-quick-dashboard.js
node deployment/amazon-quick-enterprise-dashboard/test-quick-publication-plan.mjs
node deployment/amazon-quick-enterprise-dashboard/test-quick-insights.mjs
PGLITE_MODULE_PATH=/path/to/pglite/dist/index.js \
  node deployment/amazon-quick-enterprise-dashboard/test-normalized-output-sql.js
```

The SQL test runs isolated PostgreSQL-compatible fixtures, shared JavaScript/SQL
normalization parity, answer denominators, missing-wave/minimum-base safeguards
and the complete migration replay. It never connects to live RDS.

## Install on the API host

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/amazon-quick-enterprise-dashboard/install-amazon-quick-dashboard.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
npm install --save @aws-sdk/client-quicksight
node src/db/migrate-amazon-quick-dashboard.js
node src/jobs/sync-telangana-boundaries.js
node src/jobs/sync-telangana-boundaries.js --apply
node --check src/routes/amazon-quick-dashboard.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

## Configure Amazon Quick Sight

1. Enable Quick Sight Enterprise in `ap-south-1`.
2. Add the RDS PostgreSQL data source through a VPC connection and grant the
   Quick Sight security group database access. Prefer a reporting/read replica.
3. Create SPICE datasets from `analytics_research_enterprise_v2`,
   `analytics_research_geographic_v2`, `analytics_research_quality_v1` and
   `analytics_iteration_movement_v2`. Add
   `analytics_iteration_comparability_v1` to the Research quality sheet.
4. Save recoverable dataset, analysis and published-dashboard definitions.
   Stage the governed datasets, run a **FULL SPICE refresh**, and author the
   six sheets using `quick-publication-definition.mjs`. Preserve the existing
   dashboard identity and embedding integration. Inspect the candidate version
   before a separate verified publication operation; an API update is not a
   publication or live QA sign-off.
5. Create a Quick Sight Reader for the leadership preview and share the
   dashboard with that Reader.
6. Allow-list the Amplify/custom application domain for embedding.
7. Add the following variables to `/etc/psephology-api.env`:

```dotenv
QUICKSIGHT_REGION=ap-south-1
QUICKSIGHT_AWS_ACCOUNT_ID=123456789012
QUICKSIGHT_DASHBOARD_ID=psephology-enterprise-leadership
QUICKSIGHT_READER_USER_ARN=arn:aws:quicksight:ap-south-1:123456789012:user/default/psephology-leadership-reader
QUICKSIGHT_ALLOWED_DOMAINS=https://your-platform.example.com
```

For an authenticated internal-only preview, a one-click embed can be used
instead by setting `QUICKSIGHT_ONE_CLICK_EMBED_URL`. Do not use public
embedding.

## Governed authoring and publication

`quick-publication-plan.mjs` supplies offline request and guard helpers;
`quick-publication-definition.mjs` builds the six-sheet candidate using
`quick-insight-catalog.mjs`. They are
authoring specifications, not evidence that a cloud change is complete. Keep
the verified import-only Data Prep graphs and their column IDs, and retain the
map dataset's latitude/longitude geographic tags. Complex transforms require
explicit review rather than silent replacement.

Bind party colors to the named category, never the position in a palette:

| Recorded party | Color |
| --- | --- |
| BRS | Pink `#E91E8F` |
| BJP | Saffron `#FF9933` |
| Congress | Green `#138808` |

These are party-category colors; sentiment colors remain a separate convention.
An absent party is not populated with a dummy respondent or synthetic zero.
Sparse results must remain empty/withheld with an explanation.

Enterprise suppression targets numeric `distinctCountOver` calculated fields at
`PRE_AGG`, partitioned by each visual's exact category/color or heat-map cells.
The source is the conditional unique-person key, not the observation key.
Normal controls apply before these windows; the numeric range filter then
withholds cells below five people. Do not point a numeric range directly at a
STRING key even with a `DISTINCT_COUNT` aggregation: AWS rejects that form.

Current demo ingestion is **manual FULL SPICE refresh**. There is no verified
incremental refresh schedule. Aggregate movement, methodology and quality
sources can change without a new response timestamp, so do not configure an
incremental lookback without checking its correctness. Record the successful
import time and zero-skipped-row result before presentation.

Require saved recovery definitions, exact candidate validation, completed
SPICE ingestions, successful AWS visual validation and live filter/small-base
checks before the separate published-version update. Preserve published
version 3 during staging. Disable underlying/detail exports, retain the
Admin/Super Admin application restriction, and verify the existing authenticated
embed after publication. No IAM, sharing or public-embedding change is implied.

For an insight-only revision, `prepare-quick-insights.mjs PREVIOUS_STAGED_BUNDLE
NEW_OUTPUT_JSON` reuses the existing verified staging bindings and writes a new
offline candidate. It creates no datasets and refuses to overwrite its output.
This preparation is not AWS API validation, a data refresh or publication.
Measurement notes are split into bounded text boxes because Quick grid elements
allow at most 21 rows; local validation also checks that limit.

Filter scope is deliberately sheet-specific:

- Leadership and demographic sheets use the respondent-level evidence dataset
  with Program, Campaign, Iteration, Constituency, Mandal, Gender, Age band and
  recorded party-salience controls.
- Geographic rollups have no Age/Gender fields. Their controls cover Program,
  Campaign, Iteration, Constituency, Mandal and party; matched common labels
  also control the respondent-level heat tables.
- Movement is full-Iteration/all-Run evidence and supports Program, Campaign
  and Iteration only. Null deltas are unavailable, never zero.
- Quality totals are whole-Campaign and support Program/Campaign. The separate
  comparability registry source has no Program column: its table is controlled
  by Campaign only until an explicitly verified Program mapping is added.
- Measurement guide contains static measurement notes. Added charts do not
  extend fieldwork totals to demographic, Mandal, Iteration or Run scope.

The quality view's legacy `sampling_design` and `weighting_status` constants
must not be presented as actual declarations. The registry provides actual
recorded methods and an Undeclared state. Quality ratios are sums of numerators
divided by sums of denominators, not averages of rounded percentages. Summed
Campaign respondent bases are participant–Campaign incidences, not distinct
Program participants.

## Geographic map layer

The platform presents two governed geographic views:

1. an official Telangana administrative-boundary explorer, loaded from the
   Telangana Remote Sensing Applications Centre (TGRAC) ArcGIS service; and
2. Amazon Quick's aggregate survey map and charts.

The boundary explorer supports State, 33 District, 119 Assembly constituency
and 621 Mandal features. The deployment sync projects the source geometry to
EPSG:4326, simplifies it for web presentation and stores the resulting GeoJSON
in `analytics_geo_boundary_reference`. It identifies **AC 52 Serilingampally**
as the demo focus and retains Rangareddy and the corresponding Mandal as map
context. The sync is dry-run by default and only replaces the governed snapshot
when `--apply` is supplied.

Source service:
`https://tgrac.telangana.gov.in/arcgis/rest/services/AdministrativeInfoSystem_Folder/Administrative_Information_System_Query/MapServer`

The application endpoint is restricted to Super Admin and Admin, returns one
requested layer at a time and exposes administrative polygons only. It does
not return voter locations or respondent identities.

`GET /api/enterprise-dashboard/research-quality` supplies the native quality
gate shown above the embedded dashboard. It returns aggregate campaign evidence
coverage and Iteration movement only. Sampling remains labelled as directional
and unweighted until an approved probability design and weighting pipeline are
configured.

`analytics_research_geographic_v2` supplies latitude, longitude, canonical party
label and qualified respondent counts. The governed publication uses **Points
on map**: `latitude`/`longitude` in the geospatial field well,
`sum(respondent_count)` as size and `party_name` as categorical color. Pooled
sizes are respondent–Iteration observations, not unique people. Add the party
control so leadership can inspect recorded salience party by party. The heat
tables show count intensity. No ambiguous numeric party-strength score is
colored or displayed, and the map does not infer vote choice.

The SQL enforces a minimum base of five distinct respondents before a
geography/party cell can enter the BI dataset. It does not expose voter
coordinates or identities. The included Serilingampally coordinate is a demo
centroid. Before statewide production, load authoritative Mandal or
constituency centroids/boundaries into `analytics_geo_reference` and record the
source and verification date. Amazon Quick supports latitude/longitude point
maps and a native heatmap style, so this implementation does not require a
separate Google Maps or Mapbox API key.

The EC2 instance role needs only:

```json
{
  "Effect": "Allow",
  "Action": "quicksight:GenerateEmbedUrlForRegisteredUser",
  "Resource": [
    "arn:aws:quicksight:ap-south-1:123456789012:dashboard/psephology-enterprise-leadership",
    "arn:aws:quicksight:ap-south-1:123456789012:user/default/psephology-leadership-reader"
  ]
}
```

## Security boundary

The enterprise embed endpoint is limited to Super Admin and Admin roles until
row-level security is configured. The
dataset contains a pseudonymous respondent key but excludes names, phone
numbers, EPIC IDs, transcripts and raw output JSON. Before offering this across
multiple organizations, replace the shared Reader with per-user provisioning or
anonymous capacity embedding with session-tag row-level security.
# Audited methodology (Step 3)

Migration 031 tightens the shared comparison gate: complete actual-method
declarations and retained frozen question content are required. The registry
adds actor/reason/revision history and prevents stale overwrites. It does not
apply statistical weights or reconstruct historical questionnaires. Use the
coordinated [methodology installer](../research-methodology/README.md) to also
install future questionnaire-content capture and prelaunch drift protection.
Published Quick assets remain unchanged until the authoring/publication step.

## Sentiment construct safeguards (Step 4)

Migration 032 preserves the existing v1/v2 view signatures and original call
answers. In the Quick v2 dataset, `respondent_sentiment` now means **incumbent
performance assessment only**, from `incumbent_assessment`. It does not borrow
issue, development or expected-change sentiment when that answer is missing.
`candidate_sentiment` means **candidate impression only**, from the three
impression aliases; candidate criterion fit remains a separate suitability
measure. Contradictory assessment aliases are retained as Uncoded, not silently
resolved by source-key order. Mixed is a separate category, never Neutral.

The authorized research-quality API and native enterprise page expose the
normalization version, rule hash and `HUMAN_REVIEW_PENDING` status. This is
descriptive coding of explicit structured labels, not a validated NLP model or
an electoral prediction. Regression fixtures, including multilingual examples,
check software behavior; actual evidence review and recorded human sign-off are
still required for any claim of validated accuracy. Sampling comparison gates,
measure-specific answer bases and five-answer suppression still apply.

The installer copies 032 and the migration runner applies it after 031.
Installation does **not** refresh or publish Amazon Quick assets. Before a
presentation, refresh the v2 datasets and review the authoring blueprint's
explicit construct labels, Mixed categories, answer-base captions and
pending-validation disclosure. Older published assets may otherwise retain
their previous labels or SPICE data.

Local-only verification:

```bash
node deployment/amazon-quick-enterprise-dashboard/test-amazon-quick-dashboard.js
PGLITE_MODULE_PATH=/path/to/pglite/dist/index.js node deployment/amazon-quick-enterprise-dashboard/test-normalized-output-sql.js
```

The first test includes installer idempotence and an installed migration-runner
mock. The second executes the full SQL sequence in isolated PostgreSQL; neither
test connects to the live database or publishes cloud assets.

## Publication verification gate

`quick-publication-plan.mjs` requires a durable metadata backup, successful
ingestions, live filter checks and an independent definition readback for the
exact returned dashboard version before publication. Build success alone is
insufficient: readback errors, stale dataset identifier/ARN bindings or changes
to sheets, calculations, filters or options stop the release even when a
verification callback reports success. The returned definition is independently
revalidated against its safeguards; matching IDs cannot hide altered formulas
or disabled suppression. Service-normalized differences need explicit review.
The executor rejects updates to datasets referenced by the published dashboard
and updates outside the reviewed candidate/account before any mutation. Never
relax validation or publish merely to clear a readback error.

Historical checkpoint — on 2026-10-09 the reviewed Steps 1–4 analysis and all six staged SPICE ingestions
passed. The existing dashboard remains on published version 3: unpublished
versions 4 and 5 reported successful builds, but their definition exports
retained old dataset declarations and column errors. The explicit-template
publication route did not resolve that mismatch. Keep the reviewed draft and
metadata receipts for diagnosis; publication was blocked at that checkpoint,
and Step 5 had not been started.
On 2026-10-10 the enhanced working analysis compiled successfully with six
sheets, 41 visuals and zero AWS errors. Its saved definition matched the reviewed
candidate after narrowly reviewed service serialization and three explicitly
accepted UI settings (responsive demographic canvas, interactive/responsive new
sheet defaults, and analysis-only AUTO query execution). API updates dropped
click highlighting; it was restored through Analysis Settings and its exact
saved value verified. The historical-alias API experiment (unpublished version
6) still retained stale definition bindings and column errors; it was not
published. A separate unshared validation dashboard then compiled the reviewed
definition with all six bindings and zero errors. Its complete definition passed
the same semantic readback gate before the existing dashboard was replaced
through the console from the verified analysis.

The existing dashboard is now on published version 7: six sheets, 41 visuals,
all six intended staged datasets, zero definition errors, and unchanged access
permissions/link-sharing configuration. Version 3 and durable metadata backups
remain available for rollback. A live sparse 50+ filter test withheld cells;
filters were restored afterward. A chart's “How it’s measured” menu action
opened Measurement guide successfully. This publication reused the 9 October
SPICE ingestions; it is not a fresh survey-data refresh or Step 5 completion.
The unshared diagnostic dashboard `psephology-insights-validation-20261010`
remains retained and is not wired into the platform.

`validateServiceNormalizedPublicationReadback` is an explicit alternative for
the documented, path-specific serialization review; the publication executor
still uses the strict comparator. Unknown differences, Options, nonempty
settings, safeguards, bindings and actions remain gated. Do not use it to ignore
a missing highlighting configuration or a new UI setting.

`prepareConsoleNamespacedCandidate` prepares an offline expectation for the
console's sheet/visual ID prefixes, using only typed references, an explicit
dashboard ID and a reversible whole-candidate proof. It never strips arbitrary
prefixes from a cloud export or relaxes formula, filter, dataset, option, palette
or action validation. The API publication executor remains strict and unchanged.
`test-console-quick-readback.mjs` checks this mapping, content-tampering rejection
and, when saved artifacts are present, the exact published version 7 readback.

`remap-historical-quick-identifiers.mjs --candidate INPUT --backup BACKUP --out NEW`
prepares an offline, draft-only identifier experiment. It derives three aliases
from the saved historical ARN mappings, retains all six current dataset ARNs,
proves inverse whole-bundle identity and refuses overwrite. It performs no AWS
operations or publication. It is a diagnostic hypothesis, not a guaranteed fix.
Analysis-only AUTO is allowed explicitly; QueryExecutionOptions is not a
DashboardVersionDefinition field and is rejected in dashboard requests.
