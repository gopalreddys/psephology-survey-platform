import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const selectionPath = path.join(
  root,
  "src/repositories/campaign-voter-selection.repository.js"
);
const launchPath = path.join(root, "src/services/run-launch.service.js");
const executionPath = path.join(root, "src/services/sarvam-execution.service.js");

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required runtime file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function backupAndWrite(filePath, source, timestamp) {
  const backupPath = `${filePath}.bak-demo-only-${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, source);
  console.log(`Updated ${filePath}`);
  console.log(`Backup written to ${backupPath}`);
}

function demoPredicate(alias, indentation) {
  return `${indentation}AND ${alias}.is_demo_contact = TRUE\n${indentation}AND (${alias}.qualification IS NULL OR length(trim(${alias}.qualification)) = 0)`;
}

function patchSelection(source) {
  const activeNeedle = "        AND voter.contact_status = 'ACTIVE'";
  const activeReplacement = `${activeNeedle}\n${demoPredicate("voter", "        ")}`;
  const activeOccurrences = source.split(activeNeedle).length - 1;

  if (activeOccurrences < 1 && !source.includes("voter.is_demo_contact = TRUE")) {
    throw new Error(
      `Could not find a voter selection anchor in ${selectionPath}`
    );
  }

  if (!source.includes("voter.is_demo_contact = TRUE")) {
    source = source.replaceAll(activeNeedle, activeReplacement);
  }

  const demoOccurrences = source.split("voter.is_demo_contact = TRUE").length - 1;
  if (demoOccurrences < Math.max(activeOccurrences, 1)) {
    throw new Error("Demo-only voter selection was not applied to every available Run selection query");
  }

  return source;
}

function patchLaunch(source) {
  const contactSelect = `        FROM campaign_run_contacts rc\n\n        WHERE`;
  const joinedContactSelect = `        FROM campaign_run_contacts rc\n\n        JOIN voter_master voter\n          ON voter.id = rc.voter_id\n\n        WHERE`;

  if (!source.includes("RUN_LAUNCH_DEMO_ONLY")) {
    const occurrences = source.split(contactSelect).length - 1;
    if (occurrences < 1) {
      throw new Error(
        `Could not find a launch contact query in ${launchPath}`
      );
    }

    source = source.replaceAll(contactSelect, joinedContactSelect);
    source = source.replaceAll(
      "          rc.run_id = $1",
      `          rc.run_id = $1\n\n          /* RUN_LAUNCH_DEMO_ONLY */\n          AND voter.is_demo_contact = TRUE\n\n          AND (\n            voter.qualification IS NULL\n            OR length(trim(voter.qualification)) = 0\n          )`
    );
  }

  const guards = source.split("RUN_LAUNCH_DEMO_ONLY").length - 1;
  if (guards < 1) {
    throw new Error("No demo-only launch guard was applied");
  }

  return source;
}

function patchExecution(source) {
  const anchor = `  const contextResult =\n    await db.query(`;
  const guard = `  /* RUN_EXECUTION_DEMO_ONLY: final safety boundary before provider submission. */\n  const demoEligibility =\n    await db.query(\n      \`\n      SELECT id\n      FROM voter_master\n      WHERE id = $1\n        AND is_active = TRUE\n        AND contact_status = 'ACTIVE'\n        AND is_demo_contact = TRUE\n        AND (qualification IS NULL OR length(trim(qualification)) = 0)\n      LIMIT 1\n      \`,\n      [prepared.voterId]\n    );\n\n  if (!demoEligibility.rowCount) {\n    const error = new Error(\n      "Run calls are restricted to explicitly approved demo voters"\n    );\n    error.statusCode = 403;\n    error.code = "VOTER_NOT_APPROVED_FOR_DEMO";\n    throw error;\n  }\n\n\n`;

  if (!source.includes("RUN_EXECUTION_DEMO_ONLY")) {
    if (!source.includes(anchor)) {
      throw new Error(`Could not find execution context anchor in ${executionPath}`);
    }
    source = source.replace(anchor, `${guard}${anchor}`);
  }

  if (!source.includes("VOTER_NOT_APPROVED_FOR_DEMO")) {
    throw new Error("Final demo-only execution guard was not applied");
  }

  return source;
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const files = [
  [selectionPath, patchSelection],
  [launchPath, patchLaunch],
  [executionPath, patchExecution]
];

for (const [filePath, patcher] of files) {
  const original = readRequired(filePath);
  const updated = patcher(original);
  if (updated === original) {
    console.log(`Already protected: ${filePath}`);
  } else {
    backupAndWrite(filePath, updated, timestamp);
  }
}

console.log("Demo-only Run call enforcement is active in all three backend layers.");
