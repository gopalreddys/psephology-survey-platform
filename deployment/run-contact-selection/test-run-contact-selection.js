import assert from "node:assert/strict";
import {
  MARKER,
  patchRunLaunchRoute,
  patchRunLaunchService
} from "./run-contact-selection.patch.js";

const routeFixture = `
router.post(
  "/runs/:runId/launch",
  requireAuth,
  requireRole(["CAMPAIGNER"]),
  async function (req, res) {
    try {
      const requestedLimit = Number(req.body?.limit || 1);
      const result = await launchRun({
        runId: req.params.runId,
        limit: requestedLimit
      });
      return res.json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);


router.get("/next", handler);
`;

const contactQuery = `
      SELECT rc.id
        FROM campaign_run_contacts rc
        JOIN voter_master voter ON voter.id = rc.voter_id
        WHERE
          rc.run_id = $1
          /* RUN_LAUNCH_DEMO_ONLY */
          AND voter.is_demo_contact = TRUE
        ORDER BY rc.id
        LIMIT $2
    `;

const serviceFixture = `
export async function launchRun({ runId, limit = 1 }) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, 50));
  let contactsResult;
  if (cycle.cycle_type === "INITIAL") {
    contactsResult = await db.query(\`${contactQuery}\`, [runId, safeLimit]);
  } else {
    contactsResult = await db.query(
      \`${contactQuery.replace("LIMIT $2", "LIMIT $3")}\`,
      [runId, Number(cycle.max_attempts_per_voter), safeLimit]
    );
  }
  const contacts = contactsResult.rows;
  return contacts;
}
`;

const route = patchRunLaunchRoute(routeFixture);
assert.match(route, new RegExp(MARKER));
assert.match(route, /runContactIds: requestedContactIds/);
assert.match(route, /uuidPattern/);
assert.doesNotMatch(route, /requestedContactIds\$2/);
assert.doesNotThrow(() => new Function(route));
assert.equal(patchRunLaunchRoute(route), route);

const service = patchRunLaunchService(serviceFixture);
assert.match(service, new RegExp(MARKER));
assert.equal(
  service.match(/rc\.id = ANY\(\$2::uuid\[\]\)/g)?.length,
  1
);
assert.equal(
  service.match(/rc\.id = ANY\(\$3::uuid\[\]\)/g)?.length,
  1
);
assert.equal(service.match(/LIMIT \$3/g)?.length, 1);
assert.equal(service.match(/LIMIT \$4/g)?.length, 1);
assert.equal(
  service.match(/\[runId, selectedContactFilter, safeLimit\]/g)?.length,
  1
);
assert.equal(
  service.match(/\[runId, Number\(cycle\.max_attempts_per_voter\), selectedContactFilter, safeLimit\]/g)?.length,
  1
);
assert.match(service, /statusCode = 409/);
assert.doesNotThrow(
  () => new Function(service.replace("export async function", "async function"))
);
assert.equal(patchRunLaunchService(service), service);

assert.throws(
  () => patchRunLaunchRoute("router.get('/missing', handler);"),
  /Unable to find/
);

console.log("Run contact selection patch tests passed.");
