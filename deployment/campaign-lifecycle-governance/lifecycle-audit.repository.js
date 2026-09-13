export async function recordLifecycleEvent(db, event) {
  if (!event?.entityType || !event?.entityId || !event?.nextStatus) return null;

  const result = await db.query(
    `
      INSERT INTO operational_lifecycle_events (
        entity_type,
        entity_id,
        parent_entity_id,
        previous_status,
        next_status,
        trigger_source,
        actor_user_id,
        details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING *
    `,
    [
      event.entityType,
      event.entityId,
      event.parentEntityId || null,
      event.previousStatus || null,
      event.nextStatus,
      event.source || "SYSTEM",
      event.actorId || null,
      JSON.stringify(event.details || {})
    ]
  );

  return result.rows[0];
}
