import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "./postgres.js";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../sql/021_operational_lifecycle_audit.sql"
);
const db = await getDb();

console.log("Applying Campaign lifecycle governance migration...");
await db.query(await readFile(migrationPath, "utf8"));
console.log("Campaign lifecycle governance migration completed.");
process.exit(0);
