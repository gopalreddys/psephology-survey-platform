import {
  listStaleCallbackCandidates,
  recoverStaleCallbacks
} from "../repositories/stale-callback-recovery.repository.js";

const apply = process.argv.includes("--apply");
const thresholdArgument = process.argv.find(function (value) {
  return value.startsWith("--minutes=");
});
const thresholdMinutes = thresholdArgument
  ? Number(thresholdArgument.split("=")[1])
  : undefined;

try {
  const candidates = await listStaleCallbackCandidates({ thresholdMinutes });
  console.log(`Stale callback candidates (${candidates.thresholdMinutes} minute threshold):`);
  console.table(candidates.items);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to recover these executions.");
    process.exit(0);
  }

  console.log(await recoverStaleCallbacks({ thresholdMinutes }));
  process.exit(0);
} catch (error) {
  console.error("Stale callback recovery failed:", error);
  process.exitCode = 1;
}
