import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "./postgres.js";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../sql/020_sarvam_outbound_webhook.sql"
);

const sql = await readFile(migrationPath, "utf8");
const db = await getDb();

console.log("Applying Sarvam Outbound Webhook migration...");
await db.query(sql);
console.log("Sarvam Outbound Webhook migration completed.");
process.exit(0);
