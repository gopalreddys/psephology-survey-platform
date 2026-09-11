import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "SARVAM_OUTBOUND_WEBHOOK_V1";

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

await copy(
  "020_sarvam_outbound_webhook.sql",
  path.join(runtimeRoot, "sql/020_sarvam_outbound_webhook.sql")
);
await copy(
  "migrate-sarvam-outbound-webhook.js",
  path.join(runtimeRoot, "src/db/migrate-sarvam-outbound-webhook.js")
);
await copy(
  "sarvam-outbound-webhook.repository.js",
  path.join(runtimeRoot, "src/repositories/sarvam-outbound-webhook.repository.js")
);
await copy(
  "sarvam-outbound-webhook.routes.js",
  path.join(runtimeRoot, "src/routes/sarvam-outbound-webhook.routes.js")
);

const clientPath = path.join(runtimeRoot, "src/clients/sarvam.js");
let clientSource = await readFile(clientPath, "utf8");

if (!clientSource.includes(marker)) {
  const webhookCondition = /if\s*\(\s*webhookUrl\s*\)\s*\{\s*body\.webhook_config\s*=\s*\{\s*url:\s*webhookUrl,/m;

  if (!webhookCondition.test(clientSource)) {
    throw new Error(`Unable to find webhookUrl request block in ${clientPath}`);
  }

  clientSource = clientSource.replace(
    webhookCondition,
    `/* ${marker}: every outbound attempt must have a result receiver. */\n  const resolvedWebhookUrl =\n    webhookUrl ||\n    process.env.SARVAM_OUTBOUND_WEBHOOK_URL ||\n    null;\n\n  if (!resolvedWebhookUrl) {\n    throw new Error(\n      "SARVAM_OUTBOUND_WEBHOOK_URL is required before placing outbound calls"\n    );\n  }\n\n  if (!resolvedWebhookUrl.startsWith("https://")) {\n    throw new Error(\n      "SARVAM_OUTBOUND_WEBHOOK_URL must use public HTTPS"\n    );\n  }\n\n  if (resolvedWebhookUrl) {\n    body.webhook_config = {\n      url: resolvedWebhookUrl,`
  );

  await writeFile(clientPath, clientSource);
}

const serverPath = path.join(runtimeRoot, "src/server.js");
let serverSource = await readFile(serverPath, "utf8");

if (!serverSource.includes(marker)) {
  const importAnchor = /import\s+sarvamRuntimeRoutes[\s\S]*?from\s+["']\.\/routes\/sarvam-runtime\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api\/sarvam["']\s*,\s*sarvamRuntimeRoutes\s*\);/m;

  if (!importAnchor.test(serverSource) || !mountAnchor.test(serverSource)) {
    throw new Error(`Unable to find Sarvam runtime route anchors in ${serverPath}`);
  }

  serverSource = serverSource.replace(
    importAnchor,
    (value) => `${value}\n\n/* ${marker} */\nimport sarvamOutboundWebhookRoutes\n  from "./routes/sarvam-outbound-webhook.routes.js";`
  );
  serverSource = serverSource.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use("/api/sarvam", sarvamOutboundWebhookRoutes);`
  );

  await writeFile(serverPath, serverSource);
}

console.log(`Installed Sarvam outbound webhook support in ${runtimeRoot}`);
