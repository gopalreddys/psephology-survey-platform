# Controlled platform consolidation release

Release `PLATFORM_CONSOLIDATION_20261013_V1` packages the lifecycle, runtime-health, reporting-consistency, authorized-scope and Amazon Quick embed-access corrections as **one explicit backend file manifest**. It replaces chaining several overlapping installers for this release. Historical migrations, agent versions, transcripts, declarations and audit evidence are not deleted or backfilled.

This is a file-release tool, not an enterprise-readiness certification, database migration system, service manager or AWS publisher. Frontend deployment remains separate. Quick dataset/RLS provisioning, dashboard definition validation/publication and SPICE refresh remain separately approved tasks.

Demographic/geographic reporting still uses **current voter-master data**, not immutable selection-time snapshots. No historical snapshot is invented. Sparse-cell and complementary suppression corrections are not a formal guarantee against every arbitrary cross-filter or repeated-query inference; enterprise disclosure controls and privacy review remain required. Operational readiness/completion is not methodology, representativeness, sentiment validation or human call-quality sign-off.

## Before promotion

1. Use the reviewed source checkout and exact release version. Run the isolated tests below. Review the dry-run file paths and before/after SHA-256 hashes; stop if the existing runtime has unexpected edits.
2. Confirm all prerequisite releases are already installed, including the current server route registrations and SQL files 024–032. This release validates existing registrations; it never patches `src/server.js` or silently installs missing older workflows.
3. Install/verify the **backend** `@aws-sdk/client-quicksight` dependency through your approved package/lockfile process. The installer verifies that runtime dependencies resolve inside this API's `node_modules`; it does not install packages, change package.json or use globally available substitutes. The browser Embedding SDK is a different frontend dependency.
4. Obtain the normal release approval and an appropriate recoverable database backup before any separately approved SQL changes. No RDS snapshot or off-host backup is created by this tool.
5. Stop the API, scheduled jobs touching these modules and other deployment tools for the multi-file promotion. `--ack-api-stopped` records the operator's confirmation; it does **not** verify or stop processes. A backend must not serve requests while files are being replaced.

## Preflight / dry run

From the UI repository checkout, not `/home/ec2-user`:

```sh
cd /opt/psephology-survey-ui/psephology
node deployment/platform-consolidation/test-platform-consolidation.mjs
node deployment/platform-consolidation/install-platform-consolidation.mjs /opt/sarvam-voice-analytics
```

Dry run is the default. It performs source/target containment and no-symlink checks, requires existing targets except the explicitly listed new helpers/migration, validates all referenced relative modules, installed package resolution and existing `/api` route-registration anchors, and runs `node --check` against every staged release JavaScript file plus the existing server. JSON release files are parsed. A temporary isolated syntax-check tree is removed after validation; no API target, backup, release ledger or process is changed.

SQL-file availability is checked, but no database schema query, SQL execution or semantic SQL validation occurs. Source registration checks are not proof that a running process has loaded the new code. JavaScript preflight does not execute application modules, test external service connectivity or establish research validity.

## Apply after approval and process stop

```sh
node deployment/platform-consolidation/install-platform-consolidation.mjs \
  /opt/sarvam-voice-analytics --apply --ack-api-stopped
```

Preflight must pass in full before promotion starts. The installer acquires an exclusive release lock and rechecks source/runtime hashes against the preflight snapshot. Only manifest-owned files are replaced. Existing file permissions are preserved; new modules use mode 0644. Existing originals are retained in:

```text
/opt/sarvam-voice-analytics/var/platform-releases/<exact-release-id>/backups/<runtime-relative-path>
/opt/sarvam-voice-analytics/var/platform-releases/<exact-release-id>/release.json
```

The ledger records the version, source-content manifest hash, original/replacement hashes, paths, permissions, promoted targets and final status. Backups are checksum-verified and readable only by the deploying account by default. They are local recoverable file backups, not off-host backups or database snapshots. No application secrets or voter answers are included in this manifest.

Each replacement uses an adjacent temporary file and atomic rename. On a caught failure, every already promoted file is restored in reverse order; newly added release-owned helpers are removed. A rollback failure is explicitly recorded and raised for operator review. **This is per-file atomic promotion with compensating rollback, not a filesystem-wide transaction.** A process kill, machine crash or power loss is not automatically recovered. Keep the API stopped and inspect the ledger/backups before resolving an incomplete release. Do not remove an unknown live release lock or overwrite a later operator change.

Reapplying identical content returns `UNCHANGED` and creates no duplicate release. Do not run older overlapping installers afterward: they can overwrite the consolidated modules outside this release ledger.

## Separate database and activation steps

The manifest ships additive `sql/034_reporting_consistency.sql` and the updated Amazon Quick migration runner. **Copying these files does not apply their SQL.** Review and apply the database change through a separately approved, tested database procedure. The migration runner replays its declared historical SQL prerequisites; confirm compatibility rather than treating it as a new migration ledger or automatically executing it from this installer.

Only after coordinated backend/database verification should the operator restart services and deploy the matching frontend. Validate `/ready`, authorized account scopes, blocked incomplete Iteration completion, deployment-bound health evidence, legacy navigation and new research setup. No outbound calls or human review submission are required for the file installer test.

Validate Quick definition changes against AWS-supported syntax and all six report sheets, sparse-cell/complement fixtures, filters and freshness before publication. Restricted Admin embedding intentionally fails closed until unique active non-owner Reader mappings and approved enabled `GRANT_ACCESS`/`VERSION_2` UserARN rules are configured on **every** dashboard dataset. Actual rules rows and permitted/unrelated/unassigned Campaign boundaries must be tested; native report filters do not provide that authorization. The existing Super Admin portfolio preview can remain separately configured. See [SDK configuration and release requirements](../amazon-quick-enterprise-dashboard/SDK-EMBEDDING.md).

## File rollback

Keep the API and other writers stopped. Use the exact release ID printed by the installer, not a glob:

```sh
node deployment/platform-consolidation/install-platform-consolidation.mjs \
  /opt/sarvam-voice-analytics --rollback EXACT_RELEASE_ID --ack-api-stopped
```

Rollback validates **all** current replacement hashes and backup hashes before its first restore. It refuses to overwrite a later runtime edit. Original manifest-owned files are restored and only newly created release-owned helpers are removed; the ledger and backups remain. The restored files can be recovered from these local backups.

This rolls back code/files only. It does not reverse SQL, change Quick assets/RLS/SPICE, revert the frontend or restart services. If database migrations have already been applied, first review code/schema compatibility and the coordinated rollback/roll-forward plan. Do not assume a code rollback restores the entire application state.

## Test coverage

The isolated test uses only exact temporary directories created by the test. It verifies:

- Default dry run with no runtime metadata or target edits.
- Required process-stop acknowledgment.
- Missing existing targets, relative modules, installed SDK, syntax and route mounts fail before promotion.
- Source/target symlinks and path traversal fail closed.
- Apply, SHA-256 originals/ledger, idempotent reapply and recoverable manual rollback.
- Mid-promotion failure restores both modified originals and a newly added helper.
- Manual rollback refuses later user changes before replacing any file.

It does not mutate EC2, AWS, databases, live reports, consented contacts or historical evidence.
