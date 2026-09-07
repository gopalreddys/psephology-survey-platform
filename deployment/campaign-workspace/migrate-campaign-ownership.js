import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(currentDirectory, "../../sql/009_campaign_ownership_allocations.sql");

async function migrate() {
  const db = await getDb();
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Applying Campaign Ownership migration...");
  await db.query(sql);
  console.log("Campaign Ownership migration completed.");
}

migrate().then(function () { process.exit(0); }).catch(function (error) {
  console.error("Campaign Ownership migration failed:", error);
  process.exit(1);
});
