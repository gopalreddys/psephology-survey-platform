import assert from "node:assert/strict";
import { resolveEmbedIdentity, verifyRestrictedEmbed, quickDataFreshness, validateEmbedDomains } from "./quick-embed-access.js";

const prefix = "arn:aws:quicksight:ap-south-1:123456789012:";
const shared = `${prefix}user/default/demo-portfolio`;
const reader = `${prefix}user/default/admin-one`;
const datasetArn = `${prefix}dataset/report`;
const rulesArn = `${prefix}dataset/rls`;
const admin = { id: "a1", role_code: "ADMIN" };
const config = { region: "ap-south-1", accountId: "123456789012", userArn: shared,
  userArnMap: JSON.stringify({ a1: reader }), rlsDataSetArns: [datasetArn],
  rlsRulesMap: JSON.stringify({ [datasetArn]: rulesArn }) };
assert.deepEqual(validateEmbedDomains(["https://demo.example.com", "http://localhost:3000"]), ["https://demo.example.com", "http://localhost:3000"]);
for (const domains of [[], ["https://demo.example.com/path"], ["https://*.example.com"],
  ["http://example.com"], ["https://demo.example.com/"], ["https://user@demo.example.com"],
  Array(4).fill("https://demo.example.com")]) assert.throws(() => validateEmbedDomains(domains));
const identity = resolveEmbedIdentity(config, admin);
assert.equal(identity.accessScope, "USER_RLS");
assert.equal(resolveEmbedIdentity(config, { ...admin, role_code: "SUPER_ADMIN" }).accessScope, "SUPER_ADMIN_PORTFOLIO");
for (const bad of ["{}", "[]", "null", "{broken", JSON.stringify({ a1: shared }),
  JSON.stringify({ a1: reader, a2: reader }), JSON.stringify({ a1: `${prefix}user/another/a/b` }),
  JSON.stringify({ a1: reader.replace("123456789012", "999999999999") })]) {
  assert.throws(() => resolveEmbedIdentity({ ...config, userArnMap: bad }, admin));
}
assert.throws(() => resolveEmbedIdentity({ ...config, staticEmbedUrl: "https://example.com/share" }, admin));
for (const role of ["CAMPAIGN_MANAGER", "CAMPAIGNER", "UNKNOWN"]) {
  assert.throws(() => resolveEmbedIdentity(config, { ...admin, role_code: role }), { status: 403 });
}
const dataset = { Arn: datasetArn, ImportMode: "SPICE", RowLevelPermissionDataSet: {
  Arn: rulesArn, Status: "ENABLED", PermissionPolicy: "GRANT_ACCESS", FormatVersion: "VERSION_2"
} };
const rules = { Arn: rulesArn, UseAs: "RLS_RULES", OutputColumns: [
  { Name: "UserARN", Type: "STRING" }, { Name: "campaign_id", Type: "STRING" }
] };
const dashboard = { Version: { DataSetArns: [datasetArn] } };
const api = {
  describeUser: async () => ({ Arn: reader, Active: true, Role: "READER" }),
  describeDashboard: async () => dashboard,
  describeDataSet: async (arn) => arn === rulesArn ? rules : dataset,
  listUserGroups: async () => [],
  describeDataSetPermissions: async () => [],
  listIngestions: async () => [{ IngestionStatus: "COMPLETED", CreatedTime: "2026-10-13T00:00:00Z" }]
};
assert.equal(await verifyRestrictedEmbed(api, config, identity), dashboard);
for (const Action of ["quicksight:UpdateDataSet", "quicksight:DeleteDataSet", "quicksight:UpdateDataSetPermissions"]) {
  await assert.rejects(verifyRestrictedEmbed({ ...api, describeDataSetPermissions: async () => [{ Principal: reader, Actions: [Action] }] }, config, identity));
}
const groupArn = `${prefix}group/default/owners`;
await assert.rejects(verifyRestrictedEmbed({ ...api, listUserGroups: async () => [{ Arn: groupArn }],
  describeDataSetPermissions: async () => [{ Principal: groupArn, Actions: ["quicksight:UpdateDataSet"] }] }, config, identity));
await assert.rejects(verifyRestrictedEmbed({ ...api, describeDataSetPermissions: async () => undefined }, config, identity));
for (const Role of ["AUTHOR", "ADMIN", "AUTHOR_PRO", "ADMIN_PRO"]) {
  await assert.rejects(verifyRestrictedEmbed({ ...api, describeUser: async () => ({ Arn: reader, Active: true, Role }) }, config, identity));
}
await assert.rejects(verifyRestrictedEmbed({ ...api, describeUser: async () => ({ Arn: reader, Active: false, Role: "READER" }) }, config, identity));
await assert.rejects(verifyRestrictedEmbed(api, { ...config, rlsDataSetArns: [] }, identity));
for (const rlsRulesMap of ["{}", "null", "[]", "{broken", JSON.stringify({ [datasetArn]: `${prefix}dataset/unapproved` })]) {
  await assert.rejects(verifyRestrictedEmbed(api, { ...config, rlsRulesMap }, identity));
}
for (const RowLevelPermissionDataSet of [null, {}, { ...dataset.RowLevelPermissionDataSet, Status: "DISABLED" },
  { ...dataset.RowLevelPermissionDataSet, PermissionPolicy: "DENY_ACCESS" },
  { ...dataset.RowLevelPermissionDataSet, FormatVersion: "VERSION_1" },
  { ...dataset.RowLevelPermissionDataSet, Namespace: "default" }]) {
  await assert.rejects(verifyRestrictedEmbed({ ...api, describeDataSet: async () => ({ ...dataset, RowLevelPermissionDataSet }) }, config, identity));
}
for (const badRules of [{ ...rules, UseAs: "REGULAR" }, { ...rules, OutputColumns: [] },
  { ...rules, OutputColumns: [{ Name: "UserName", Type: "STRING" }, { Name: "campaign_id", Type: "STRING" }] }]) {
  await assert.rejects(verifyRestrictedEmbed({ ...api, describeDataSet: async (arn) => arn === rulesArn ? badRules : dataset }, config, identity));
}
await assert.rejects(verifyRestrictedEmbed({ ...api, describeDataSet: async () => { throw new Error("AccessDenied"); } }, config, identity));
assert.equal((await quickDataFreshness(api, dashboard, Date.parse("2026-10-13T10:00:00Z"))).status, "CURRENT");
assert.equal((await quickDataFreshness(api, dashboard, Date.parse("2026-10-15T10:00:00Z"))).status, "STALE");
assert.equal((await quickDataFreshness({ ...api, listIngestions: async () => [] }, dashboard)).status, "UNKNOWN");
assert.equal((await quickDataFreshness({ ...api, describeDataSet: async () => { throw new Error("private details"); } }, dashboard)).status, "UNKNOWN");
assert.equal((await quickDataFreshness({ ...api, describeDataSet: async () => ({ ImportMode: "DIRECT_QUERY" }) }, dashboard)).status, "DIRECT_QUERY");
const now = Date.parse("2026-10-13T10:00:00Z");
assert.equal((await quickDataFreshness({ ...api, listIngestions: async () => [{ IngestionStatus: "RUNNING", CreatedTime: "2026-10-13T09:00:00Z" }, ...(await api.listIngestions())] }, dashboard, now)).status, "UPDATING");
for (const IngestionStatus of ["FAILED", "CANCELLED"]) {
  const failed = await quickDataFreshness({ ...api, listIngestions: async () => [
    ...(await api.listIngestions()), { IngestionStatus, CreatedTime: "2026-10-13T09:00:00Z" }
  ] }, dashboard, now);
  assert.equal(failed.status, "REFRESH_FAILED", "newest refresh state is sorted, not inferred from API order");
  assert.equal(failed.oldestCompletedIngestionAt, "2026-10-13T00:00:00.000Z");
}
assert.equal((await quickDataFreshness({ ...api, listIngestions: async () => [{ IngestionStatus: "RUNNING" }] }, dashboard, now)).status, "UNKNOWN");
console.log("Quick embed role/identity/RLS fail-closed and honest data freshness tests passed.");
