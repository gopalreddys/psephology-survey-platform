import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function migrateCallQualityReview(db, sql) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { getDb } = await import('./postgres.js');
  const sql = await readFile(new URL('../../sql/033_call_quality_review.sql', import.meta.url), 'utf8');
  const db = await getDb();
  try {
    await migrateCallQualityReview(db, sql);
    console.log('Call-quality audit migration completed. No evidence, reviews or approvals were backfilled.');
  } finally {
    await db.end?.();
  }
}
