# Step 2: standardized outputs and visible answer bases

The shared, versioned taxonomy normalizes recorded party mentions, explicit aided
leadership selections, candidate names/assessments, issue priorities and candidate
qualities. Native Analysis, Campaign/Program comparisons, role Dashboard and new
Amazon Quick v2 reporting views use the same rule source. No call, questionnaire,
transcript, respondent or original output record is rewritten.

Canonical aliases merge (for example TRS/BRS/Bharat Rashtra Samithi). Multiple,
negated or unrecognized entity responses remain uncoded instead of choosing the
first party mentioned. A party mention is unaided recall, not vote preference;
an adverse narrative mentioning a party is not an aided leadership selection.
Candidate awareness cannot substitute for an assessment. Development priorities
and requested changes remain separate from issue priority. Alternate keys are
resolved per respondent, with a consistent order; conflicting case-variant keys
remain uncoded. This is deterministic coding, not a validated multilingual NLP
model. Narrative assessments that do not match explicit categories are uncoded;
human validation and richer coding remain Step 4.

Every research percentage uses a named answer base. It includes recorded,
non-missing answers: coded categories, explicit Can't say, refusal and uncoded
answers. Missing/blank/null/not-recorded placeholders are excluded, not converted
to uncertainty. The UI shows answered/total, missing, Can't say, declined and
uncoded counts, even when there is no reportable chart. Categories are not silently
truncated, so displayed percentage bases do not change to a top-N subset.
Percentages are withheld below five answers. Sentiment judgments additionally
require five distinct people with an explicitly coded assessment; one person's
multiple outputs cannot satisfy this threshold. This disclosure guard does not
establish representativeness, electoral forecasting or statistical precision.

Step 4 replaces the mixed-construct reporting with a single selected construct per
respondent. Native Analysis and the role Dashboard default to candidate impression
and allow an explicitly selected incumbent, issue, development or expected-change
assessment; they never fill missing candidate sentiment with incumbent or issue
sentiment. Quick's civic assessment is now explicitly incumbent performance only,
with candidate impression reported separately. Candidate criterion fit is
suitability, not sentiment. Mixed assessments are distinct from neutral answers;
conflicting assessment aliases remain uncoded. These are explicitly different
constructs, not interchangeable percentages. Derived demo composites require
adequate coded components; no individual political score is produced. Coding
noise is excluded from substantive movement and questionnaire recommendations.
Explicit Telugu/Hindi/English labels are supported by OUTPUT_TAXONOMY_V2. The
shared rule/implementation hash and HUMAN_REVIEW_PENDING notice are exposed in
reporting. Synthetic multilingual regression fixtures are engineering checks,
not an empirical accuracy claim. Real anonymized responses still require two
independent human reviewers and disagreement adjudication; see
../sentiment-validation/README.md. No NLP service or enterprise model is introduced.

## Installation

From the UI repository, the coordinated installer backs up existing code and
installs all dependent modules, rules, routes and SQL assets:

```bash
node deployment/research-comparability/install-research-comparability.js /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-amazon-quick-dashboard.js
node --check src/repositories/output-normalization.repository.js
sudo systemctl restart psephology-api.service
curl --fail --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Deploy the frontend separately through the existing release workflow. Migration
030 installs the generated normalization function and new enterprise/geographic/
movement v2 views. Existing v1 Quick datasets and published visuals are unchanged.
The blueprint points to v2; an author must switch datasets/fields, refresh SPICE,
verify answer-base captions and publish before the embedded Quick visuals change.
No authoring, credentials, role permissions or live calls are modified by this
installer. Original response text remains available only in privileged source
records; raw narrative columns are not exported through the public v2 views.

## Local verification

```bash
node deployment/output-variable-standardization/test-output-normalization.js
node deployment/role-dashboard/test-role-dashboard.js
node deployment/analytics-workspace/test-analytics-behavior.js
node deployment/campaign-comparative-analysis/test-campaign-analysis.js
node deployment/program-executive-dashboard/test-program-comparability.js
node deployment/research-comparability/test-install-research-comparability.js
node deployment/amazon-quick-enterprise-dashboard/test-amazon-quick-dashboard.js
PGLITE_MODULE_PATH=/absolute/path/to/test/node_modules/@electric-sql/pglite/dist/index.js node deployment/amazon-quick-enterprise-dashboard/test-normalized-output-sql.js
```

The isolated SQL test verifies full migration replay, SQL/JavaScript parity,
denominators, minimum bases, no guessed party strength, alias resolution and
geographic grouping without connecting to production. Also run the existing
comparison tests, lint, TypeScript and production build before release.
