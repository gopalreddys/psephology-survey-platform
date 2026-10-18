# Research catalog access governance

The canonical Voter Master contains direct identifiers and contact details, and
the questionnaire library controls the research instrument used by future
Iterations. Those two workspaces are therefore limited to `SUPER_ADMIN` and
`ADMIN` users.

Campaign Managers continue to select an approved questionnaire through the
campaign-specific Iteration endpoint. Campaigners continue to receive only
their allocated Iterations, masked Run contacts and execution evidence.

The frontend removes both sidebar entries for Campaign Manager and Campaigner
roles and rejects direct page navigation. The API applies Admin-only middleware
only to the catalogue URL families, not to every request under `/api`.

## Scoped guard correction (V2)

The former `RESEARCH_CATALOG_ADMIN_GUARD_V1` used an unscoped `router.use(...)`.
When mounted at `/api` before the campaign router, it rejected Campaign Managers
and Campaigners even for unrelated campaign/Run requests. V2 replaces that known
guard with path-scoped middleware, preserving all endpoint handlers and existing
Admin-only catalogue access. Reordering routers or granting broader roles is not
the fix.

The operator parses the actual JavaScript using the Acorn parser already bundled
with the UI project's declared Next dependency. Run it from the installed UI
checkout after its normal dependencies are installed; no new API dependency is
installed. It inventories every static route and refuses unknown/dynamic paths,
router aliases, chained registrations and conflicting/misplaced guards.

Known families are `/voters`, `/questionnaires`, and `/questions` when present.
The live questionnaire router also contains the legacy exact
`/iterations/:iterationId/questionnaire` attachment endpoint. That endpoint keeps
its effective Admin-only protection; the guard does **not** cover all
`/iterations` URLs or allow Campaign Managers to use that legacy mutation.

Both route files pass preflight before any backup or replacement. Dry-run writes
nothing. Application preserves file ownership and modes, creates private recoverable backups,
uses atomic per-file replacement, rechecks for concurrent edits, and restores
already-promoted originals if later promotion fails. Repeated installation is
idempotent. Stop other deployment tools during this short two-file operation.
No roles, campaign ownership, questionnaire content or database records change.

## Validate locally

```bash
node deployment/research-catalog-access/test-research-catalog-access.js
node deployment/research-catalog-access/test-scoped-catalog-routing.mjs
```

The second command defaults to a dependency-free router harness. To repeat the
same authorization matrix with the API's **actual Express** package, without
loading production routers or database code:

```bash
node deployment/research-catalog-access/test-scoped-catalog-routing.mjs \
  --express-root=/opt/sarvam-voice-analytics
```

That optional test starts an ephemeral loopback-only fixture server, not the
live API. It reproduces the old cross-router denial, verifies both catalogue
mount orders, checks Admin/Super Admin access and non-Admin denial, confirms
unrelated routes never invoke catalogue authorization, and retains the separate
Campaigner-only launch boundary. It performs no database/provider calls.

## Install on the API host

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/research-catalog-access/install-research-catalog-access.js /opt/sarvam-voice-analytics --dry-run

# Review the printed endpoint inventory and require both files to pass first.
node deployment/research-catalog-access/install-research-catalog-access.js /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/routes/voters.routes.js
node --check src/routes/questionnaires.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

After the separately approved API restart, verify that Admin and Super Admin can
use both workspaces and that authenticated Campaign Manager and Campaigner
requests to `/api/voters`, `/api/voters/summary`, `/api/questionnaires` and the
legacy questionnaire-attachment endpoint receive `403`. Verify an assigned
Campaign Manager can again load their campaign list/detail/iterations and change
an eligible iteration's agent version. Unassigned campaigns must remain hidden;
only the assigned Campaigner may launch calls. Readiness alone does not validate
these role boundaries. This correction does not grant Campaign Managers the
ability to create campaigns, which remains Admin/Super Admin-only.
