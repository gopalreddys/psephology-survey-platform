function field(record, snakeCase, camelCase) {
  return record?.[snakeCase] ?? record?.[camelCase] ?? null;
}

export function campaignReviewVisibilitySql(actor, alias = "campaign", parameterNumber = 1) {
  if (actor.role_code === "SUPER_ADMIN") {
    return { sql: "TRUE", values: [] };
  }

  if (actor.role_code === "ADMIN") {
    return {
      sql: `(${alias}.campaign_manager_user_id IS NOT NULL
        OR ${alias}.created_by_user_id = $${parameterNumber})`,
      values: [actor.id]
    };
  }

  if (actor.role_code === "CAMPAIGN_MANAGER") {
    return {
      sql: `${alias}.campaign_manager_user_id = $${parameterNumber}`,
      values: [actor.id]
    };
  }

  return { sql: "FALSE", values: [] };
}

export function canReviewCampaign(record, actor) {
  if (actor.role_code === "SUPER_ADMIN") return true;

  const managerId = field(
    record,
    "campaign_manager_user_id",
    "campaignManagerId"
  );
  const creatorId = field(record, "created_by_user_id", "createdByUserId");

  if (actor.role_code === "ADMIN") {
    return Boolean(managerId) || creatorId === actor.id;
  }

  return actor.role_code === "CAMPAIGN_MANAGER" && managerId === actor.id;
}
