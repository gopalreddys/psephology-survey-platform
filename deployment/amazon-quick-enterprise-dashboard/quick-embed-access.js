// Server-only access policy. Report filters are not authorization boundaries.
export class QuickEmbedAccessError extends Error {
  constructor(message, code = "QUICKSIGHT_ACCESS_NOT_CONFIGURED", status = 503) {
    super(message); this.code = code; this.status = status;
  }
}

export function validateEmbedDomains(domains) {
  if (!Array.isArray(domains) || !domains.length || domains.length > 3) {
    throw new QuickEmbedAccessError("Configure one to three explicit Quick embedding origins");
  }
  for (const domain of domains) {
    let url;
    try { url = new URL(domain); } catch { throw new QuickEmbedAccessError("Quick embedding origins are invalid"); }
    const localDevelopment = url.protocol === "http:" && url.hostname === "localhost";
    if ((!localDevelopment && url.protocol !== "https:") || url.username || url.password ||
        url.search || url.hash || url.hostname.includes("*") || domain !== url.origin) {
      throw new QuickEmbedAccessError("Quick embedding requires explicit HTTPS origins (HTTP localhost is development-only)");
    }
  }
  return domains;
}

export function resolveEmbedIdentity(config, actor) {
  if (!actor?.id || !["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    throw new QuickEmbedAccessError("Amazon Quick access is unavailable for this role", "QUICKSIGHT_ACCESS_DENIED", 403);
  }
  if (config.staticEmbedUrl) throw new QuickEmbedAccessError(
    "One-click links are retired. Configure API-generated registered-user sessions."
  );
  let readers;
  try { readers = JSON.parse(config.userArnMap || "{}"); }
  catch { throw new QuickEmbedAccessError("Quick Reader identity mapping is invalid"); }
  if (!readers || typeof readers !== "object" || Array.isArray(readers)) {
    throw new QuickEmbedAccessError("Quick Reader identity mapping is invalid");
  }
  const mappedArn = Object.hasOwn(readers, actor.id) ? readers[actor.id] : null;
  const userArn = mappedArn || (actor.role_code === "SUPER_ADMIN" ? config.userArn : null);
  const prefix = `arn:aws:quicksight:${config.region}:${config.accountId}:user/`;
  if (typeof userArn !== "string" || !userArn.startsWith(prefix) ||
      !/^[-\w]+\/[^\s/]+$/.test(userArn.slice(prefix.length))) {
    throw new QuickEmbedAccessError("A registered Quick Reader must be configured for this platform user");
  }
  const restricted = actor.role_code === "ADMIN";
  if (restricted && (userArn === config.userArn ||
      Object.values(readers).filter((value) => value === userArn).length !== 1)) {
    throw new QuickEmbedAccessError("Restricted Admin access requires a unique Quick Reader, not the shared portfolio Reader");
  }
  return { userArn, restricted, accessScope: restricted ? "USER_RLS" : "SUPER_ADMIN_PORTFOLIO" };
}

export async function verifyRestrictedEmbed(api, config, identity) {
  if (!identity.restricted) return null;
  const [namespace, userName] = identity.userArn.split(":user/")[1].split("/");
  const user = await api.describeUser(namespace, userName);
  if (user?.Arn !== identity.userArn || user.Active !== true ||
      !["READER", "READER_PRO"].includes(user.Role)) {
    throw new QuickEmbedAccessError("Restricted embedding requires an active Reader (Authors bypass row-level security)");
  }
  const dashboard = await api.describeDashboard();
  const arns = dashboard?.Version?.DataSetArns || [];
  const approved = new Set(config.rlsDataSetArns || []);
  let rulesMap;
  try { rulesMap = JSON.parse(config.rlsRulesMap || "{}"); }
  catch { throw new QuickEmbedAccessError("Quick RLS rules mapping is invalid"); }
  if (!rulesMap || typeof rulesMap !== "object" || Array.isArray(rulesMap)) {
    throw new QuickEmbedAccessError("Quick RLS rules mapping is invalid");
  }
  if (!arns.length || arns.some((arn) => !approved.has(arn))) {
    throw new QuickEmbedAccessError("Every dashboard dataset must be approved for per-user row-level security");
  }
  const groups = await api.listUserGroups(namespace, userName);
  if (!Array.isArray(groups)) throw new QuickEmbedAccessError("Quick Reader group permissions could not be verified");
  const principals = new Set([identity.userArn, ...groups.map((group) => group.Arn)]);
  const ownerActions = new Set(["quicksight:UpdateDataSet", "quicksight:DeleteDataSet", "quicksight:UpdateDataSetPermissions"]);
  for (const arn of arns) {
    const permissions = await api.describeDataSetPermissions(arn);
    if (!Array.isArray(permissions) || permissions.some((permission) =>
      principals.has(permission.Principal) && permission.Actions?.some((action) => ownerActions.has(action)))) {
      throw new QuickEmbedAccessError("Restricted embedding requires a Reader without dataset-owner permissions, directly or through groups");
    }
    const dataset = await api.describeDataSet(arn);
    const rls = dataset?.RowLevelPermissionDataSet;
    const expectedRulesArn = Object.hasOwn(rulesMap, arn) ? rulesMap[arn] : null;
    const rulesPrefix = `arn:aws:quicksight:${config.region}:${config.accountId}:dataset/`;
    if (dataset?.Arn !== arn || !rls?.Arn || rls.Status !== "ENABLED" ||
        rls.PermissionPolicy !== "GRANT_ACCESS" || rls.FormatVersion !== "VERSION_2" ||
        rls.Namespace || typeof expectedRulesArn !== "string" ||
        !expectedRulesArn.startsWith(rulesPrefix) || rls.Arn !== expectedRulesArn) {
      throw new QuickEmbedAccessError("Restricted embedding is blocked: approved enabled GRANT_ACCESS UserARN rules are required on every dataset");
    }
    const rules = await api.describeDataSet(expectedRulesArn);
    const columns = rules?.OutputColumns || [];
    if (rules?.Arn !== expectedRulesArn || rules.UseAs !== "RLS_RULES" ||
        !columns.some((column) => column.Name === "UserARN" && column.Type === "STRING") ||
        !columns.some((column) => column.Name === "campaign_id" && column.Type === "STRING")) {
      throw new QuickEmbedAccessError("Restricted embedding requires a reviewed UserARN/campaign_id rules dataset");
    }
  }
  return dashboard;
}

export async function quickDataFreshness(api, dashboard, now = Date.now()) {
  try {
    const current = dashboard || await api.describeDashboard();
    const arns = current?.Version?.DataSetArns || [];
    if (!arns.length) return { status: "UNKNOWN", oldestCompletedIngestionAt: null, datasetCount: 0 };
    const timestamps = [];
    let updating = false;
    let refreshFailed = false;
    for (const arn of arns) {
      const dataset = await api.describeDataSet(arn);
      if (dataset.ImportMode === "DIRECT_QUERY") continue;
      const ingestions = [...await api.listIngestions(arn)].sort((left, right) =>
        new Date(right.CreatedTime).getTime() - new Date(left.CreatedTime).getTime());
      if (ingestions.some((item) => !Number.isFinite(new Date(item.CreatedTime).getTime()))) {
        return { status: "UNKNOWN", oldestCompletedIngestionAt: null, datasetCount: arns.length };
      }
      const newest = ingestions[0];
      updating ||= ["INITIALIZED", "QUEUED", "RUNNING"].includes(newest?.IngestionStatus);
      refreshFailed ||= ["FAILED", "CANCELLED"].includes(newest?.IngestionStatus);
      const completed = ingestions.find((item) => item.IngestionStatus === "COMPLETED");
      const timestamp = new Date(completed?.CreatedTime || "").getTime();
      if (!Number.isFinite(timestamp)) return { status: "UNKNOWN", oldestCompletedIngestionAt: null, datasetCount: arns.length };
      timestamps.push(timestamp);
    }
    const oldest = timestamps.length ? Math.min(...timestamps) : null;
    return {
      status: refreshFailed ? "REFRESH_FAILED" : updating ? "UPDATING" : oldest === null ? "DIRECT_QUERY" :
        now - oldest > 24 * 60 * 60_000 ? "STALE" : "CURRENT",
      oldestCompletedIngestionAt: oldest === null ? null : new Date(oldest).toISOString(),
      timestampBasis: "COMPLETED_INGESTION_CREATED_TIME",
      datasetCount: arns.length
    };
  } catch {
    // Missing metadata permission is unknown freshness, never zero rows or a
    // fabricated current timestamp. Do not return raw AWS error payloads.
    return { status: "UNKNOWN", oldestCompletedIngestionAt: null, datasetCount: null };
  }
}
