import { chmod, chown, copyFile, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { routeFamilies, scopeCatalogueRouter } from "./catalogue-router-scope.mjs";

export async function installResearchCatalogAccess(runtimeRoot, { dryRun = false } = {}) {
  const root = path.resolve(runtimeRoot), plan = [];
  // Parse/validate both files before creating backups or changing either file.
  for (const name of Object.keys(routeFamilies)) {
    const target = path.join(root, "src/routes", name);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular catalogue route file: ${target}`);
    const original = await readFile(target, "utf8");
    plan.push({ target, original, mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid, ...scopeCatalogueRouter(original, name) });
  }
  const result = { dryRun, files: plan.map(({ target, changed, prefixes, routes }) => ({ target, changed, prefixes, routes })) };
  if (dryRun || !plan.some((item) => item.changed)) return result;
  const stamp = `${Date.now()}-${randomUUID()}`, pending = plan.filter((item) => item.changed), promoted = [];
  for (const item of plan) {
    if (await readFile(item.target, "utf8") !== item.original) throw new Error(`Catalogue route changed during preflight: ${item.target}`);
  }
  async function promote(item, contents, suffix) {
    const temporary = `${item.target}.tmp-catalog-access-${stamp}-${suffix}`;
    try {
      await writeFile(temporary, contents, { flag: "wx", mode: item.mode });
      const temporaryStat = await lstat(temporary);
      if (temporaryStat.uid !== item.uid || temporaryStat.gid !== item.gid) await chown(temporary, item.uid, item.gid);
      await chmod(temporary, item.mode);
      await rename(temporary, item.target);
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  for (const item of pending) {
    item.backup = `${item.target}.bak-research-catalog-access-${stamp}`;
    await copyFile(item.target, item.backup, constants.COPYFILE_EXCL);
    await chmod(item.backup, 0o600);
  }
  try {
    for (const item of pending) {
      if (await readFile(item.target, "utf8") !== item.original) throw new Error(`Catalogue route changed before promotion: ${item.target}`);
      await promote(item, item.source, "apply"); promoted.push(item);
    }
  } catch (error) {
    const failures = [];
    for (const item of promoted.reverse()) {
      try { await promote(item, item.original, "rollback"); } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Catalogue promotion failed; restore the retained backups before restarting the API");
    throw error;
  }
  return { ...result, backups: pending.map((item) => item.backup) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((item) => item.startsWith("--") && item !== "--dry-run") || args.filter((item) => !item.startsWith("--")).length > 1) {
    throw new Error("Usage: node install-research-catalog-access.js [API_ROOT] [--dry-run]");
  }
  const result = await installResearchCatalogAccess(args.find((item) => !item.startsWith("--")) || "/opt/sarvam-voice-analytics", { dryRun: args.includes("--dry-run") });
  console.log(JSON.stringify(result, null, 2));
  console.log(result.dryRun ? "Scoped catalogue guard preflight passed; no files changed." : "Admin-only catalogue guards are scoped to their owned URL families; unrelated API routes retain their own authorization.");
  console.log("No database, role, assignment, questionnaire, agent, call or service restart was changed.");
}
