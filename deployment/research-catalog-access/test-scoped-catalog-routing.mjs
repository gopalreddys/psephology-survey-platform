import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import path from "node:path";
import { scopeCatalogueRouter } from "./catalogue-router-scope.mjs";

// Default: isolated synchronous router harness, no sockets/dependencies/backend.
// EXPRESS_MODULE_PATH=/opt/sarvam-voice-analytics/node_modules/express/index.js
// repeats the same matrix with actual Express on an ephemeral loopback server.
function matcher(pattern, prefix) {
  const escaped = pattern.split("/").map((part) => part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
  return new RegExp(`^${escaped}${prefix ? "(?=/|$)" : "/?$"}`, "i");
}
function harnessRouter() {
  const stack = [];
  const router = { use(paths, ...handlers) {
    if (typeof paths !== "string" && !Array.isArray(paths)) { handlers.unshift(paths); paths = ["/"]; }
    stack.push({ paths: Array.isArray(paths) ? paths : [paths], handlers, prefix: true }); return router;
  }, handle(req, res, done) {
    let index = 0;
    function next() {
      if (res.finished) return;
      const layer = stack[index++];
      if (!layer) return done();
      if (!layer.prefix && layer.method !== req.method.toLowerCase()) return next();
      const pattern = layer.paths.find((item) => (item === "/" && layer.prefix) || matcher(item, layer.prefix).test(req.path));
      if (!pattern) return next();
      let handlerIndex = 0;
      function handlerNext() {
        if (res.finished) return;
        const handler = layer.handlers[handlerIndex++];
        if (!handler) return next();
        if (typeof handler === "function") return handler(req, res, handlerNext);
        const previous = req.path, matched = pattern === "/" ? "" : previous.match(matcher(pattern, true))[0];
        req.path = previous.slice(matched.length) || "/";
        return handler.handle(req, res, () => { req.path = previous; handlerNext(); });
      }
      handlerNext();
    }
    next();
  } };
  for (const method of ["get", "post", "put", "patch", "delete"]) router[method] = (paths, ...handlers) => {
    stack.push({ method, paths: Array.isArray(paths) ? paths : [paths], handlers, prefix: false }); return router;
  };
  return router;
}
const args = process.argv.slice(2);
if (args.length > 1 || args.some((item) => !item.startsWith("--express-root=") || !item.slice("--express-root=".length))) {
  throw new Error("Usage: node test-scoped-catalog-routing.mjs [--express-root=/opt/sarvam-voice-analytics]");
}
const require = createRequire(import.meta.url);
const expressRoot = args[0]?.slice("--express-root=".length);
const realExpress = expressRoot ? createRequire(path.join(path.resolve(expressRoot), "package.json"))("express")
  : process.env.EXPRESS_MODULE_PATH ? require(process.env.EXPRESS_MODULE_PATH) : null;
const express = realExpress || Object.assign(() => harnessRouter(), { Router: harnessRouter });
let requests = 0;

function catalogue(name, legacy) {
  const paths = name === "voters.routes.js" ? [["get", "/voters"], ["get", "/voters/summary"], ["post", "/voters/upload"]]
    : [["get", "/questionnaires"], ["get", "/questionnaires/:id"], ["post", "/questionnaires"],
      ["post", "/questionnaires/:id/questions"], ["put", "/iterations/:iterationId/questionnaire"]];
  const source = `import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
const router = express.Router();
/* RESEARCH_CATALOG_ADMIN_GUARD_V1 */
router.use(requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]));
${paths.map(([method, route]) => `router.${method}(${JSON.stringify(route)}, ${route.startsWith("/iterations/") ? 'requireRole(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"]), ' : ""}(_req, res) => res.json({ok:true}));`).join("\n")}
export default router;`;
  return legacy ? source : scopeCatalogueRouter(source, name).source;
}
function build({ legacy = false, reverse = false } = {}) {
  let catalogueAuthCalls = 0;
  const auth = (req, res, next) => req.headers["x-test-role"] ? next() : res.status(401).json({ error: "Authentication required" });
  const requireAuth = (req, res, next) => { catalogueAuthCalls++; return auth(req, res, next); };
  const requireRole = (roles) => (req, res, next) => roles.includes(req.headers["x-test-role"]) ? next() : res.status(403).json({ error: "Insufficient permissions" });
  const app = express();
  const names = ["voters.routes.js", "questionnaires.routes.js"];
  if (reverse) names.reverse();
  for (const name of names) {
    const source = catalogue(name, legacy).replace(/^import .*;\n/gm, "").replace("export default router;", "return router;");
    app.use("/api", new Function("express", "requireAuth", "requireRole", source)(express, requireAuth, requireRole));
  }
  const downstream = express.Router(), view = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];
  for (const route of ["/campaigns", "/campaigns/:id", "/campaigns/:id/iterations", "/iterations/:id"]) {
    downstream.get(route, auth, requireRole(view), (req, res) => req.headers["x-test-role"] === "CAMPAIGN_MANAGER" && req.path === "/campaigns/unassigned"
      ? res.status(404).json({ error: "Campaign not found" }) : res.json({ ok: true }));
  }
  downstream.patch("/campaigns/:campaignId/iterations/:iterationId/voice-agent", auth, requireRole(["CAMPAIGN_MANAGER"]), (_req, res) => res.json({ ok: true }));
  downstream.post("/campaigns", auth, requireRole(["SUPER_ADMIN", "ADMIN"]), (_req, res) => res.json({ ok: true }));
  for (const route of ["/runs/:runId/launch", "/iterations/:iterationId/runs"]) downstream.post(route, auth, requireRole(["CAMPAIGNER"]), (_req, res) => res.json({ ok: true }));
  app.use("/api", downstream);
  return { app, calls: () => catalogueAuthCalls };
}

async function withRequester(config, test) {
  const { app, calls } = build(config);
  if (realExpress) {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      await test(async (method, route, role) => {
        requests++;
        const before = calls();
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: role ? { "x-test-role": role } : {} });
        await response.text();
        return { status: response.status, catalogueCalls: calls() - before };
      });
    } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  } else {
    await test(async (method, route, role) => {
      requests++;
      const before = calls(), res = { statusCode: 200, finished: false, status(code) { this.statusCode = code; return this; }, json() { this.finished = true; } };
      app.handle({ method, path: new URL(route, "http://isolated.test").pathname, headers: role ? { "x-test-role": role } : {} }, res, () => { res.statusCode = 404; res.finished = true; });
      return { status: res.statusCode, catalogueCalls: calls() - before };
    });
  }
}

for (const reverse of [false, true]) {
  await withRequester({ legacy: true, reverse }, async (request) => {
    assert.equal((await request("GET", "/api/campaigns", "CAMPAIGN_MANAGER")).status, 403, "Reproduces the legacy cross-router denial");
  });
  await withRequester({ reverse }, async (request) => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER", "UNKNOWN", null]) {
      for (const [method, route] of [["GET", "/api/voters"], ["GET", "/api/voters/summary?limit=1"], ["POST", "/api/voters/upload"],
        ["GET", "/api/questionnaires"], ["GET", "/api/questionnaires/q"], ["POST", "/api/questionnaires"],
        ["POST", "/api/questionnaires/q/questions"], ["PUT", "/api/iterations/it/questionnaire"]]) {
        assert.equal((await request(method, route, role)).status, role === null ? 401 : ["ADMIN", "SUPER_ADMIN"].includes(role) ? 200 : 403, `${method} ${route} ${role}`);
      }
      for (const route of ["/api/campaigns", "/api/campaigns/c", "/api/campaigns/c/iterations", "/api/iterations/it"]) {
        const response = await request("GET", route, role);
        assert.equal(response.status, role === null ? 401 : role === "UNKNOWN" ? 403 : 200);
        assert.equal(response.catalogueCalls, 0, `Catalogue auth never sees unrelated ${route}`);
      }
    }
    for (const route of ["/api/voters-summary-other", "/api/questionnaires-other", "/api/iterations/it/questionnaire-other", "/api/unknown"]) {
      assert.deepEqual(await request("GET", route, "CAMPAIGN_MANAGER"), { status: 404, catalogueCalls: 0 });
    }
    assert.deepEqual(await request("PATCH", "/api/campaigns/c/iterations/it/voice-agent", "CAMPAIGN_MANAGER"), { status: 200, catalogueCalls: 0 });
    assert.deepEqual(await request("GET", "/api/campaigns/unassigned", "CAMPAIGN_MANAGER"), { status: 404, catalogueCalls: 0 }, "The downstream assignment boundary remains effective");
    assert.deepEqual(await request("POST", "/api/campaigns", "CAMPAIGN_MANAGER"), { status: 403, catalogueCalls: 0 }, "No expansion of campaign-create authority");
    for (const route of ["/api/runs/r/launch", "/api/iterations/it/runs"]) {
      assert.deepEqual(await request("POST", route, "CAMPAIGN_MANAGER"), { status: 403, catalogueCalls: 0 });
      assert.deepEqual(await request("POST", route, "CAMPAIGNER"), { status: 200, catalogueCalls: 0 });
    }
  });
}
console.log(`Scoped catalogue routing matrix passed: ${requests} requests (${realExpress ? "actual Express, isolated loopback fixtures" : "dependency-free router harness; real Express not requested"}). No live API, database or provider calls performed.`);
