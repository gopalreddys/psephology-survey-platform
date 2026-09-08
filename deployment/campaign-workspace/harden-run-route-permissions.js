import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  process.argv[2] || "src/routes/runs.routes.js"
);

const source = fs.readFileSync(routePath, "utf8");
const routes = [
  "/iterations/:iterationId/runs",
  "/runs/:runId/retry-cycle",
  "/runs/:runId/launch"
];

let updated = source;

for (const route of routes) {
  const start = updated.indexOf(`router.post(\n  "${route}"`);
  if (start < 0) {
    throw new Error(`Could not find POST route ${route}`);
  }

  const nextRoute = updated.indexOf("\n\n\nrouter.", start + 1);
  const end = nextRoute < 0 ? updated.length : nextRoute;
  const block = updated.slice(start, end);
  const roleMatches = [...block.matchAll(/requireRole\(\s*\[[\s\S]*?\]\s*\)/g)];

  if (roleMatches.length !== 1) {
    throw new Error(`Expected one requireRole block in ${route}, found ${roleMatches.length}`);
  }

  const roleBlock = roleMatches[0][0];
  const hardenedRoleBlock = `requireRole([\n      "CAMPAIGNER"\n    ])`;
  const hardenedBlock = block.replace(roleBlock, hardenedRoleBlock);
  updated = updated.slice(0, start) + hardenedBlock + updated.slice(end);
}

if (updated === source) {
  console.log("Run route permissions are already hardened.");
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${routePath}.bak-role-hardening-${timestamp}`;
fs.copyFileSync(routePath, backupPath);
fs.writeFileSync(routePath, updated);

console.log(`Updated Campaigner-only mutation permissions in ${routePath}`);
console.log(`Backup written to ${backupPath}`);
