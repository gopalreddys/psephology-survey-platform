import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(currentDirectory, "../../sql/019_sarvam_voice_agent_catalog.sql");

async function migrate() {
  const db = await getDb();
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Applying Sarvam Voice Agent Catalog migration...");
  await db.query(sql);
  console.log("Sarvam Voice Agent Catalog migration completed.");
}

migrate().then(
  () => process.exit(0),
  (error) => {
    console.error("Sarvam Voice Agent Catalog migration failed:", error);
    process.exit(1);
  }
);
