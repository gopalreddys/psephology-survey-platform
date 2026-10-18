import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] || '/opt/sarvam-voice-analytics');
const { getDb } = await import(pathToFileURL(resolve(root,'src/db/postgres.js')));
const db = await getDb();
try {
  const sql = await readFile(resolve(root,'sql/035_outbound_contact_suppression.sql'),'utf8');
  await db.query(sql);
  console.log('Additive outbound suppression migration completed; no historical records backfilled.');
} finally { await db.end(); }
