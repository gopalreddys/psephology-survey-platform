import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const marker = "RESEARCH_CATALOG_ADMIN_GUARD_V1";
const routeFiles = ["voters.routes.js", "questionnaires.routes.js"];

function addRoleImport(source, routePath) {
  if (source.includes("../middleware/role.middleware.js")) return source;

  const authImport = /import\s+\{\s*requireAuth\s*\}\s+from\s+["']\.\.\/middleware\/auth\.middleware\.js["'];/m;
  if (!authImport.test(source)) {
    throw new Error(`Cannot find requireAuth import in ${routePath}`);
  }

  return source.replace(
    authImport,
    (anchor) => `${anchor}\nimport { requireRole } from "../middleware/role.middleware.js";`
  );
}

function addAdminGuard(source, routePath) {
  if (source.includes(marker)) return source;

  const routerDeclaration = /const\s+router\s*=\s*express\.Router\(\);/m;
  if (!routerDeclaration.test(source)) {
    throw new Error(`Cannot find Express router declaration in ${routePath}`);
  }

  return source.replace(
    routerDeclaration,
    (anchor) => `${anchor}\n\n/* ${marker} */\nrouter.use(requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]));`
  );
}

for (const routeFile of routeFiles) {
  const routePath = path.join(runtimeRoot, "src/routes", routeFile);
  const original = await readFile(routePath, "utf8");
  const guarded = addAdminGuard(addRoleImport(original, routePath), routePath);

  if (guarded === original) continue;

  await copyFile(routePath, `${routePath}.bak-research-catalog-access-${Date.now()}`);
  await writeFile(routePath, guarded);
}

console.log(`Restricted Voter Master and questionnaire design APIs to Admin roles in ${runtimeRoot}`);
