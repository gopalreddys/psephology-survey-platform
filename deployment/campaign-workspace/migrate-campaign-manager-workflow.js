import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(currentDirectory, "../../sql/016_campaign_manager_workflow.sql");

async function migrate() {
  const db = await getDb();
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Applying Campaign Manager Workflow migration...");
  await db.query(sql);
  console.log("Campaign Manager Workflow migration completed.");
}

migrate().then(
  () => process.exit(0),
  (error) => {
    console.error("Campaign Manager Workflow migration failed:", error);
    process.exit(1);
  }
);
