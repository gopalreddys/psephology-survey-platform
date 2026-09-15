import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../sql/022_iteration_questionnaire_snapshot.sql"
);
const db = await getDb();
try {
  console.log("Applying Iteration questionnaire snapshot migration...");
  await db.query(await readFile(migrationPath, "utf8"));
  console.log("Iteration questionnaire snapshot migration completed.");
} finally {
  await db.end?.();
}
