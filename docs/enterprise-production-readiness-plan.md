# Enterprise production readiness plan

## Purpose

The controlled demonstration is frozen at Git tag
`demo-freeze-2026-09-29`. Enterprise work must continue from `main` without
changing or re-tagging that release. The demo environment and its approved demo
contacts must not be treated as a production calling environment.

This plan defines the evidence required before real-voter calling is enabled.
Passing a code build or a user-interface walkthrough is not sufficient for a
production release.

## Release gates

### Gate 0 — preserve and isolate the demo

- Keep the demo Git tag, archived baseline and reference Campaign immutable.
- Create separate development, staging and production configuration boundaries.
- Use separate Secrets Manager secrets, databases, Cognito configuration and
  Sarvam credentials for production.
- Prevent production data from being copied into development or demo.
- Keep the production calling switch disabled.

**Exit evidence:** environment inventory, ownership matrix, data-flow diagram,
and proof that demo credentials cannot access production resources.

### Gate 1 — production foundation

#### Identity and database access

- Create a non-owner PostgreSQL application role with only the permissions used
  by the API.
- Retain a separately controlled migration role; the API must never use it.
- Store the application credential in a dedicated Secrets Manager secret,
  encrypted with an approved KMS key and scoped to the API instance role.
- Prove credential rotation without restarting the API and verify that rejected
  cached credentials are refreshed safely.
- Require MFA for privileged human access and review Cognito role mappings.

#### Network and edge protection

- Keep RDS private and accept traffic only from the API security group.
- Terminate TLS at the approved public edge and disallow direct public API-port
  access.
- Apply AWS WAF protections, request-size limits, throttling and strict CORS.
- Record the expected inbound and outbound network paths, including Sarvam
  callbacks and Secrets Manager access.

#### Observability and incident response

- Publish structured, correlation-ID-based API and call-workflow logs without
  phone numbers, transcripts, tokens or secret values.
- Alarm on readiness failure, service failure, authentication anomalies,
  callback delay, webhook rejection, lifecycle-recovery failure, database
  saturation, API latency/error rate and backup failure.
- Add an external `/health` and `/ready` canary and define availability and
  latency SLOs.
- Route alarms to an owned escalation channel and document severity, responder,
  acknowledgement time and recovery procedure.

#### Backup and disaster recovery

- Define business-approved RPO and RTO before selecting retention schedules.
- Enable encrypted automated RDS backups and point-in-time recovery.
- Store protected backups outside the failure boundary used by the live API;
  apply vault retention/lock controls appropriate to the risk assessment.
- Perform a restore into an isolated environment and validate schema, record
  counts, application readiness and representative evidence integrity.
- Retain the restore report, recovery-point identity, timestamps and checksum.

#### Automated quality gates

- Make lint, TypeScript, production build and deployment tests mandatory in CI.
- Add authorization tests for every role, method and direct-resource URL.
- Add an end-to-end test for submission, duplicate callback idempotency,
  transcript/response retention, retry eligibility, Run closeout and analysis
  refresh.
- Add database migration forward/rollback checks and dependency/security scans.
- Eliminate the existing repository lint errors before Gate 1 approval.

**Exit evidence:** approved access matrix; secret-rotation record; network
diagram; green CI report; alarm test; encrypted backup policy; successful
restore-drill report; and signed operational runbook.

### Gate 2 — controlled production calling

- Replace the permanent demo-only boundary with an explicit, default-deny
  environment mode. A source-code or UI-only change must not enable production
  dialing.
- Require Campaign approval before any real voter becomes callable.
- Record the approver, approval time, questionnaire and agent versions,
  jurisdiction, frozen cohort hash, purpose and expiry.
- Apply server-side calling windows, concurrency, daily-volume, retry and
  provider-rate limits.
- Implement consent, suppression and do-not-call rules approved for the
  operating jurisdiction, including immediate revocation handling.
- Require verified electorate eligibility appropriate to the election type;
  do not incorrectly require EPIC for electorates where it is not applicable.
- Preserve the final provider-submission policy guard so a client or UI change
  cannot bypass approval.
- Start with a small, monitored pilot and a tested kill switch.

**Exit evidence:** legal/policy approval; immutable Campaign approval record;
cohort-hash verification; pilot plan; kill-switch test; calling-limit test; and
on-call approval for the pilot window.

### Gate 3 — scale, analytics and research governance

- Load-test concurrent Campaigns, Campaigners, callbacks and analysis refreshes
  at the approved target plus safety margin.
- Version questionnaires, voice-agent instructions, output-variable definitions
  and analysis rules in every Iteration snapshot.
- Establish human review, calibration, drift monitoring and documented limits
  for sentiment or predictive outputs. Never present a model score as voting
  intent without validated methodology and representative evidence.
- Enforce minimum sample/evidence thresholds and visibly label directional,
  insufficient and non-comparable results.
- Provide masked, approval-controlled exports with access audit, retention and
  deletion policies.
- Validate dashboards by role, geography, age band and gender while enforcing
  minimum-cell rules that prevent re-identification.
- Complete performance, failover, recovery and security testing before raising
  calling limits.

**Exit evidence:** signed methodology; model-quality report; load/failover
results; privacy review; export-control test; and executive go-live approval.

## Work order

Implement the gates in this order:

1. Environment isolation and infrastructure-as-code baseline.
2. Least-privilege application database role and managed secret.
3. Backup policy plus an isolated restore drill.
4. Structured telemetry, alarms, canaries and incident routing.
5. CI quality gates, authorization matrix and end-to-end workflow test.
6. Production Campaign approval, cohort hashing and immutable audit record.
7. Calling policy engine, suppression/consent controls and kill switch.
8. Controlled pilot, capacity testing and research/model governance.

Gate 2 work may be designed while Gate 1 is being implemented, but production
calling must remain disabled until every Gate 1 exit artifact is accepted.

## Go-live decision record

The final production decision must record:

- Git commit and immutable release tag;
- infrastructure version and environment;
- database migration version;
- questionnaire, agent and analysis-definition versions;
- backup recovery-point identity and successful restore evidence;
- CI, authorization, E2E, load and failover results;
- active alarms, SLOs and named on-call owner;
- approved Campaign/calling policy version;
- accepted residual risks, approvers and UTC decision time.

Any failed mandatory control results in `NO_GO`. Warnings require a named owner,
expiry date and written risk acceptance; they cannot be silently converted to a
pass.
