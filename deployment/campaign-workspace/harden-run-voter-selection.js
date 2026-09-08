import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  process.argv[2] || "src/repositories/runs.repository.js"
);
let source = fs.readFileSync(routePath, "utf8");

if (!source.includes("selectAssignedVoters")) {
  const importAnchor = 'import {\n  getDb\n} from "../db/postgres.js";';
  if (!source.includes(importAnchor)) {
    throw new Error("Could not find the runs repository database import anchor");
  }
  source = source.replace(
    importAnchor,
    `${importAnchor}\n\nimport {\n  selectAssignedVoters\n} from "./campaign-voter-selection.repository.js";`
  );
}

const selectionPattern = /const selected\s*=\s*await db\.query\(\s*`[\s\S]*?`\s*,\s*\[\s*context\.jurisdiction_id\s*,\s*targetContacts\s*,\s*sourceName\s*\]\s*\);/m;
if (!selectionPattern.test(source)) {
  if (source.includes("selectAssignedVoters(db")) {
    console.log("Voter selection is already allocation-scoped.");
    process.exit(0);
  }
  throw new Error("Could not find the jurisdiction-wide voter selection block");
}

source = source.replace(selectionPattern, `const selected = await selectAssignedVoters(db, {
        iterationId,
        campaignerUserId: createdBy,
        targetContacts,
        sourceName
      });`);

const lengthCount = (source.match(/selected\.rows\.length/g) || []).length;
const rowCount = (source.match(/selected\.rows/g) || []).length;
if (!lengthCount || !rowCount) {
  throw new Error("Expected selected.rows references after replacing voter selection");
}
source = source.replaceAll("selected.rows.length", "selected.length");
source = source.replaceAll("selected.rows", "selected");

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${routePath}.bak-voter-selection-${timestamp}`;
fs.copyFileSync(routePath, backupPath);
fs.writeFileSync(routePath, source);

console.log(`Updated voter selection in ${routePath}`);
console.log(`Backup written to ${backupPath}`);
