import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const here = path.dirname(fileURLToPath(import.meta.url));
console.log("Applying Amazon Quick research reporting migration...");
const db = await getDb();
for (const migration of [
  "024_amazon_quick_research_reporting.sql",
  "025_amazon_quick_geographic_heatmap.sql"
]) {
  const sql = await readFile(path.resolve(here, "../../sql", migration), "utf8");
  await db.query(sql);
  console.log(`Applied ${migration}`);
}
console.log("Amazon Quick research reporting migration completed.");
await db.end();
