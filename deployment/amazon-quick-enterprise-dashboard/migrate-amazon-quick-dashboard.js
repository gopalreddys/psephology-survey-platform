import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(
  path.resolve(here, "../../sql/024_amazon_quick_research_reporting.sql"),
  "utf8"
);

console.log("Applying Amazon Quick research reporting migration...");
const db = await getDb();
await db.query(sql);
console.log("Amazon Quick research reporting migration completed.");
await db.end();
