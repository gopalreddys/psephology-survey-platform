import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  process.argv[2] || "src/routes/runs.routes.js"
);
let source = fs.readFileSync(routePath, "utf8");

function removeMiddlewareCall(block, middlewareName) {
  let updated = block;

  while (true) {
    const nameIndex = updated.indexOf(middlewareName);
    if (nameIndex < 0) return updated;

    let openIndex = nameIndex + middlewareName.length;
    while (/\s/.test(updated[openIndex] || "")) openIndex += 1;

    // A bare middleware reference is supported for older route variants.
    if (updated[openIndex] !== "(") {
      let endIndex = openIndex;
      while (/\s/.test(updated[endIndex] || "")) endIndex += 1;
      if (updated[endIndex] === ",") endIndex += 1;
      updated = updated.slice(0, nameIndex) + updated.slice(endIndex);
      continue;
    }

    let depth = 0;
    let quote = null;
    let escaped = false;
    let closeIndex = -1;

    for (let index = openIndex; index < updated.length; index += 1) {
      const character = updated[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }

    if (closeIndex < 0) {
      throw new Error(`Could not parse ${middlewareName}(...) in ${routePath}`);
    }

    let endIndex = closeIndex + 1;
    while (/\s/.test(updated[endIndex] || "")) endIndex += 1;
    if (updated[endIndex] === ",") endIndex += 1;

    updated = updated.slice(0, nameIndex) + updated.slice(endIndex);
  }
}

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
  hardenedBlock = removeMiddlewareCall(
    hardenedBlock,
    "requireGeographyAccess"
  );

  if (hardenedBlock === block) continue;
  source = source.slice(0, start) + hardenedBlock + source.slice(end);
}

// Preserve authorization status codes instead of converting them to 500s.
source = source.replaceAll(".status(500)", ".status(error.statusCode || 500)");

for (const item of guards) {
  const start = source.indexOf(item.route);
  const nextRoute = source.indexOf("\n\n\nrouter.", start + 1);
  const end = nextRoute < 0 ? source.length : nextRoute;
  const block = source.slice(start, end);

  if (block.includes("requireGeographyAccess")) {
    throw new Error(`Legacy geography middleware remains in ${item.route}`);
  }

  if (!block.includes(item.guard)) {
    throw new Error(`Campaign allocation guard is missing from ${item.route}`);
  }
}

const geographyImportPattern =
  /(^|\n)import \{\s*requireGeographyAccess\s*\} from "\.\.\/middleware\/geography\.middleware\.js";\n/;
const sourceWithoutGeographyImport = source.replace(geographyImportPattern, "$1");

if (!sourceWithoutGeographyImport.includes("requireGeographyAccess")) {
  source = sourceWithoutGeographyImport;
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${routePath}.bak-access-hardening-${timestamp}`;
fs.copyFileSync(routePath, backupPath);
fs.writeFileSync(routePath, source);

console.log(`Updated Run route authorization in ${routePath}`);
console.log(`Backup written to ${backupPath}`);
