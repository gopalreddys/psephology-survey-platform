# Psephology Survey Platform

An operational research platform for studying voter thought processes through
Programs, Campaigns, Iterations and controlled outbound voice Runs.

## Research lifecycle

```text
Program → Campaign → Iteration → Run → Evidence → Analysis
```

- Super Admins and Admins define Programs and Campaign scope.
- An Admin assigns every operational Campaign to a Campaign Manager.
- The Campaign Manager creates Iterations, selects a Sarvam voice agent and
  allocates work.
- Assigned Campaigners create and execute up to three governed Runs.
- Sarvam callbacks persist call outcomes, duration, transcripts and response
  variables in AWS PostgreSQL.
- Iteration, Campaign and Program dashboards aggregate the retained evidence.

## Safety boundaries

- The current deployment is in controlled demo mode. Run selection and final
  provider submission accept only voters explicitly marked
  `is_demo_contact = TRUE`.
- Completed Runs, Iterations and Campaigns are read-only.
- Campaign and Iteration access is enforced by the API as well as the UI.
- `/health` checks process liveness; `/ready` verifies database connectivity.
- RDS-managed credential rotation is recovered without restarting the API.

## Applications

- `src/` contains the Next.js user interface.
- The Express API is deployed separately at
  `/opt/sarvam-voice-analytics` on the application host.
- `deployment/` contains versioned, idempotent packages that install API and
  database changes into that runtime.

## Local UI checks

```bash
npm run lint
npm run build
```

## Operations

- [Demo operations runbook](docs/demo-operations-runbook.md)
- [Production readiness](docs/production-readiness.md)
- [Release baseline auditor](deployment/demo-release-baseline/README.md)
- [Database credential resilience](deployment/database-resilience/README.md)
- [Campaign lifecycle recovery](deployment/campaign-lifecycle-governance/README.md)
- [Sarvam callback integration](deployment/sarvam-outbound-webhook/README.md)

Deployment packages must be dry-run or syntax-checked as documented before the
API is restarted. Never place credentials, callback tokens, voter phone numbers
or transcript content in Git, terminal screenshots or release manifests.
