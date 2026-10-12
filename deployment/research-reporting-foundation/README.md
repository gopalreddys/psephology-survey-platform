# Research methodology and reporting foundation

This release adds **definition/reporting controls** and **selected-contact cohort
diagnostics** identified in the survey-agency comparison. It does not implement a
probability sampler, statistical weighting, multilingual human validation,
election forecasting or production calling gates.
No live records are changed by adding these source files.

## Questionnaire output contracts

Admin/Super Admin can expand **Questionnaires → questionnaire → Reporting output
contracts** to define a report construct, exact structured output keys, type,
categorical labels and a named target where required. Missing, uncertainty and
refusal remain separate from substantive answers. Existing question wording is
not rewritten by a contract save.

`NOT_ANSWERED`, `CANT_SAY` and `REFUSED` are conceptual reserved state names,
not instructions to emit new Sarvam tokens. The current normalizer supports
recorded strings such as `no answer`, `can't say` and `refused`. Do not introduce
underscore-form response tokens without separately updating and testing the
shared normalization rules.

Definitions are saved into the existing question metadata and retained by future
schema-v2 questionnaire snapshots. Every write checks the full question
fingerprint, locks the questionnaire/row and preserves unrelated metadata. A
questionnaire referenced by an Iteration is read-only for contract changes:
create a new questionnaire/version instead. No past transcript, output,
questionnaire snapshot or method declaration is inferred or repaired.

Defining output keys does **not** configure Sarvam. Commit the matching neutral
question/extraction fields in Sarvam, verify the exact agent/version and perform
an approved canary before fieldwork. The compact runtime handoff and prior
greeting fixes are unchanged. Do not restore the long question payload merely
because this contract editor exists.

## Analysis research checks and report pack

**Analytics → Campaign Analysis** includes compact research checks with on-demand
coverage, methodological limitations and next actions. The same current
Iteration/gender/age/Mandal filters apply. Run selection affects operations only;
the research insight scope remains the entire selected Iteration.

The authorized API generates a whitelisted, versioned, aggregate-only research
report from the frozen instrument, actual methodology registry and existing
analysis. It distinguishes:

- frozen contract recorded vs legacy definition-only vs absent/invalid mappings;
- recorded descriptive answers vs missing answers vs insufficient/small cells;
- sampling/method declarations vs implemented weighting or statistical precision;
- generated time vs latest stored evidence time;
- pending human validation vs an actual signed review (not implemented here).

Captured distributions are calculated from the exact output keys in the frozen
contract, not a broader alias pool. The selected respondent's latest eligible
nonempty response across all Runs is used; missing keys are not filled from
older calls. Unrecorded or inconsistent content cannot certify measurement.
During active fieldwork these are live, sequential reads rather than an immutable
database snapshot; a denominator mismatch fails closed and requires refresh.

### Contact cohort and response coverage

Research report schema 2 adds an on-demand contact-cohort section and includes
the same diagnostics in JSON and printable downloads. The baseline is distinct
database voter IDs retained in Run 1 contacts; all retry Runs are inspected.
Executions must match contact, Run and voter identity, and call records must
match the provider attempt, Iteration and voter. Standalone or unrelated calls
are not silently treated as responses from the sampled cohort.

This distinguishes observed submission, connectivity, structured-record
availability, pending work and technical unknowns. A failed execution without a
callback is not a confirmed refusal or nonresponse. A connected call or
`SUCCESS_COMPLETE` flag is not proof of a fully completed survey. Where shown,
the ratio is **recorded structured-response yield**, not an AAPOR survey response
rate. A nonempty output object does not verify delivery of all required questions.

Age, gender and Mandal composition comparisons use **current voter-master
attributes**, not frozen attributes at selection. These comparisons describe
recorded versus unrecorded response coverage within the retained contact cohort;
they do not estimate electorate bias, party support or population parameters.
The existing gender/age/Mandal filters apply, while Run selection still affects
operations only.

Small-cell protection applies to the complete outcome partition and its
derivable coverage totals/ratios. Demographic partitions are also withheld as a
whole when their cells or complements are too small. Missing or inconsistent
cohort sources remain unavailable, never zero or a positive quality claim.

Historical eligible-frame snapshots, per-person identity verification, selection
probabilities, validated survey completions and standardized response rates
remain unavailable. A methods declaration, demo-contact approval or a live
geography count is not substituted for this evidence. See
[the future sampling requirements](./SAMPLING-NEXT.md) before population inference.

Named targets never make unrelated historic candidate answers apply to a new
candidate. New output keys without analytical support stay mapping-pending.
Scheme/leader contracts can be authored but do not manufacture those reports.
Missing values are not zero. Small bases/cells are withheld in the downloadable
report, and no voter identities, phones, individual scores or transcripts are
included. The checksum identifies the artifact, not an independent certification.

Users can download **Report JSON** or a script-free **Printable report**. Open the
HTML locally and print/save as PDF. Downloads remain local to that user; nothing
is sent to a public service. Report files still contain restricted research
information and should follow the organization's sharing policy.

## Install

Prerequisites: existing Analytics workspace, shared normalization, campaign
visibility, questionnaire schema-v2 snapshots and audited methodology registry
from the prior releases. The installer validates file dependencies/anchors before
writing. The contract API resolves the live question relation and fails closed
if it is missing, ambiguous or lacks supported JSONB metadata. No assumed table
rename or new database is required.

From the UI checkout on EC2:

```sh
node deployment/research-reporting-foundation/install-research-reporting.js /opt/sarvam-voice-analytics --dry-run
node deployment/research-reporting-foundation/install-research-reporting.js /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node --check src/routes/reporting-contract.routes.js
node --check src/routes/research-report.routes.js
node --check src/repositories/reporting-contract.repository.js
node --check src/repositories/research-report.repository.js
node --check src/repositories/fieldwork-diagnostics.repository.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Deploy the matching frontend through Amplify. The installer neither restarts
services nor launches calls. Changed runtime files receive dated backups.

## Local verification

```sh
node deployment/research-reporting-foundation/test-reporting-contract.mjs
node deployment/research-reporting-foundation/test-reporting-contract-ui.mjs
node deployment/research-reporting-foundation/test-research-report.mjs
node deployment/research-reporting-foundation/test-research-report-ui.mjs
node deployment/research-reporting-foundation/test-install-research-reporting.mjs
node deployment/research-reporting-foundation/test-fieldwork-diagnostics.mjs
```

For isolated PostgreSQL-engine tests, set `PGLITE_MODULE_PATH` to an existing test
installation's `@electric-sql/pglite/dist/index.js`, then run the contract suite
above, `test-research-report-sql.mjs` and `test-fieldwork-diagnostics-sql.mjs`.
These tests never use the production
database. `render-reporting-preview.mjs /tmp/reporting-preview.html` creates a
synthetic actual-component layout preview and printable report for local QA;
it requires a new output filename and does not query the API.

## Acceptance before use

1. Admin-only contract authoring; Campaigner and Campaign Manager cannot write.
2. An unused test questionnaire can save/reload a contract. Concurrent stale
   saves return 409. Used questionnaires remain read-only.
3. Frozen historic instruments without definitions remain explicit legacy gaps.
4. Scope switching never downloads an old scope's report. Forbidden Campaigns
   and cross-Campaign Iteration/Run IDs return no report data.
5. Low bases/cells and unknown target mappings stay withheld/unavailable in both
   screen and downloads. No participant-level fields appear in the report.
6. Printable report retains UTC dates, source/version, bases, methods, limitations
   and next actions, and renders untrusted text as text rather than HTML.
7. Run 2/3 retries do not increase the unique Run 1 contact baseline. Unattempted
   contacts remain in that baseline; unrelated calls do not improve coverage.
8. Current demographic-source limitations, technical unknowns and unavailable
   formal response/completion measures remain visible. The same filtered
   counts/withholding apply on screen and in both report formats.

## Research work still required

- Review real multilingual calls against the approved wording, skip rules,
  structured extraction and sentiment labels; retain a signed review artifact.
- Establish a reproducible frame/sampling design, unique-person final
  dispositions and coverage/nonresponse diagnostics before population claims.
- Build and validate weights/effective sample sizes and justified uncertainty.
- Approve common-core questions before comparing changed stage instruments.
- Add official historical election baselines and dedicated scheme/leader
  calculations before labeling those reports implemented.
- Complete production security, consent/suppression, calling limits, restore,
  monitoring and scale gates separately.

Guidance: [AAPOR disclosure standards](https://aapor.org/standards-and-ethics/disclosure-standards/)
and [survey best practices](https://aapor.org/standards-and-ethics/best-practices/).
For the distinction between operational records and standardized final survey
dispositions/outcome rates, see
[AAPOR Standard Definitions](https://aapor.org/standards-and-ethics/standard-definitions/).
