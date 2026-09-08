import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  process.argv[2] || "src/routes/users.routes.js"
);
let source = fs.readFileSync(routePath, "utf8");

const routeStart = source.search(/router\.post\(\s*["']\/users["']/m);
if (routeStart < 0) {
  throw new Error("Could not find the POST /users route");
}

const routeTail = source.slice(routeStart + 1);
const nextRouteOffset = routeTail.search(/\n\s*router\.(?:get|post|patch|put|delete)\(/m);
const nextRoute = nextRouteOffset < 0
  ? -1
  : routeStart + 1 + nextRouteOffset;
const routeEnd = nextRoute < 0 ? source.length : nextRoute;
const block = source.slice(routeStart, routeEnd);

if (!block.includes("requireAuth")) {
  throw new Error("POST /users is not protected by requireAuth");
}

const roleGuardPattern = /requireRole\(\s*(?:\[[\s\S]*?\]|[A-Za-z_$][\w$]*)\s*\)/m;
let hardenedBlock;

if (roleGuardPattern.test(block)) {
  hardenedBlock = block.replace(
    roleGuardPattern,
    'requireRole(["SUPER_ADMIN", "ADMIN"])'
  );
} else {
  const authIndex = block.indexOf("requireAuth");
  const authEnd = authIndex + "requireAuth".length;
  hardenedBlock = `${block.slice(0, authEnd)},\n  requireRole(["SUPER_ADMIN", "ADMIN"])${block.slice(authEnd)}`;
}

if (!hardenedBlock.includes('requireRole(["SUPER_ADMIN", "ADMIN"])')) {
  throw new Error("Could not enforce the Super Admin/Admin role guard on POST /users");
}

source = source.slice(0, routeStart) + hardenedBlock + source.slice(routeEnd);

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${routePath}.bak-user-creation-access-${timestamp}`;
fs.copyFileSync(routePath, backupPath);
fs.writeFileSync(routePath, source);

console.log(`Restricted POST /users to SUPER_ADMIN and ADMIN in ${routePath}`);
console.log(`Backup written to ${backupPath}`);
