import { createRequire } from "node:module";
import path from "node:path";

// Next is already a declared application dependency. Its bundled parser lets
// the operator reject dynamic/unknown registrations instead of regex-editing JS.
let parse;
for (const require of [createRequire(import.meta.url), createRequire(path.join(process.cwd(), "package.json"))]) {
  try { ({ parse } = require("next/dist/compiled/acorn")); break; }
  catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
}
if (typeof parse !== "function") throw new Error("Run the catalogue operator from the UI checkout with its normal Next dependencies installed; no files changed");
export const marker = "RESEARCH_CATALOG_SCOPED_ADMIN_GUARD_V2";
const previousMarker = "RESEARCH_CATALOG_ADMIN_GUARD_V1";
export const routeFamilies = {
  "voters.routes.js": ["/voters"],
  "questionnaires.routes.js": ["/questionnaires", "/questions", "/iterations/:iterationId/questionnaire"]
};
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);

function inspect(source) {
  const comments = [];
  return { ast: parse(source, { ecmaVersion: "latest", sourceType: "module", onComment: comments }), comments };
}
function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["start", "end", "loc", "range"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit, node));
    else if (value && typeof value === "object") walk(value, visit, node);
  }
}
function id(node, name) { return node?.type === "Identifier" && node.name === name; }
function string(node) { return node?.type === "Literal" && typeof node.value === "string" ? node.value : null; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function pathsOf(node) {
  const nodes = node?.type === "ArrayExpression" ? node.elements : [node];
  if (!nodes.length || nodes.some((item) => string(item) === null)) throw new Error("Catalogue route paths must be static string literals");
  return nodes.map(string);
}
function adminArguments(args) {
  return args.length === 2 && id(args[0], "requireAuth")
    && args[1]?.type === "CallExpression" && id(args[1].callee, "requireRole")
    && args[1].arguments.length === 1 && args[1].arguments[0]?.type === "ArrayExpression"
    && same(args[1].arguments[0].elements.map(string), ["SUPER_ADMIN", "ADMIN"]);
}

export function scopeCatalogueRouter(source, routeFile) {
  const allowed = routeFamilies[path.basename(routeFile)];
  if (!allowed) throw new Error(`Unknown catalogue route file: ${routeFile}`);
  const { ast, comments } = inspect(source);
  const declarations = ast.body.filter((node) => node.type === "VariableDeclaration"
    && node.declarations.some((item) => id(item.id, "router")));
  const declaration = declarations[0], router = declaration?.declarations.find((item) => id(item.id, "router"));
  if (declarations.length !== 1 || declaration.declarations.length !== 1
    || router.init?.type !== "CallExpression" || router.init.arguments.length !== 0
    || router.init.callee?.type !== "MemberExpression" || router.init.callee.computed
    || !id(router.init.callee.object, "express") || !id(router.init.callee.property, "Router")) {
    throw new Error(`Expected one plain Express router declaration in ${routeFile}`);
  }
  const calls = [], guards = [], references = new Set([router.id]);
  const exported = ast.body.find((node) => node.type === "ExportDefaultDeclaration" && id(node.declaration, "router"));
  if (!exported) throw new Error(`Expected the catalogue router as the default export in ${routeFile}`);
  references.add(exported.declaration);
  walk(ast, (node, parent) => {
    if (node.type !== "CallExpression" || node.callee?.type !== "MemberExpression" || !id(node.callee.object, "router")) return;
    if (node.callee.computed || node.optional || node.callee.optional) throw new Error(`Computed/optional router calls require review in ${routeFile}`);
    references.add(node.callee.object);
    const method = node.callee.property.name;
    if (parent?.type !== "ExpressionStatement" || !ast.body.includes(parent)) throw new Error(`Nested/chained router registration requires review in ${routeFile}`);
    if (method === "use") guards.push({ call: node, statement: parent });
    else {
      if (!methods.has(method)) throw new Error(`Unsupported router.${method} registration in ${routeFile}`);
      calls.push({ paths: pathsOf(node.arguments[0]), statement: parent });
    }
  });
  walk(ast, (node) => {
    if (id(node, "router") && !references.has(node)) throw new Error(`Router aliases or indirect registrations require review in ${routeFile}`);
  });
  if (!calls.length) throw new Error(`No catalogue endpoints found in ${routeFile}`);
  const prefixes = new Set();
  for (const registration of calls) {
    if (registration.statement.start < declaration.end) throw new Error(`Route precedes its declaration in ${routeFile}`);
    for (const routePath of registration.paths) {
      const prefix = allowed.find((item) => routePath === item
        || (!item.startsWith("/iterations/") && routePath.startsWith(`${item}/`)));
      if (!prefix) throw new Error(`Unexpected catalogue route prefix ${routePath} in ${routeFile}; no files changed`);
      prefixes.add(prefix);
    }
  }
  const ownedPrefixes = allowed.filter((item) => prefixes.has(item));
  const guardComments = comments.filter((comment) => [marker, previousMarker].includes(comment.value.trim()));
  if (guards.length > 1 || guardComments.length > 1) throw new Error(`Multiple catalogue guards require review in ${routeFile}`);
  const existing = guards[0], comment = guardComments[0];
  let start = declaration.end, end = declaration.end;
  if (existing || comment) {
    if (!existing || !comment || comment.type !== "Block" || comment.start < declaration.end
      || source.slice(comment.end, existing.statement.start).trim()
      || calls.some((item) => item.statement.start < existing.statement.end)) throw new Error(`Unknown or misplaced catalogue middleware in ${routeFile}`);
    const args = existing.call.arguments;
    const v1 = comment.value.trim() === previousMarker && adminArguments(args);
    const v2 = comment.value.trim() === marker && args.length === 3
      && same(pathsOf(args[0]), ownedPrefixes) && adminArguments(args.slice(1));
    if (!v1 && !v2) throw new Error(`Conflicting catalogue middleware requires review in ${routeFile}`);
    start = comment.start; end = existing.statement.end;
  }
  const authImports = ast.body.filter((node) => node.type === "ImportDeclaration" && node.source.value === "../middleware/auth.middleware.js");
  if (authImports.length !== 1 || !authImports[0].specifiers.some((item) => id(item.imported, "requireAuth") && id(item.local, "requireAuth"))) {
    throw new Error(`Expected the existing requireAuth import in ${routeFile}`);
  }
  const roleImports = ast.body.filter((node) => node.type === "ImportDeclaration" && node.source.value === "../middleware/role.middleware.js");
  if (roleImports.length > 1 || (roleImports.length === 1 && !roleImports[0].specifiers.some((item) => id(item.imported, "requireRole") && id(item.local, "requireRole")))) {
    throw new Error(`Conflicting role middleware import in ${routeFile}`);
  }
  const guard = `/* ${marker} */\nrouter.use(${JSON.stringify(ownedPrefixes)}, requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]));`;
  const edits = [{ start, end, value: existing ? guard : `\n\n${guard}` }];
  if (!roleImports.length) edits.push({ start: authImports[0].end, end: authImports[0].end, value: '\nimport { requireRole } from "../middleware/role.middleware.js";' });
  let patched = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) patched = patched.slice(0, edit.start) + edit.value + patched.slice(edit.end);
  inspect(patched);
  return { source: patched, changed: patched !== source, prefixes: ownedPrefixes, routes: calls.flatMap((item) => item.paths) };
}
