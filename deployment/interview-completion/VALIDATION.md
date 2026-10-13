# Local source validation — 13 October 2026

This records validation of the demo Step 2 implementation, not live survey-completion or research sign-off. No AWS, RDS, Sarvam, historical call, questionnaire or voter records were changed. No calls were launched, commit pushed or deployment performed.

## Completed source checks

- All **28 test suites** passed in the final consolidated run: 19 existing reporting-contract, report, fieldwork, methodology, snapshot/launch-guard, comparison and normalization suites; four Step 1 call-quality suites; the existing outbound call-completion-policy suite; and four new Step 2 suites.
- The new suites cover pure frozen-contract and output-state logic, real isolated PostgreSQL-compatible repository reads, executable React/strict-response checks, and coordinated installation. SQL fixtures used PGlite 0.3.14, not production RDS. The earlier temporary test dependency disappeared after the environment changed; it was reinstalled into a new isolated temporary directory and the entire run was repeated successfully.
- Exact execution/contact/voter/Run/Iteration/provider binding, current active account/role checks, campaign visibility, manager reassignment, unknown schema versus verified zero, duplicate/ambiguous evidence and retained Run 1 cohort partitioning were tested.
- Latest-attempt-only assessment never unions retry answers. Undated attempts and a contact claiming an attempt without its exact execution fail technically unresolved, including a lost later retry after an older complete attempt. Orphan raw call records cannot become unattempted records.
- Explicit frozen completion declarations, required versus optional outputs, multiple required mapped keys, supported scalar/value contracts, unsupported conditional paths, zero/false/None, multilingual literal missing/uncertainty/refusal states and denied participation were tested. These tests do not validate language extraction or answer truth.
- Aggregate responses contain no individual execution/voter identifiers, answers, transcripts or political scores. A small non-zero outcome cell withholds the entire count partition and denominator. Private question diagnostics are Admin/Super Admin only and contain no raw answers or voter identifiers.
- UI tests cover actual React rendering, malformed or wrong-scope responses, current actor/role invalidation, late responses, rapid close/reopen races, collapsed read-only controls and backend/decoder compatibility. Installer tests cover complete preflight, safe mount order, Step 1 preservation, dry-run, backups and idempotency.
- TypeScript, scoped ESLint and whitespace checks passed. The Next.js 16.3.4 production build passed with `next build --webpack` and process-only synthetic Cognito values. No synthetic values were saved in deployment configuration. The normal Amplify build with real configuration still requires release verification.
- Independent read-only review identified reserved-state drift, undated-attempt ordering and claimed-attempt-without-execution gaps; these were corrected and covered by regression fixtures. Code review is not a security certification.

## Still required through an approved release

Follow [README.md](./README.md) for runtime installation and deployment. Step 2 needs no database migration and does not persist classifications. Confirm the matching API/frontend release with authorized retained evidence, role restrictions, frozen completion declarations, whole-Iteration scope and small-cell withholding. Existing instruments without sufficient frozen declarations must stay unresolved; do not backfill historical content to manufacture a pass.

Browser screenshot and desktop/mobile layout acceptance have not been completed. Executable rendering tests and the build passed, but these do not substitute for visual acceptance. The prior local preview was blocked by browser policy; no alternative surface or policy workaround was attempted.

Existing call-success policy, retry eligibility, Run/campaign lifecycle, research exports, `humanValidation: PENDING` and unvalidated fieldwork completion indicators remain unchanged. Automated recorded coverage is not independent interview validation, a survey response rate, representative sampling, sentiment accuracy or population/party-strength certification. Genuine Step 1 human assessments and the remaining methodology/reporting checks remain separate work.

Unrelated pre-existing production-readiness document changes were left untouched.
