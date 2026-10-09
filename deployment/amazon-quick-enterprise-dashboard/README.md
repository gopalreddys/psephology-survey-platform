# Amazon Quick enterprise dashboard

This deployment adds a governed, non-PII research dataset and an authenticated
Amazon Quick Sight embedding endpoint. Quick Sight is the BI capability within
Amazon Quick. The platform dashboard remains the operational fallback while
the enterprise dashboard is authored and published in AWS.

## What leadership will see

- leadership overview: respondent base, aggregate party-strength, party,
  candidate, leadership and sentiment distributions;
- demographic pulse: age histogram, age-band sentiment, gender composition and
  party salience by gender;
- geographic intelligence: constituency and Mandal heat tables plus issue
  priorities by constituency, with a party-filtered Mandal map over Amazon
  Quick's native base-map layer;
- Iteration movement: comparable party-strength, candidate sentiment and issue
  movement across Iterations, including explicit change from the previous wave;
- research quality: connection, transcript and structured-output coverage,
  demographic completeness, fieldwork dates and a qualified evidence status.

Admin and Super Admin users can declare the target population, sample frame,
sampling method, selection method, weighting approach and fieldwork mode for
each Iteration. The platform compares those declarations with the questionnaire
snapshot before exposing change from the previous Iteration. A failed gate
suppresses the movement value instead of presenting incomparable waves as a
trend.

The research quality status describes operational evidence completeness. It is
not a statistical confidence level, margin of error or election forecast. The
deterministic authoring specification is in
`quick-dashboard-blueprint.json`. Do not display any cell below the governed
minimum base (currently `n=5` in the application). Do not describe an
unweighted demo result as an election forecast.

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
wave. No party mention is converted into an inferred rating. The movement
view's sentiment construct is explicitly the first non-missing civic/incumbent
assessment in this order: issue, development, expected change, then incumbent.
Candidate assessment is a separate construct: the first non-missing candidate
impression/sentiment, then criterion fit. They are not averaged together or
represented as equivalent to the native Analysis page's separate sentiment
questions.

The platform's native enterprise evidence panel uses the v2 movement view.
The authoring blueprint targets v2 datasets, but installing/migrating the API
**does not republish existing Amazon Quick datasets or dashboards**. Existing
v1 assets remain intact until an explicitly approved authoring/publication
step replaces their data sources and refreshes SPICE.

Local regressions:

```bash
node deployment/amazon-quick-enterprise-dashboard/test-amazon-quick-dashboard.js
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
4. Author the five sheets in `quick-dashboard-blueprint.json` and publish the
   dashboard.
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

`analytics_research_geographic_v2` supplies latitude, longitude, canonical party label,
respondent count and aggregate party-strength to an Amazon Quick geospatial
visual. Configure the visual as **Points on map**, place `latitude` and
`longitude` in the geospatial field well, use `heat_weight` as the weight, and
switch the point style to **Heatmap**. Add `party_name` as a sheet filter so
leadership can compare the aggregate pulse party by party.

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
