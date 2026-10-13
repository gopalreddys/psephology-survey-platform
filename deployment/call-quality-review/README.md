# Audited call-quality sample review — demo step 1

This release adds operational review of retained call evidence. It does **not** approve a whole Iteration, certify population representativeness, validate sentiment-model accuracy, infer an individual's political alignment, or classify a connected call as a completed interview. The existing research-report schema and `humanValidation: PENDING` remain unchanged. Construct-level linguistic validation stays a separate protocol in `deployment/sentiment-validation/README.md`.

## Workflow

1. An Admin or Super Admin opens **Calls → call details → Review this call sample**. The panel loads its own verified source rather than trusting the broader operations drawer's provider-attempt lookup.
2. Two different authorized accounts independently inspect the retained transcript, actual execution agent/version, frozen questions and question-mapped outputs. Each selects the observed language and assesses six checks: greeting/turn progression, question delivery, language handling, neutrality, output extraction and missing/refused-answer handling. No check or attestation is prefilled as a pass. If the retained evidence cannot establish a result, select **Not assessable**; a transcript alone is not proof of audio quality.
3. Each account submits one immutable assessment for the current evidence fingerprint. Other reviewers' findings are sealed before that account's assessment. There are at most two initial assessment slots per fingerprint; later loss of reviewer eligibility does not reopen those slots. Failed or unassessable checks can be recorded for diagnosis, even if complete frozen-instrument provenance is unavailable.
4. A third distinct authorized account can approve or reject the sample after the two assessments. Approval requires all six checks to pass in both eligible reviews, no issue buckets, an unambiguous resolved connected call with a callback and transcript, verified frozen questionnaire content, a recorded actual execution agent/version, and the current normalization-rule/implementation hash. Rejection does not require the positive approval prerequisites. The decision reason and attestation are explicit.
5. Changed evidence, source ambiguity, rule changes or lost authorization invalidate current approval. Previous audit entries remain retained; stale entries never count as current approval. A corrected source requires new deliberate assessments against its new fingerprint, not edits to the old assessments.

Campaign Managers see a collapsed **Audited call-sample quality** summary in the research reporting panel. It covers the selected Iteration across **all Runs**, independently of age, gender or Mandal filters. Managers cannot retrieve private reviewer evidence or submit decisions. Campaigners cannot access this workflow. Existing campaign draft/privacy and assignment rules continue to apply.

## Evidence and audit boundary

- Binding uses provider attempt, execution, contact, voter, Run, Iteration and Campaign identities; duplicate or conflicting matches block approval.
- The actual agent/version comes from the retained execution request, never the current editable catalogue or a copied Iteration assignment.
- The fingerprint binds raw retained evidence, request, frozen questionnaire and current normalization rule/implementation bytes. Only frozen question-mapped output keys enter the private review display; arbitrary provider metadata does not.
- Positive approval additionally requires usable frozen output mappings, including mappings for required questions, and at least one mapped scalar structured-output record. Missing output evidence stays a diagnostic gap, not a passed extraction check. This prerequisite is not an interview-completion rule.
- Reviews and decisions are append-only with database mutation/truncate guards. Actor identity and timestamps are server-controlled, with current active account/role/access checks. Audit history is retained in the database; the panel shows current findings, latest decision and stale counts, not a full historical timeline.
- Evidence and decision revision conflicts return HTTP 409. The UI clears drafts and refreshes; it never automatically retries an approval.
- Notes must be short and sanitized. Obvious identifiers are rejected, but automated validation is not a guarantee of complete de-identification: reviewers must not paste names, transcript passages or personal information into notes.
- Audit-table protection is not an off-host backup, digital signature or defense against a database owner disabling triggers. Historical approval does not imply current eligibility.
- No historical reviews, questionnaire identities, methods or approvals are inferred or backfilled.

## API

| Endpoint | Access | Scope |
| --- | --- | --- |
| `GET /api/research-quality/executions/:executionId` | Admin / Super Admin | Verified private call evidence and permitted review state |
| `POST /api/research-quality/executions/:executionId/reviews` | Admin / Super Admin | Independent immutable assessment, expected evidence hash |
| `POST /api/research-quality/executions/:executionId/decisions` | Admin / Super Admin | Separate approver, expected evidence hash and decision revision |
| `GET /api/research-quality/campaigns/:campaignId?iterationId=:iterationId` | Authorized Admin / Super Admin / Campaign Manager | Aggregate counts for the entire selected Iteration |

The summary rejects Run/demographic narrowing and does not return call IDs, voter identifiers, reviewer names, notes, transcripts, raw outputs, language breakdowns or political ratings. It reports reviewed **calls**, not unique people. Missing audit schema is a compatibility absence, not a successful zero-review check; authorization, connection and unexpected SQL errors must not be converted to zero counts.

## Explicit deployment (not performed by the installer)

From the UI repository checkout on EC2:

```sh
node deployment/call-quality-review/install-call-quality-review.js /opt/sarvam-voice-analytics --dry-run
node deployment/call-quality-review/install-call-quality-review.js /opt/sarvam-voice-analytics
```

Then, through the approved release process:

```sh
cd /opt/sarvam-voice-analytics
node src/db/migrate-call-quality-review.js
node --check src/repositories/call-quality-review.js
node --check src/repositories/call-quality-review.repository.js
node --check src/routes/call-quality-review.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Deploy the matching frontend through the existing Amplify release process. Do not treat readiness HTTP 200 as proof of call-quality review success. Confirm source/authentication errors are shown as unavailable, not approved. The installer preflights dependencies and syntax, backs up changed runtime files, registers endpoint-specific authorization before legacy catalogue guards, and is idempotent. It performs no database migration, restart, calls, Sarvam edits or Quick publication.

## Live acceptance after release

- Use three genuinely distinct, authorized Admin/Super Admin accounts. Never reuse an account or create fabricated reviews to satisfy the independence gate; if reviewers are unavailable, leave the sample pending.
- With an approved retained test call, verify both reviewers deliberately choose every assessment and cannot see each other's findings beforehand. Verify that neither reviewer can decide their own sample, and the third approver cannot approve before two complete all-pass reviews exist.
- Deliberately record a supported diagnostic failure on a separate authorized test sample. Verify the positive decision stays blocked; a rejection requires the third account and two retained assessments.
- Verify Campaign Managers only see their authorized Iteration summary, Campaigners see no review workflow, and stale scope/evidence or a failed load cannot show an assumed approval.
- Confirm the existing research report still says human validation is pending. New operational sample approvals do not make old questionnaires, methods, sentiment labels or complete-interview statistics valid.

Do not mutate historical evidence just to demonstrate staleness. The isolated tests below cover source changes and conflicts; a real evidence correction should follow its own authorized workflow.

The migration creates only two empty audit tables and their indexes/guards in one transaction. It changes no call, transcript, questionnaire, voter or lifecycle record. Audit tables are intentionally outside the broader Quick migration chain. If rolling back the feature, remove its route registration and restore known runtime backups through the release process; retain audit tables/history rather than dropping them.

## Local validation

Run with the workspace's configured Node runtime:

```sh
node deployment/call-quality-review/test-call-quality-review.mjs
node deployment/call-quality-review/test-call-quality-review-ui.mjs
node deployment/call-quality-review/test-install-call-quality-review.mjs
PGLITE_MODULE_PATH=/absolute/path/to/@electric-sql/pglite/dist/index.js node deployment/call-quality-review/test-call-quality-review-sql.mjs
```

SQL tests use an isolated synthetic database, never the production RDS instance. Synthetic fixtures demonstrate permission, integrity and workflow behavior; they do not establish call-delivery quality, interview completion or sentiment accuracy for actual calls. Live acceptance requires deliberate human reviews of actual authorized evidence after deployment.

See [VALIDATION.md](./VALIDATION.md) for the recorded local checks and limitations.

Step 2 remains separate: distinguish complete, partial and technically unresolved interviews without equating connection or callback presence with survey completion.
