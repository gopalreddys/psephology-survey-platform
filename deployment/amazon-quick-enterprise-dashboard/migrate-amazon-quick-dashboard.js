import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";
import { buildNormalizationSqlFunction } from "../repositories/output-normalization.repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
console.log("Applying Amazon Quick research reporting migration...");
const db = await getDb();
for (const migration of [
  "024_amazon_quick_research_reporting.sql",
  "025_amazon_quick_geographic_heatmap.sql",
  "026_telangana_administrative_boundaries.sql",
  "027_psephology_decision_reporting.sql",
  "028_research_design_comparability.sql",
  "029_shared_comparison_gate.sql",
  "030_normalized_output_reporting.sql",
  "031_audited_research_methodology.sql",
  "032_sentiment_construct_reporting.sql"
]) {
  const sql = await readFile(path.resolve(here, "../../sql", migration), "utf8");
  if (migration.startsWith("030_")) await db.query(buildNormalizationSqlFunction());
  await db.query(sql);
  console.log(`Applied ${migration}`);
}
console.log("Amazon Quick research reporting migration completed.");
await db.end();
