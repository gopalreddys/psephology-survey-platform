import { getDb } from "./postgres.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const epicNumbers = [
  ...new Set(
    args
      .filter((value) => !value.startsWith("--"))
      .map((value) => value.trim())
      .filter(Boolean)
  )
];

if (epicNumbers.length === 0) {
  console.error(
    "Usage: node src/db/mark-demo-voters.js [--apply] <EPIC_NUMBER> [EPIC_NUMBER ...]"
  );
  process.exit(1);
}

async function markDemoVoters() {
  const pool = await getDb();
  const db = await pool.connect();
  let transactionStarted = false;

  try {
    const result = await db.query(
      `
        SELECT
          id,
          epic_number,
          full_name,
          contact_status,
          is_active,
          phone_number IS NOT NULL
            AND length(trim(phone_number)) > 0 AS has_phone,
          is_demo_contact
        FROM voter_master
        WHERE epic_number = ANY($1::text[])
        ORDER BY epic_number
      `,
      [epicNumbers]
    );

    const foundEpicNumbers = new Set(
      result.rows.map((row) => row.epic_number)
    );
    const missing = epicNumbers.filter(
      (epicNumber) => !foundEpicNumbers.has(epicNumber)
    );

    if (missing.length > 0) {
      throw new Error(`Voter EPIC IDs not found: ${missing.join(", ")}`);
    }

    const ineligible = result.rows.filter(
      (row) => !row.is_active || row.contact_status !== "ACTIVE" || !row.has_phone
    );

    if (ineligible.length > 0) {
      throw new Error(
        `Inactive or phone-ineligible voter EPIC IDs: ${ineligible
          .map((row) => row.epic_number)
          .join(", ")}`
      );
    }

    console.table(
      result.rows.map((row) => ({
        epic_number: row.epic_number,
        voter_name: row.full_name,
        current_demo_status: row.is_demo_contact
      }))
    );

    if (!apply) {
      console.log("Dry run passed. Re-run with --apply to approve these demo voters.");
      return;
    }

    await db.query("BEGIN");
    transactionStarted = true;

    const changed = result.rows.filter((row) => !row.is_demo_contact);

    for (const voter of changed) {
      await db.query(
        `
          UPDATE voter_master
          SET is_demo_contact = TRUE
          WHERE id = $1
        `,
        [voter.id]
      );

      await db.query(
        `
          INSERT INTO voter_demo_contact_audit (
            voter_id,
            previous_value,
            new_value,
            reason
          )
          VALUES ($1, FALSE, TRUE, $2)
        `,
        [voter.id, "Approved as a consented demonstration voter by deployment utility"]
      );
    }

    await db.query("COMMIT");
    transactionStarted = false;
    console.log(`${changed.length} demo voter approval(s) committed.`);
  } catch (error) {
    if (transactionStarted) {
      await db.query("ROLLBACK");
    }
    throw error;
  } finally {
    db.release();
  }
}

markDemoVoters().then(
  () => process.exit(0),
  (error) => {
    console.error("Demo voter approval failed:", error.message || error);
    process.exit(1);
  }
);
