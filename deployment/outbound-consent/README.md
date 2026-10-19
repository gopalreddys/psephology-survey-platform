# Coordinated callback compatibility and outbound opt-out release

This is a guarded update for the existing, reviewed demo API. It is not a fresh
bootstrap installer, a Sarvam agent publication or a call-launch command.

## What changes

- Recognize Sarvam's `survey_completed`, partial/substantial feedback, callback,
  no-feedback and wrong-person dispositions in recorded interview coverage.
  A completion label alone never proves all required questions were recorded.
- Prevent partial/declined/wrong-person outputs from becoming operational
  success merely because some answers exist. Explicit do-not-call, refusal and
  wrong-number results are non-retryable. Unknown participation flags cannot
  certify success.
- Record explicit do-not-call requests in a sticky, append-only suppression
  ledger. Check both callback output containers before their normal merge, so
  a contradictory final field cannot erase an opt-out. Keep raw callback and
  merged answer evidence unchanged.
- Match bound provider attempts exactly. Metadata fallback may bind an as-yet
  unbound execution/request, but cannot overwrite a different bound attempt.
- Enforce suppression in cohort selection, Run preview, standalone reservation
  and the shared final Sarvam submission boundary. A duplicate voter record
  using the same canonical phone is also suppressed. A stopped voter remains
  stopped if their master number changes.
- New standalone requests retain their submitted destination. Opt-outs cover
  both the originally dialed and current master numbers when available.
- Correct three exact V1 answer mappings in native reporting without changing
  recorded answers, instrument identity, frozen contracts or history.

Natural, concise acknowledgements and one-time greetings remain appropriate.
Agent identity must remain truthful: these changes do not instruct the agent to
conceal that it is automated or impersonate a human. Campaign agent v7 was
separately committed on 19 October 2026 after the compatibility release; see
[the release checkpoint](RELEASE-20261019.md). This installer itself does not
change voice, prompts, app versions, connection IDs or call-session settings.

## Important limits

Identifier hashes are **sensitive pseudonymous data**, not anonymous data. Protect
the ledger and destination snapshots with the same database/access/retention
controls as contact records. No raw phone is stored in the suppression ledger;
the standalone request snapshot is a sensitive canonical phone in the existing
private request table and is not returned by the public demo-call list.

Transactions acquire canonical, sorted per-identity locks through provider
submission. An opt-out committed first vetoes the call. A call already accepted
before the opt-out cannot be retroactively cancelled by this check. Test the
installed dispatch path and concurrency/pool behavior before increasing volume;
local fixtures do not certify the live provider or production load.
Specifically inspect the installed `executeSarvamCall` chain: release/commit its
reservation client before entering guarded dispatch, and verify the unchanged
provider client does not obtain another pool client inside the guard. Otherwise
concurrent nested acquisitions can exhaust the current max-10 pool. The complete
live execution service is not present in this UI repository; this remains a
required deployment preflight, not a locally verified claim.

Older requests may lack the original destination; do not invent it from today's
master number. The audit reports this limitation. No automatic re-consent,
reactivation, Run closure, recovery/reclassification, questionnaire backfill or
historical callback replay is performed. Identity-only questionnaire snapshots
remain unverifiable; missing required auxiliary outputs remain incomplete.

## Controlled installation

Run from the UI repository **with its existing Next dependencies installed**.
The client patch uses an AST parser and rejects unknown signatures, exports,
partial patches and drift. It preserves the original provider function body.

Before a live release, review the installer plan against the actual runtime,
verify zero active provider calls, pause human launches and coordinate recovery
timers/other writers. Stopping the API can delay callbacks; keep the maintenance
window short and verify provider retries/reconciliation after startup. An
`--api-stopped` flag is an operator acknowledgement, not an automatic check.

```bash
node deployment/outbound-consent/install-outbound-consent.mjs /opt/sarvam-voice-analytics --dry-run
# After the reviewed quiet window and API stop:
node deployment/outbound-consent/install-outbound-consent.mjs /opt/sarvam-voice-analytics --apply --api-stopped
node /opt/sarvam-voice-analytics/src/db/migrate-outbound-consent.mjs /opt/sarvam-voice-analytics
node /opt/sarvam-voice-analytics/src/db/reconcile-recorded-optouts.mjs /opt/sarvam-voice-analytics --dry-run
```

The historical opt-out audit reads retained variables, raw callback containers
and explicit standalone dispositions. Review counts, missing original numbers
and identity failures. A reviewed `--apply` adds only suppression identifiers
with an explicit audit source; it never rewrites calls, transcripts, voters,
responses or contact/Run states. Do not resume launches until recorded opt-outs
are reconciled or unresolved identities/destinations are reviewed. The bounded
audit fails above 10,000 candidates in either source; use a reviewed paginated
audit for larger deployments.

After successful migration/audit, restart the API through the existing release
workflow, check `/ready`, verify authorized preview/reservation behavior, and
perform only a separately authorized, consented canary call. Check exact app
version, one greeting, actual respondent name, question progression, callback,
coverage, retry flags and suppression behavior. No call is made by these scripts.
If `OUTBOUND_SUBMISSION_STATE_UNCERTAIN` or
`providerSubmissionMayHaveOccurred` is reported, pause further launches and match
the provider attempt/callback before any retry; do not treat it as a confirmed
provider rejection merely because a surrounding legacy workflow shows Failed.

The installer preflights every target and dependency before writing, defaults to
read-only, backs up replaced files privately under `var/deployment-backups`,
preserves owner/mode and rolls back its own promotions on failure. Review any
reported rollback conflicts. It does **not** apply schema, restart services,
synchronize SQL normalization, publish Quick, change IAM or deploy the frontend.

Current legacy feature installers fail before writing unless the exact consent
artifacts and AST-validated guarded client are already present. This checks
files, not whether migration 035 ran. Do not deploy legacy/older-checkout
installers over this release; they can undo protections. After any other release,
repeat the coordinated dry-run and inspect runtime drift before enabling calls.

Do not clear/drop the ledger or restore an unguarded client to roll back an
application issue. Once opt-outs exist, any rollback must retain suppression and
be separately reviewed; pause launches until a compatible fix is available.

## Amazon Quick publication hold

The exact aided V1 `Other` choice extends the complete-partition disclosure
dictionary. Native JS mapping is included here, but **do not synchronize the new
SQL normalizer or refresh affected Quick/SPICE datasets under an older published
definition**. Rebuild/validate the same-version Quick definition, including its
`Other` person-key and whole-partition privacy guards, and coordinate publication
before refreshed reporting is exposed. See
`../output-variable-standardization/README.md`. No existing frozen report
contract is expanded just to permit this category.

## Local tests (no credentials/provider calls)

Use Node plus the existing UI dependencies. The SQL tests use an isolated PGlite
PostgreSQL engine, never the application database adapter. Set
`PGLITE_MODULE_PATH` to an installed `@electric-sql/pglite/dist/index.js` if it is
not resolvable in this checkout.
The installer fixture uses the immutable pre-release Git object
`0d33ad4d2c8eefa95140993877f5147a9237a512`; include that object in shallow CI
checkouts rather than substituting the current HEAD for the baseline.

```bash
node deployment/outbound-consent/test-outbound-consent.mjs
node deployment/outbound-consent/test-outbound-consent-sql.mjs
node deployment/outbound-consent/test-webhook-optout.mjs
node deployment/outbound-consent/test-webhook-linkage-sql.mjs
node deployment/outbound-consent/test-reconcile-recorded-optouts.mjs
node deployment/outbound-consent/test-install-outbound-consent.mjs
node deployment/outbound-consent/test-legacy-consent-prerequisites.mjs
node deployment/sarvam-outbound-webhook/test-call-completion-policy.js
node deployment/interview-completion/test-interview-completion.mjs
node deployment/interview-completion/test-interview-completion-sql.mjs
node deployment/output-variable-standardization/test-output-normalization.js
node deployment/amazon-quick-enterprise-dashboard/test-normalized-output-sql.js
node deployment/amazon-quick-enterprise-dashboard/test-quick-insights.mjs
```
