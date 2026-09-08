import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(currentDirectory, "../../sql/015_user_role_changes.sql");

async function migrate() {
  const db = await getDb();
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Applying User Role Changes migration...");
  await db.query(sql);
  console.log("User Role Changes migration completed.");
}

migrate().then(
  () => process.exit(0),
  (error) => {
    console.error("User Role Changes migration failed:", error);
    process.exit(1);
  }
);
