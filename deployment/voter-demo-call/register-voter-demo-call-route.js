import fs from "node:fs";
import path from "node:path";

const serverPath = path.resolve(process.argv[2] || "src/server.js");
let source = fs.readFileSync(serverPath, "utf8");

if (!source.includes("voterDemoCallsRoutes")) {
  const votersImport = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;

  if (!votersImport.test(source)) {
    throw new Error("Could not find the voters routes import in src/server.js");
  }

  source = source.replace(
    votersImport,
    (match) => `${match}\nimport voterDemoCallsRoutes from "./routes/voter-demo-calls.routes.js";`
  );
}

if (!/app\.use\(\s*["']\/api["']\s*,\s*voterDemoCallsRoutes\s*\);/m.test(source)) {
  const votersMount = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;

  if (!votersMount.test(source)) {
    throw new Error("Could not find the voters route mount in src/server.js");
  }

  source = source.replace(
    votersMount,
    (match) => `${match}\napp.use("/api", voterDemoCallsRoutes);`
  );
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${serverPath}.bak-voter-demo-calls-${timestamp}`;
fs.copyFileSync(serverPath, backupPath);
fs.writeFileSync(serverPath, source);

console.log(`Registered voter demo call routes in ${serverPath}`);
console.log(`Backup written to ${backupPath}`);
