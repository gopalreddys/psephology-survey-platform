import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "./postgres.js";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../sql/023_quicksight_campaign_reporting.sql"
);
const db = await getDb();

try {
  console.log("Applying aggregate Analytics reporting view...");
  await db.query(await readFile(migrationPath, "utf8"));
  console.log("Analytics reporting view is ready.");
} finally {
  await db.end?.();
}
