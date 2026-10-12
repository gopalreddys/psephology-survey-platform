# Local validation — 12 October 2026

This is a source-release validation record, not a deployed-system or survey
research sign-off. No live AWS, RDS, Sarvam, questionnaire or calling records
were changed during these checks.

## Completed checks

- Contract validation, role protection, schema discovery, metadata preservation,
  stale fingerprints and concurrent questionnaire-selection safeguards.
- Actual isolated PostgreSQL-engine contract tests, including JSONB writes,
  relation ambiguity and used-instrument locking.
- Report scope authorization, frozen-content hashing, exact output-key and
  categorical-answer binding, explicit target identity, missingness, coherent
  denominators and whole-distribution small-cell withholding.
- Actual isolated PostgreSQL-engine reporting tests: latest eligible response
  across Runs, exact-key projection, demographic/Mandal filters, evidence
  timestamps and absent-registry fallback.
- Executable UI tests: used instruments remain read-only; malformed responses,
  wrong scopes, stale requests and inconsistent aggregates cannot enable export;
  unexpected participant fields are rejected; report HTML escapes content.
- Installer dry-run, prerequisites, safe router order, backups and idempotency.
- Existing questionnaire snapshot/launch guard, methodology registry,
  comparison gate and output-normalization regressions remain passing.
- Scoped ESLint, TypeScript no-emit and diff whitespace checks.
- Production build using `next build --webpack`, with synthetic Cognito
  environment values for build-only prerender validation. These are not
  deployment credentials and were not saved to any environment file.
- Browser review of actual React components with synthetic fixtures: desktop
  status boxes share dimensions; 390-pixel layout has no page overflow;
  coverage tables scroll inside a focusable region; printable report preserves
  source, bases, methods, limitations and report-payload checksum context.

The default Turbopack build could not finish locally because its CSS worker
port binding was blocked by the execution environment. Webpack compilation,
TypeScript, all 16 static pages and route generation completed successfully.
Verify the normal Amplify build with its existing real configuration at release.

## Additional schema-2 cohort coverage checks

The V2 increment passed the combined **19 regression suites**, including the
two new fieldwork diagnostics suites and all earlier methodology/reporting,
snapshot, comparison and normalization checks. The matching frontend passed
scoped lint, TypeScript and the same Webpack production-build verification.

Additional checks cover:

- Distinct retained Run 1 database IDs as the baseline, with matched executions
  across retries; unattempted contacts are retained and outside/standalone calls
  do not improve initial-cohort coverage.
- Exact contact/Run/voter/provider identity, known execution states, true
  technical unknowns, blank provider IDs and missing-schema fallback.
- Current-master gender, age and Mandal composition; missing demographics remain
  unknown, not excluded. No eligible-frame or completed-interview evidence is
  fabricated from demo approval or operational success.
- Scope-bound diagnostics in the report checksum and both exports. Copied
  Campaign/Iteration/filter context and visibly inconsistent bases fail closed
  or require reconciliation rather than silently certifying coverage.
- Complete outcome/stage suppression, demographic cells and complements, and
  removal of tiny dynamic Mandal labels. Unsafe identifier/contact-like labels
  and unexpected nested participant fields do not enter exports.
- Verified zero counts remain zero; a zero denominator is not a calculated rate.
  Missing and withheld values remain unavailable, not zero.
- Desktop and 390-pixel browser review: new diagnostics are in one collapsed
  section by default; tables scroll in focusable regions without page overflow.

These checks establish aggregate contact-cohort diagnostics, not population
bias estimates or standardized survey response rates. Actual probability
sampling, frozen electoral frames and validated survey dispositions remain
separate future work described in [SAMPLING-NEXT.md](./SAMPLING-NEXT.md).

## Required after deployment

Follow the acceptance list in [README.md](./README.md). Verify the routes against
the real question relation and demonstrate save/reload using an unused test
questionnaire. Confirm role restrictions and filter/export parity in the live UI.
Commit and deploy the matching Sarvam question/extraction definitions separately;
contract authoring does not verify provider delivery.

Independent multilingual real-call review, statistical sampling/nonresponse and
weighting validation, and new scheme/named-leader aggregation remain separate
work. Historic demo gaps stay explicit; they are not retroactively repaired.
