import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/postgres.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, "../../sql/023_voter_electorate_model.sql");
const sql = fs.readFileSync(migrationPath, "utf8");
const db = await getDb();

console.log("Applying voter identity and electorate registration migration...");
await db.query(sql);
console.log("Voter identity and electorate registration migration completed.");
await db.end();
