# Step 3 — actual research methodology

This release records verified fieldwork methodology, keeps audited revisions and
freezes the approved question content for **new** Iterations. It does not infer
past methodology, rewrite transcripts, reconstruct missing historical questions,
submit calls, change Sarvam prompts or publish Amazon Quick assets.

## Declare actual methods

After deployment, an Admin or Super Admin opens **Enterprise Dashboard → Research
design registry**, chooses the Campaign/Iteration and records:

- target population and the actual contact frame/list version;
- sampling/invitation method and selection/exclusion/retry procedure;
- same participants, independent samples or partially overlapping lists;
- actual weighting status, fieldwork mode and known limitations;
- supporting fieldwork record/confirmation and reason for the declaration.

The confirmation checkbox refers to **actual fieldwork**, not future plans. Blank
fields, placeholder declarations, unknown cohort/mode/weighting, unsupported
applied weighting and silently truncated values are rejected. Nothing is
predeclared from migration defaults. Admin access follows ordinary Campaign
visibility: assigned Campaigns or the Admin's own unassigned Campaigns; other
Admins' unassigned drafts remain private. Campaign Managers do not gain access
to this Admin registry.

Saving locks the source Iteration, checks the loaded revision, and commits the
new declaration and audit revision together. Stale forms receive `409`; reload
before editing. Every revision retains actor, time, source/reason and declared
fields. Audit rows reject update, deletion and truncation, and have no source
cascading foreign keys. The UI/API show the latest 50 revisions; earlier revisions
remain retained. This is an application/database audit control, not an off-host
tamper-proof archive against a database administrator.

## Coverage and interpretation

Inviting every eligible person in a declared contact list is an **attempted
census of that frame**. It does not establish complete coverage of the electorate
or make nonrespondents equivalent to respondents. A 40–50% call connection rate
does not prove representativeness; repeat attempts are calls, not unique voters.
Current connection/structured-output coverage are operational indicators, not a
standardized AAPOR response rate. Formal response rates require eligibility and
final disposition records plus a stated formula; do not relabel these indicators.

All current reports remain **unweighted**. Legacy `NOT_REQUIRED` is displayed as
“No weights used”; it records an operational fact, not a judgment that bias
adjustment is unnecessary. Planned weighting is disclosed but never applied by
editing this form. `NOT_CONFIGURED` needs confirmation and `APPLIED` is blocked
until a real verified weighting pipeline exists. Five answers is a display
threshold, not a statistical-confidence or representativeness threshold.

The intended three stages can separately study general concerns, assessments of
public administration, and decision criteria/participation readiness. Questions
must stay neutral and must not steer respondents toward a candidate or party.
Different stage questionnaires are **different instruments**, not automatically
a trend. Unchanged question wording/options/order/outputs and complete matching
methods are required by the conservative full-instrument comparison gate. No
common-core subset or historical identity is guessed. A future module-level
comparison needs explicit, approved core mappings before it can be enabled.

## Question provenance and launch check

See [QUESTIONNAIRE-CONTENT.md](QUESTIONNAIRE-CONTENT.md). New Iterations retain
actual ordered question definitions and a semantic SHA-256 fingerprint. The
prelaunch guard checks schema-v2 snapshot integrity and current catalogue parity
before launch state changes or provider submissions. Catalogue drift receives
`409`; restore the approved catalogue or create a newly approved Iteration.
Earlier header-only snapshots remain explicitly limited, with no backfill and
no new content-based movement claims.

This catalogue check does **not** prove the committed Sarvam agent asks the
questions verbatim. The existing compact runtime handoff and greeting fixes are
unchanged. Verify the committed agent/version through the preflight/canary process
before outbound fieldwork. Direct provider-execution entrypoints outside the
bulk `launchRun` workflow are not covered by this catalogue guard.

## Install without launching calls

From the UI repository on EC2:

```sh
node deployment/research-methodology/install-research-methodology.js /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-amazon-quick-dashboard.js
node --check src/repositories/research-methodology.repository.js
node --check src/repositories/questionnaire-snapshot.repository.js
node --check src/services/run-launch.service.js
node --check src/routes/amazon-quick-dashboard.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

The coordinated installer includes the pending output-normalization changes and
backs up replaced runtime code. Migration 031 runs after 028–030 and preserves
existing comparison-view columns; reruns are safe and do not declare methods.
Install the frontend build through the normal Amplify release process as well.
There is no deployment or live database mutation merely from adding these files.

## Verification

```sh
node deployment/research-methodology/test-questionnaire-snapshot.mjs
node deployment/research-methodology/test-questionnaire-launch-guard.mjs
node deployment/research-methodology/test-research-methodology-install.mjs
node deployment/research-methodology/test-research-methodology-ui.mjs
```

For isolated PostgreSQL-engine tests, set `PGLITE_MODULE_PATH` to a local
`@electric-sql/pglite/dist/index.js` installation (no production database used):

```sh
node deployment/research-methodology/test-research-methodology.mjs
node deployment/research-methodology/test-research-methodology-sql.mjs
```

The tests cover defaults/incomplete declarations, both waves' provenance gaps,
privacy and role restrictions, actor spoofing, stale revisions, atomic rollback,
append-only history, migration replay and future catalogue drift.

Methodology guidance: [AAPOR transparency disclosure](https://aapor.org/standards-and-ethics/transparency-initiative/),
[survey best practices](https://aapor.org/standards-and-ethics/best-practices/) and
[outcome-rate definitions](https://aapor.org/standards-and-ethics/standard-definitions/).
These inform disclosure safeguards; this demo is not certified as an election-grade
probability survey.
