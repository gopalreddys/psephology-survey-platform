import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDirectory,
  "../../sql/018_voter_demo_contact_flag.sql"
);

async function migrate() {
  const db = await getDb();
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Applying Voter Demo Contact migration...");
  await db.query(sql);
  console.log("Voter Demo Contact migration completed.");
}

migrate().then(
  () => process.exit(0),
  (error) => {
    console.error("Voter Demo Contact migration failed:", error);
    process.exit(1);
  }
);
