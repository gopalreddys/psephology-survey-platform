import fs from "node:fs";
import path from "node:path";

const serverPath = path.resolve(process.argv[2] || "src/server.js");
let source = fs.readFileSync(serverPath, "utf8");

if (!source.includes("voiceAgentsRoutes")) {
  const campaignsImport = /import\s+campaignsRoutes\s+from\s+["']\.\/routes\/campaigns\.routes\.js["'];/m;
  if (!campaignsImport.test(source)) throw new Error("Could not find the campaigns routes import in src/server.js");
  source = source.replace(campaignsImport, (match) => `${match}\nimport voiceAgentsRoutes from "./routes/voice-agents.routes.js";`);
}

if (!/app\.use\(\s*["']\/api["']\s*,\s*voiceAgentsRoutes\s*\);/m.test(source)) {
  const campaignsMount = /app\.use\(\s*["']\/api["']\s*,\s*campaignsRoutes\s*\);/m;
  if (!campaignsMount.test(source)) throw new Error("Could not find the campaigns route mount in src/server.js");
  source = source.replace(campaignsMount, (match) => `${match}\napp.use("/api", voiceAgentsRoutes);`);
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${serverPath}.bak-voice-agents-${timestamp}`;
fs.copyFileSync(serverPath, backupPath);
fs.writeFileSync(serverPath, source);
console.log(`Registered voice-agent routes in ${serverPath}`);
console.log(`Backup written to ${backupPath}`);
