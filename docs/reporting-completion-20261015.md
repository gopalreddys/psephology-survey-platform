# Dedicated question-to-report completion — 15 October 2026

## Scope and release status

This source change is the first follow-up after the completed cleanup/SDK
release. It extends the existing reporting-contract editor and native Analysis;
it does not introduce another questionnaire workflow. Commit, production
deployment and live-agent validation are separate release steps.

| Construct | Dedicated output | Source change |
| --- | --- | --- |
| Development priorities | `development_priority` | Guided categories and neutral question suggestions; existing exact-contract aggregation exposed as an on-demand chart |
| Expected changes | `desired_change` | Separate question, output and chart; issue answers are not substituted |
| Named-leader assessment | `leader_assessment` | Explicit assessment taxonomy and exact-key aggregation enabled, requiring a frozen LEADER ID/name |

`leader_sentiment` remains a supported explicit alias when it is actually named
in the frozen contract. `expected_change`/`change_priority` and
`priority_development` remain supported aliases for their own constructs. Only
the exact keys recorded in that Iteration's contract enter its report; other
aliases do not fill an absent answer.

## Authoring and Sarvam review

1. As Admin/Super Admin, create an unused questionnaire/version and add the
   approved dedicated questions. Historical/used instruments stay read-only.
2. In **Question-to-report coverage**, open each question, select a matching
   preset, review the output key/categories and save. Presets fill the contract
   draft only; they do not change question wording. English/Telugu suggestions
   need human wording/translation review before use.
3. For a leader assessment, enter the stable ID and actual public leader name.
   A party mention, issue-responsiveness answer or incumbent assessment does not
   supply this measure. Do not combine different named targets.
4. Refresh definitions and select **Download agent review pack**. The local JSON
   includes saved wording, questionnaire identity, contracts and fingerprints.
   It is explicitly a loaded current-catalogue artifact, not a frozen Iteration
   snapshot; export does not recheck concurrent changes. Unsaved drafts and
   stale scopes cannot be exported. The pack includes no participant records,
   call answers, transcripts or credentials.
5. Manually configure the questions and output fields in the intended Sarvam
   agent and commit a new version. Return the declared canonical category labels,
   keeping no answer, can't say and refused separate; do not force uncertainty
   or multiple/unmapped answers into a substantive category.
6. Select that questionnaire and agent version for a new Iteration. Perform an
   approved consented canary, verifying asked wording, target identity, brief
   acknowledgements, returned exact keys and callback persistence before a batch.

Nothing in this change injects a long questionnaire prompt into the phone
runtime, edits Sarvam or launches a call. The compact runtime handoff and the
greeting-loop fixes remain unchanged. Saving a contract is not proof that the
agent delivered its question.

## Analysis behavior

**Analytics → selected Campaign/Iteration → Captured answer distributions** is
closed by default. Available exact-contract distributions show counts, shares
of the non-missing answered base, the frozen named target where applicable, and
on-demand measurement notes. Existing Iteration/gender/age/Mandal filters apply;
Run selection still controls operations only.

- Latest connected nonempty structured evidence per voter is selected across
  all Runs before exact output projection. Missing keys in a later response do
  not revive old answers.
- No response, explicit uncertainty, refusal and uncoded responses remain
  distinct. These are descriptive recorded-answer distributions, not inferred
  political alignment or validated model predictions.
- Whole partitions and linked totals remain withheld when the five-person
  threshold is not met. Missing, legacy, conflicting-target and mapping-pending
  reports get no fabricated chart or zero-value placeholder.
- Existing printable/JSON report downloads use the same validated aggregate
  report as the screen. Scheme assessment remains a separate pending measure.

## Amazon Quick boundary

The published version-8 dashboard and its six datasets are not changed by this
release. These three native measures are **not new Quick visuals**. A subsequent
Quick release needs a separately versioned, target-aware reporting source,
matching answer/person bases, cross-filter suppression and a reviewed staged
candidate. Do not append columns casually to `analytics_research_enterprise_v2`:
its 034 migration replay guard depends on its existing final columns.

The additive leader aliases change the rules/implementation fingerprint from
`5ff1291e57d473d5543556a65826a14ca165af38f9ead86d26a6c2a294c74956`
to `678385d41979ed0b1fa1c0115492435c23a079dd19d1ea5e8edd36521909b0fd`.
Existing-key classifications are unchanged. Old signed evaluations or a prior
Quick guide hash do not certify the newly added keys. Human evidence review
remains pending.

## Deployment safeguards

The small `reporting-completion-release.json` manifest reuses the canonical
backup/promotion/rollback installer. Default mode is a read-only preflight; apply
requires an explicit API-stopped acknowledgement. The release updates only the
shared normalization module/rules, report catalogue and standalone SQL-sync
helper. It does not replay a migration, alter reporting views or control services.

Before restarting the updated API, use the SQL-sync helper's reviewed dry-run
definition hash, explicit apply and durable new backup to regenerate only
`public.analytics_normalize_output_v1(text,jsonb)`. This keeps database/native
normalization aligned without replaying historical 030/032/034 definitions.
Promote the matching frontend separately. Quick refresh/publication and live
agent changes are not automatic parts of this operation.

### Operator sequence (not executed by this source change)

Use the approved maintenance window, confirm no active calling, stop the API and
freeze other deployment/DDL writers. The acknowledgement flag does not itself
stop a service. Run with the API runtime's authorized file/database identity;
do not broaden permissions to get past a preflight failure.

From the UI checkout, preflight first, then promote only after the API is stopped:

```sh
node deployment/research-reporting-foundation/install-reporting-completion.mjs /opt/sarvam-voice-analytics --dry-run
node deployment/research-reporting-foundation/install-reporting-completion.mjs /opt/sarvam-voice-analytics --apply --ack-api-stopped
```

Retain the exact release ID/ledger returned by the promotion. From the runtime,
obtain the SQL function's current definition hash without changing it:

```sh
cd /opt/sarvam-voice-analytics
node src/db/sync-reporting-normalization.mjs --dry-run
```

Review the reported function/rules hashes. Replace the quoted placeholder below
with the exact `beforeFunctionHash` from that dry run. An invalid or changed hash
fails closed. The new backup path's parent must already exist; no file is
overwritten, and the private backup is fsynced before any DDL:

```sh
node src/db/sync-reporting-normalization.mjs --apply --expected-before-hash "PASTE_REVIEWED_BEFORE_FUNCTION_HASH" --backup-file /opt/sarvam-voice-analytics/var/platform-releases/reporting-normalization-20261015-before.json
node src/db/sync-reporting-normalization.mjs --dry-run
```

The second dry run must report `changed:false`. Retain the backup and both
results, restart through the normal service procedure, verify `/ready`, and
deploy/validate the matching frontend. Do not retry a failed/uncertain apply
blindly: inspect a fresh dry run and its receipt first.

File promotion has a guarded rollback through the common installer using the
exact returned release ID. That rollback does **not** roll back a committed SQL
function. If SQL synchronization has already committed and recovery is required,
keep the API stopped, have the database operator review the private prior
function definition/metadata and current hashes, restore and verify that exact
function separately, and coordinate the file/frontend versions. No automated
database rollback or RDS recovery is claimed here.

Unrelated production-readiness and enterprise-planning document edits are not
part of this release. No historical questionnaire, raw answer, call, method
declaration or demographic record is backfilled.

## Source verification

- All 76 deployment regression suites passed, including actual in-memory
  PostgreSQL execution, exact-key/target separation, filtered latest-response
  deduplication, missing-answer non-revival and whole-partition suppression.
- Actual-component tests cover presets, locked instruments, failed/stale saves,
  saved-definition review-pack contents/fingerprint, scope-race export guards,
  native distributions and screen/print/JSON consistency.
- The actual narrow installer passed dry-run, prerequisites, stop acknowledgement,
  exact promotion, backups, idempotence, rollback and injected-failure tests in
  isolated temporary API trees. The SQL helper passed dry-run, drift, backup,
  failure rollback, metadata/ACL preservation, installed CLI and SQL/JS parity
  tests. No production database or AWS service was used by those tests.
- TypeScript, focused ESLint, source diff checks and the production webpack
  build passed. The build used process-only synthetic public Cognito settings,
  not live credentials or a changed environment file.
- Synthetic actual-component HTML/print previews were generated. Automated
  browser visual inspection was blocked by its local-file URL security policy;
  no bypass was attempted. Live visual/role/agent and deployment validation
  remain release acceptance steps, not claims from these source tests.
