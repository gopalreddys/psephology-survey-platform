import { getDb } from "../db/postgres.js";

const TERMINAL_STATUSES = [
  "SUCCESS_PULSE",
  "SUCCESS_COMPLETE",
  "SUCCESS_SUBSTANTIAL",
  "REFUSED_TERMINAL",
  "DO_NOT_CALL",
  "INVALID_NUMBER"
];

export async function listPendingRunContacts(runId, requestedLimit = 50) {
  const db = await getDb();
  const limit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 50);

  const cycleResult = await db.query(
    `
      SELECT
        cycle.id,
        cycle.cycle_number,
        cycle.cycle_type,
        run.max_attempts_per_voter
      FROM campaign_run_cycles cycle
      JOIN campaign_runs run
        ON run.id = cycle.run_id
      WHERE cycle.run_id = $1
        AND cycle.status IN ('READY', 'RUNNING')
      ORDER BY cycle.cycle_number DESC
      LIMIT 1
    `,
    [runId]
  );

  const cycle = cycleResult.rows[0];

  if (!cycle) {
    return {
      cycle: null,
      items: [],
      total: 0,
      limit
    };
  }

  const result = await db.query(
    `
      SELECT
        contact.id AS run_contact_id,
        voter.id AS voter_id,
        voter.full_name,
        RIGHT(
          regexp_replace(COALESCE(voter.phone_number, ''), '[^0-9]', '', 'g'),
          4
        ) AS phone_ending,
        voter.preferred_language,
        geography.name AS geography_name,
        contact.attempt_count,
        COUNT(*) OVER()::int AS total_pending
      FROM campaign_run_contacts contact
      JOIN voter_master voter
        ON voter.id = contact.voter_id
      LEFT JOIN geo_units geography
        ON geography.id = voter.geo_unit_id
      WHERE contact.run_id = $1
        AND contact.selection_status = 'SELECTED'
        AND voter.is_active = TRUE
        AND voter.contact_status = 'ACTIVE'
        AND voter.is_demo_contact = TRUE
        AND (voter.qualification IS NULL OR length(trim(voter.qualification)) = 0)
        AND (
          (
            $2 = 'INITIAL'
            AND contact.attempt_count = 0
            AND contact.attempt_status = 'PENDING'
            AND contact.final_status = 'PENDING'
          )
          OR
          (
            $2 = 'RETRY'
            AND contact.attempt_count > 0
            AND contact.attempt_count < $3
            AND contact.retry_eligible = TRUE
            AND contact.retry_exhausted = FALSE
            AND COALESCE(contact.final_status, 'PENDING') <> ALL($4::text[])
          )
        )
      ORDER BY
        CASE WHEN $2 = 'INITIAL' THEN contact.selected_at END,
        CASE WHEN $2 = 'RETRY' THEN contact.last_attempt_at END NULLS FIRST,
        contact.id
      LIMIT $5
    `,
    [
      runId,
      cycle.cycle_type,
      Number(cycle.max_attempts_per_voter),
      TERMINAL_STATUSES,
      limit
    ]
  );

  return {
    cycle: {
      id: cycle.id,
      number: Number(cycle.cycle_number),
      type: cycle.cycle_type
    },
    items: result.rows.map((row) => ({
      runContactId: row.run_contact_id,
      voterId: row.voter_id,
      fullName: row.full_name,
      phoneEnding: row.phone_ending,
      preferredLanguage: row.preferred_language,
      geographyName: row.geography_name,
      attemptCount: Number(row.attempt_count || 0)
    })),
    total: Number(result.rows[0]?.total_pending || 0),
    limit
  };
}
