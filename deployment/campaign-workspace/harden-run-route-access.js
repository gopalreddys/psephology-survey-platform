import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  process.argv[2] || "src/routes/runs.routes.js"
);
let source = fs.readFileSync(routePath, "utf8");

const accessImports = `\nimport {\n  assertIterationAccess\n} from "../repositories/iteration-access.repository.js";\n\nimport {\n  assertRunAccess\n} from "../repositories/run-access.repository.js";\n`;

if (!source.includes("assertIterationAccess")) {
  const anchor = 'import {\n  requireGeographyAccess\n} from "../middleware/geography.middleware.js";';
  if (!source.includes(anchor)) throw new Error("Could not find geography middleware import anchor");
  source = source.replace(anchor, `${anchor}${accessImports}`);
}

const guards = [
  {
    route: 'router.get(\n  "/iterations/:iterationId/runs"',
    guard: `        await assertIterationAccess(\n          req.params.iterationId,\n          req.platformUser\n        );`
  },
  {
    route: 'router.post(\n  "/iterations/:iterationId/runs"',
    guard: `        await assertIterationAccess(\n          req.params.iterationId,\n          req.platformUser\n        );`
  },
  {
    route: 'router.post(\n  "/runs/:runId/retry-cycle"',
    guard: `        await assertRunAccess(\n          req.params.runId,\n          req.platformUser,\n          { mutate: true }\n        );`
  },
  {
    route: 'router.post(\n  "/runs/:runId/launch"',
    guard: `        await assertRunAccess(\n          req.params.runId,\n          req.platformUser,\n          { mutate: true }\n        );`
  }
];

for (const item of guards) {
  const start = source.indexOf(item.route);
  if (start < 0) throw new Error(`Could not find route ${item.route}`);
  const nextRoute = source.indexOf("\n\n\nrouter.", start + 1);
  const end = nextRoute < 0 ? source.length : nextRoute;
  const block = source.slice(start, end);
  let hardenedBlock = block;

  if (!hardenedBlock.includes(item.guard)) {
    const tryIndex = hardenedBlock.indexOf("try {");
    if (tryIndex < 0) throw new Error(`Could not find handler body for ${item.route}`);
    const insertionPoint = tryIndex + "try {".length;
    hardenedBlock = hardenedBlock.slice(0, insertionPoint) + `\n\n${item.guard}` + hardenedBlock.slice(insertionPoint);
  }

  // Campaign iteration allocations are the authorization boundary for Runs.
  // The legacy geography middleware checks user_geo_assignments instead and
  // incorrectly rejects Campaigners who have a valid campaign allocation.
  hardenedBlock = hardenedBlock.replace(
    /\brequireGeographyAccess\s*,\s*/g,
    ""
  );

  if (hardenedBlock === block) continue;
  source = source.slice(0, start) + hardenedBlock + source.slice(end);
}

// Preserve authorization status codes instead of converting them to 500s.
source = source.replaceAll(".status(500)", ".status(error.statusCode || 500)");

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${routePath}.bak-access-hardening-${timestamp}`;
fs.copyFileSync(routePath, backupPath);
fs.writeFileSync(routePath, source);

console.log(`Updated Run route authorization in ${routePath}`);
console.log(`Backup written to ${backupPath}`);
