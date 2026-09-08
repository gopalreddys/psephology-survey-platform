import { getDb } from "./postgres.js";

const defaultEmails = [
  "himavanth10@gmail.com",
  "nemalianilkumar@gmail.com",
  "satishdarla001@gmail.com"
];

const emails = (process.argv.slice(2).length ? process.argv.slice(2) : defaultEmails)
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

async function assignTestCampaigners() {
  const db = await getDb();
  const client = typeof db.connect === "function" ? await db.connect() : db;

  try {
    await client.query("BEGIN");

    const roleResult = await client.query(`
      SELECT id
      FROM roles
      WHERE code = 'CAMPAIGNER'
        AND is_active = TRUE
      LIMIT 1
    `);

    if (!roleResult.rowCount) {
      throw new Error("Active CAMPAIGNER role was not found");
    }

    const usersResult = await client.query(`
      SELECT u.id, u.email, u.full_name, u.status, r.code AS role_code
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = ANY($1::text[])
      ORDER BY lower(u.email)
    `, [emails]);

    const foundEmails = new Set(usersResult.rows.map((user) => user.email.toLowerCase()));
    const missingEmails = emails.filter((email) => !foundEmails.has(email));
    if (missingEmails.length) {
      throw new Error(`User account(s) not found: ${missingEmails.join(", ")}`);
    }

    const inactiveUsers = usersResult.rows.filter((user) => user.status !== "ACTIVE");
    if (inactiveUsers.length) {
      throw new Error(`Inactive user account(s): ${inactiveUsers.map((user) => user.email).join(", ")}`);
    }

    const updated = await client.query(`
      UPDATE users
      SET role_id = $1,
          updated_at = NOW()
      WHERE lower(email) = ANY($2::text[])
      RETURNING id, email, full_name, status
    `, [roleResult.rows[0].id, emails]);

    await client.query("COMMIT");

    console.table(updated.rows.map((user) => ({
      email: user.email,
      name: user.full_name,
      status: user.status,
      role: "CAMPAIGNER"
    })));
    console.log("Campaigner role assignment completed. No passwords or geography allocations were changed.");
    console.log("Assign each user to a campaign geography before they create Runs.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (typeof db.connect === "function") client.release();
  }
}

assignTestCampaigners().then(
  () => process.exit(0),
  (error) => {
    console.error("Campaigner role assignment failed:", error.message || error);
    process.exit(1);
  }
);
