import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, chmod } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.resolve(process.argv[2] || "/tmp/psephology-demo-baseline.json");
const archiveRoot = path.resolve(process.argv[3] || "/opt/sarvam-voice-analytics/var/demo-release-baselines");
const sourceStat = await lstat(sourcePath);
if (!sourceStat.isFile()) throw new Error(`Baseline source must be a regular file: ${sourcePath}`);

const content = await readFile(sourcePath);
const report = JSON.parse(content.toString("utf8"));
if (report.reportVersion !== 1 || !report.campaign?.id || !report.generatedAt ||
    !["PASS", "PASS_WITH_WARNINGS"].includes(report.status)) {
  throw new Error("Source is not a successful demo release baseline report");
}

const generated = new Date(report.generatedAt);
if (Number.isNaN(generated.getTime())) throw new Error("Baseline report has an invalid generatedAt timestamp");
const campaignId = String(report.campaign.id);
if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new Error("Baseline report has an invalid campaign ID");
const fileName = `${campaignId}-${generated.toISOString().replaceAll(":", "-")}.json`;
await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
await chmod(archiveRoot, 0o700);
const destinationPath = path.join(archiveRoot, fileName);
await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
await chmod(destinationPath, 0o600);
const sourceHash = createHash("sha256").update(content).digest("hex");
const destinationHash = createHash("sha256").update(await readFile(destinationPath)).digest("hex");
if (sourceHash !== destinationHash) throw new Error("Archived report failed SHA-256 verification");

console.log(`Archived baseline: ${destinationPath}`);
console.log(`SHA-256: ${destinationHash}`);
console.log("This is a local EC2 archive, not an off-host backup or an RDS snapshot.");
