import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(currentDirectory, "../../sql/012_campaign_iteration_ownership.sql");

async function migrate() {
  const db = await getDb();
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Applying Campaign Iteration Ownership migration...");
  await db.query(sql);
  console.log("Campaign Iteration Ownership migration completed.");
}

migrate().then(function () { process.exit(0); }).catch(function (error) {
  console.error("Campaign Iteration Ownership migration failed:", error);
  process.exit(1);
});
