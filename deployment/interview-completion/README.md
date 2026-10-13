# Recorded interview completeness — demo Step 2

This feature checks **recorded required-answer coverage**, not verified question delivery or a statistically valid survey-completion rate. It is deliberately separate from the existing connected-call success rule and Step 1's human call-sample review. A callback, connection, provider `COMPLETED` status or one meaningful answer is not enough for complete recorded coverage.

## Where it appears

- **Analysis → Methodology and report checks → Recorded interview completeness:** a collapsed, read-only summary for the selected Iteration across all Runs. Available to authorized Admins, Super Admins and the currently assigned Campaign Manager. Age, gender, Mandal and Run filters do not narrow this separate summary.
- **Calls → call details → Recorded required-answer check:** a private, read-only question-level check for Admin/Super Admin. It shows question codes and coverage states, not raw answers or personal information. Campaign Managers and Campaigners cannot retrieve this private endpoint.

Both panels are scope-bound, reject incompatible responses and clear stale results when the account, role or selected scope changes. A failed load is unavailable, never a passed check.

## Completion rule

The checker requires a verified schema-2 frozen questionnaire with its recorded identity, version, content fingerprint, explicit Boolean `metadata.required_for_completion` declarations and usable exact output mappings. It does not substitute the current editable questionnaire catalogue, a generic question list or runtime prompt text for missing frozen content. `required` and `required_for_completion` are separate declarations: only the latter governs this coverage check.

Every mapped output of a completion-required question is conservatively required. V1 does not guess primary-answer keys, aliases, derived-output equivalence or conditional paths. Unsupported required branching rules, ambiguous mappings, invalid value contracts or contradictory sources remain technically unresolved. Missing optional answers do not block complete required coverage.

Explicit missing states, uncertainty and refusal are handled separately. Valid recorded zero, false and “None” are not automatically missing. Exact recognized uncertainty/refusal tokens are not inferred political preferences. A participant may decline or be uncertain; this checker must not be used to pressure them or automatically retry a refusal.

| State | Meaning |
| --- | --- |
| Complete recorded coverage | All declared required outputs are accounted for and at least one required question has a substantive recorded answer. This is not human verification of a completed interview. |
| Partial recorded coverage | At least one required mapped output has a substantive recorded answer, but other required outputs are missing. |
| No substantive record | No substantive required answer is retained, including cases with explicit uncertainty/refusal. This does not prove no interview occurred. |
| Technically unresolved | Required provenance, source identity, transcript, callback, mapping or output semantics cannot be verified. |
| Not connected | An exactly matched terminal callback records a recognized non-connection outcome. |
| In progress | The selected execution has a recognized active status. |
| Not attempted | No execution or contradictory retained attempt evidence exists for this verified cohort record. Orphaned/mismatched attempts are not silently treated as unattempted. |

Connected coverage additionally requires an unambiguous terminal execution, exact callback linkage and retained transcript. Question-level values must meet any supported explicit frozen value contract. Unrecognized or contradictory evidence never becomes complete coverage.

A question with several required output keys is marked missing if any key is missing. The substantive-question count includes only fully accounted questions; an attempt can therefore have partial recorded coverage with no fully accounted substantive questions.

## Aggregate denominator and privacy

The initial cohort is **distinct retained Run 1 database voter IDs**, not verified unique people or the electorate. The checker selects the latest execution for each of those records across all Runs. It never stitches answers from separate attempts into a fictional complete interview or resurrects an old complete record when the latest attempt is still active. An undated execution, or a contact claiming an attempt without its exactly matched execution, makes the result technically unresolved, including a later retry after an older complete attempt. Contacts outside this retained initial cohort are excluded and disclosed as a limitation.

The seven outcome counts partition that verified initial cohort. If any non-zero outcome cell is below five, **all counts, including the denominator, are withheld**. A verified empty cohort can be zero; unavailable or ambiguous storage cannot. The public-to-authorized-manager DTO contains no execution IDs, voter IDs, names, phones, transcripts, answers, question codes, reviewer details or individual political scores. Private diagnostics contain no raw answers or voter identifiers either.

No percentage, AAPOR response rate, weighting, population estimate, individual political prediction or sentiment certification is produced. Existing research-report exports, `humanValidation: PENDING` and fieldwork's unvalidated survey-completion indicator remain unchanged. This separate automated coverage check cannot override those research limitations.

## API

| Read-only endpoint | Access |
| --- | --- |
| `GET /api/interview-completion/executions/:executionId` | Authorized active Admin / Super Admin |
| `GET /api/interview-completion/campaigns/:campaignId?iterationId=:iterationId` | Authorized active Admin / Super Admin / current Campaign Manager |

Only `iterationId` is accepted on the aggregate endpoint; Run and demographic narrowing are rejected. Responses use `Cache-Control: no-store`. Current active account, active role, campaign visibility and exact Campaign/Iteration association are checked in the database. The private endpoint binds execution, contact, voter, Run, Iteration and provider attempt, detecting ambiguous or conflicting retained rows.

## Installation through an approved release

From the UI checkout on EC2:

```sh
node deployment/interview-completion/install-interview-completion.js /opt/sarvam-voice-analytics --dry-run
node deployment/interview-completion/install-interview-completion.js /opt/sarvam-voice-analytics
```

Then, only through the approved deployment process:

```sh
cd /opt/sarvam-voice-analytics
node --check src/repositories/interview-completion.js
node --check src/repositories/interview-completion.repository.js
node --check src/routes/interview-completion.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Deploy the matching frontend through the existing Amplify release process. This Step 2 package requires **no database migration**. It uses existing retained evidence and read-only transactions, adds no tables and persists no classifications. The installer preflights source/dependencies, preserves Step 1 route registration, backs up changed runtime files and mounts its own authorization before broad legacy catalogue guards.

It performs no calls, RDS/AWS/Sarvam changes, service restart, historical backfill or repair. It changes no retry eligibility, Run/campaign lifecycle, webhook completion policy, approved questionnaire content or respondent data. Legacy missing provenance is a diagnostic limitation, not permission to rewrite the old questionnaire snapshot.

## Local tests and release acceptance

```sh
node deployment/interview-completion/test-interview-completion.mjs
PGLITE_MODULE_PATH=/absolute/path/to/@electric-sql/pglite/dist/index.js node deployment/interview-completion/test-interview-completion-sql.mjs
node deployment/interview-completion/test-interview-completion-ui.mjs
node deployment/interview-completion/test-install-interview-completion.mjs
```

Tests use synthetic fixtures and an isolated PostgreSQL-compatible database, never production RDS. After explicit deployment, verify an authorized retained call's frozen declarations, exact linkage and recorded question states. Check a partial/greeting-only call cannot appear complete, an old instrument without declarations stays unresolved, manager reassignment revokes access, Campaigners cannot open these diagnostics, and small cells show no recoverable count partition.

Do not edit historical evidence, fabricate reviews or launch new calls solely to force a positive acceptance result. Verify existing retries, Run lifecycle and research exports are unchanged. API readiness is not evidence of completed survey validation.

See [VALIDATION.md](./VALIDATION.md) for the local verification record and live-release limitations.
