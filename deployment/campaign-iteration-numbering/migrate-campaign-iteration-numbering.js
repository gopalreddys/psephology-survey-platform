import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../sql/023_campaign_iteration_numbering.sql"
);
const db = await getDb();

try {
  console.log("Applying Campaign-local Iteration numbering migration...");
  await db.query(await readFile(migrationPath, "utf8"));
  console.log("Campaign-local Iteration numbering migration completed.");
} finally {
  await db.end?.();
}
