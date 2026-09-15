# Production readiness

The controlled demo workflow is validated. The following items are deliberately
separate from demo readiness and must be completed before production calling.

## Priority 0 — retain current safeguards

- Keep demo-only selection and provider-submission checks enabled.
- Keep Sarvam callback correlation, idempotency and lifecycle recovery enabled.
- Keep completed Runs, Iterations and Campaigns immutable.
- Do not place AWS, database or callback credentials in the repository.

## Priority 1 — production foundations

- Replace the RDS master login with a least-privilege application role and a
  separate managed application secret. Administrative migrations must continue
  to use a separately controlled credential.
- Add CloudWatch alarms for API readiness failure, service failure, stale
  callbacks and lifecycle-recovery failure.
- Define encrypted snapshot retention and complete a restore drill into an
  isolated environment.
- Add automated API authorization tests for every role and direct-resource URL.
- Add an end-to-end test covering call submission, idempotent callback,
  transcript retention, Run closeout and analysis refresh.

## Priority 2 — controlled production calling

- Replace the permanent demo-only boundary with an explicit environment mode.
- Require a Campaign approval state before production voters become callable.
- Record approving user, approved cohort, timestamp and immutable cohort hash.
- Apply configurable concurrency, calling-window and daily-volume limits.
- Add suppression, consent, retry and do-not-call policies appropriate to the
  operating jurisdiction.
- Preserve a final provider-submission guard so UI changes cannot bypass policy.

## Priority 3 — scale and research governance

- Validate concurrent Campaigners, multiple geographies and larger cohorts.
- Complete provider-supported Sarvam Agent App discovery; retain controlled
  manual registration while the provider catalogue returns no deployments.
- Version questionnaires, agent instructions and analysis definitions with each
  Iteration snapshot.
- Establish model-quality review for sentiment and predictive outputs.
- Add approved exports with access logging, masking and retention controls.

No production-mode switch should be implemented or enabled until Priority 1 is
accepted and the calling-policy requirements in Priority 2 are approved.
