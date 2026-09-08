import fs from "node:fs";
import path from "node:path";

const serverPath = path.resolve(
  process.argv[2] || "src/server.js"
);
let source = fs.readFileSync(serverPath, "utf8");

if (!source.includes("userProfilesRoutes")) {
  const usersImport = /import\s+usersRoutes\s+from\s+["']\.\/routes\/users\.routes\.js["'];/m;
  if (!usersImport.test(source)) {
    throw new Error("Could not find the users routes import in src/server.js");
  }
  source = source.replace(
    usersImport,
    (match) => `${match}\nimport userProfilesRoutes from "./routes/user-profiles.routes.js";`
  );
}

if (!/app\.use\(\s*["']\/api["']\s*,\s*userProfilesRoutes\s*\);/m.test(source)) {
  const usersMount = /app\.use\(\s*["']\/api["']\s*,\s*usersRoutes\s*\);/m;
  if (!usersMount.test(source)) {
    throw new Error("Could not find the users route mount in src/server.js");
  }
  source = source.replace(
    usersMount,
    (match) => `${match}\napp.use("/api", userProfilesRoutes);`
  );
}

const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${serverPath}.bak-user-profiles-${timestamp}`;
fs.copyFileSync(serverPath, backupPath);
fs.writeFileSync(serverPath, source);

console.log(`Registered user profile routes in ${serverPath}`);
console.log(`Backup written to ${backupPath}`);
