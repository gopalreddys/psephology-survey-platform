#!/usr/bin/env node
// Offline, draft-only alias experiment. No AWS client or publication operations.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROLES = ["enterprise", "geographic", "movement", "quality", "comparability", "map"];
const HISTORICAL_ROLES = ["enterprise", "geographic", "map"];
const METADATA_FIELDS = {
  bindings: "identifier", guards: "datasetIdentifier", filterScopes: "dataset", answerStatusFilters: "dataset"
};
const identifierKeys = new Set(["identifier", "dataset", "datasetIdentifier", "DataSetIdentifier"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
});
const requireString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
};
const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
};

function checkDeclarations(definition, bindings, label) {
  const declarations = requireArray(definition?.DataSetIdentifierDeclarations, `${label} declarations`);
  if (declarations.length !== bindings.length) throw new Error(`${label} must declare all six current bindings`);
  unique(declarations.map((item) => requireString(item.Identifier, `${label} Identifier`)), `${label} identifiers`);
  unique(declarations.map((item) => requireString(item.DataSetArn, `${label} DataSetArn`)), `${label} ARNs`);
  const expected = new Map(bindings.map((item) => [item.identifier, item.arn]));
  for (const item of declarations) {
    if (expected.get(item.Identifier) !== item.DataSetArn) throw new Error(`${label} declaration does not match its current binding: ${item.Identifier}`);
  }
}

function checkDefinitionParity(bundle) {
  const analysis = structuredClone(bundle.analysisRequest.Definition);
  const dashboard = bundle.dashboardRequest.Definition;
  if (Object.hasOwn(dashboard, "QueryExecutionOptions")) {
    throw new Error("Dashboard definitions must not contain QueryExecutionOptions");
  }
  // The sole approved analysis-only API field remains in the actual bundle.
  if (Object.hasOwn(analysis, "QueryExecutionOptions")) {
    if (canonicalJson(analysis.QueryExecutionOptions) !== canonicalJson({ QueryExecutionMode: "AUTO" })) {
      throw new Error("Only analysis-only QueryExecutionOptions {QueryExecutionMode:'AUTO'} is approved");
    }
    delete analysis.QueryExecutionOptions;
  }
  if (canonicalJson(analysis) !== canonicalJson(dashboard)) {
    throw new Error("Shared analysis and dashboard request definition fields must match exactly");
  }
}

function remapDefinition(definition, mapping, label) {
  const visit = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "DataSetIdentifier") {
        if (!mapping.has(value)) throw new Error(`Unknown typed dataset reference at ${path}.${key}: ${value}`);
        node[key] = mapping.get(value);
      } else visit(value, `${path}.${key}`);
    }
  };
  visit(definition, label);
  for (const declaration of definition.DataSetIdentifierDeclarations) {
    if (!mapping.has(declaration.Identifier)) throw new Error(`Unknown declaration identifier: ${declaration.Identifier}`);
    declaration.Identifier = mapping.get(declaration.Identifier);
  }
}

function remapMetadata(manifest, mapping) {
  const permitted = new Set();
  for (const [collection, field] of Object.entries(METADATA_FIELDS)) {
    for (const [index, entry] of requireArray(manifest[collection], `manifest.${collection}`).entries()) {
      if (!entry || typeof entry !== "object" || !mapping.has(entry[field])) {
        throw new Error(`Unknown metadata reference at manifest.${collection}[${index}].${field}`);
      }
      permitted.add(`manifest.${collection}[${index}].${field}`);
    }
  }
  const visit = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (typeof node === "string" && mapping.has(node)) throw new Error(`Unreviewed metadata dataset reference at ${path}`);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const location = `${path}.${key}`;
      if (permitted.has(location)) node[key] = mapping.get(value);
      else {
        if (identifierKeys.has(key) || (typeof value === "string" && mapping.has(value))) {
          throw new Error(`Unreviewed metadata dataset reference at ${location}`);
        }
        visit(value, location);
      }
    }
  };
  visit(manifest, "manifest");
}

function applyMapping(bundle, mapping) {
  const result = structuredClone(bundle);
  for (const request of ["analysisRequest", "dashboardRequest"]) {
    remapDefinition(result[request].Definition, mapping, `${request}.Definition`);
  }
  remapMetadata(result.manifest, mapping);
  return result;
}

/** Preserve every ARN and non-reference value; return a separate hash receipt. */
export function remapHistoricalQuickIdentifiers(bundle, backup) {
  if (requireArray(bundle?.datasetRequests, "datasetRequests").length !== 0) {
    throw new Error("This alias-only experiment requires empty datasetRequests");
  }
  const bindings = requireArray(bundle?.manifest?.bindings, "manifest.bindings");
  if (bindings.length !== ROLES.length || ROLES.some((role) => !bindings.some((item) => item.role === role))) {
    throw new Error("Exactly the six reviewed dataset roles are required");
  }
  unique(bindings.map((item) => item.role), "Binding roles");
  unique(bindings.map((item) => requireString(item.identifier, "Binding identifier")), "Binding identifiers");
  unique(bindings.map((item) => requireString(item.arn, "Binding ARN")), "Binding ARNs");
  for (const request of ["analysisRequest", "dashboardRequest"]) {
    checkDeclarations(bundle[request]?.Definition, bindings, request);
  }
  checkDefinitionParity(bundle);

  const historical = requireArray(backup?.dashboard?.Definition?.DataSetIdentifierDeclarations, "backup dashboard declarations");
  unique(historical.map((item) => requireString(item.Identifier, "Historical identifier")), "Historical identifiers");
  unique(historical.map((item) => requireString(item.DataSetArn, "Historical ARN")), "Historical ARNs");
  const mapping = new Map(bindings.map((item) => [item.identifier, item.identifier]));
  const changes = HISTORICAL_ROLES.map((role) => {
    const historicalArn = requireString(backup?.[role]?.DataSet?.Arn, `backup ${role} dataset ARN`);
    const matches = historical.filter((item) => item.DataSetArn === historicalArn);
    if (matches.length !== 1) throw new Error(`Historical ${role} ARN must match exactly one saved declaration`);
    const current = bindings.find((item) => item.role === role);
    const to = matches[0].Identifier;
    mapping.set(current.identifier, to);
    return { role, from: current.identifier, to, retainedArn: current.arn, historicalSourceArn: historicalArn };
  });
  unique([...mapping.values()], "Remapped identifiers (bijection)");
  const remapped = applyMapping(bundle, mapping);
  for (const request of ["analysisRequest", "dashboardRequest"]) {
    checkDeclarations(remapped[request].Definition, remapped.manifest.bindings, request);
  }
  checkDefinitionParity(remapped);
  const inverse = new Map([...mapping].map(([from, to]) => [to, from]));
  const restored = applyMapping(remapped, inverse);
  if (canonicalJson(restored) !== canonicalJson(bundle)) throw new Error("Whole-bundle inverse comparison failed");
  return {
    bundle: remapped,
    receipt: {
      mode: "LOCAL_ALIAS_EXPERIMENT_NOT_APPLIED", cloudChanges: false,
      changes, unchangedRoles: ROLES.filter((role) => !HISTORICAL_ROLES.includes(role)),
      inputCanonicalSha256: sha256(canonicalJson(bundle)),
      outputCanonicalSha256: sha256(canonicalJson(remapped)),
      backupCanonicalSha256: sha256(canonicalJson(backup)), inverseWholeBundleMatches: true,
      note: "This draft-only binding experiment is not a guaranteed service repair and never publishes."
    }
  };
}

export function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--candidate", "--backup", "--out"].includes(flag) || !args[index + 1] || options[flag]) {
      throw new Error("Usage: node remap-historical-quick-identifiers.mjs --candidate INPUT_JSON --backup BACKUP_JSON --out NEW_OUTPUT_JSON");
    }
    options[flag] = resolve(args[index + 1]);
  }
  if (Object.keys(options).length !== 3) throw new Error("Explicit --candidate, --backup and --out paths are required");
  if (options["--out"] === options["--candidate"] || options["--out"] === options["--backup"]) {
    throw new Error("Output must be a new file, distinct from both inputs");
  }
  const candidateBytes = readFileSync(options["--candidate"]);
  const backupBytes = readFileSync(options["--backup"]);
  const { bundle, receipt } = remapHistoricalQuickIdentifiers(JSON.parse(candidateBytes), JSON.parse(backupBytes));
  const outputBytes = `${JSON.stringify(bundle, null, 2)}\n`;
  writeFileSync(options["--out"], outputBytes, { flag: "wx" });
  return { ...receipt, candidatePath: options["--candidate"], backupPath: options["--backup"], outputPath: options["--out"],
    inputFileSha256: sha256(candidateBytes), backupFileSha256: sha256(backupBytes), outputFileSha256: sha256(outputBytes) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
