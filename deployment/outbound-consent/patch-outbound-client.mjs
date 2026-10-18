import { createRequire } from 'node:module';
import { resolve } from 'node:path';
let parse;
for(const require of [createRequire(import.meta.url),createRequire(resolve(process.cwd(),'package.json'))]){
  try{({parse}=require('next/dist/compiled/acorn'));break;}
  catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
if(!parse)throw new Error('Run this operator from the UI checkout with its existing Next dependencies installed');
const MARKER = 'OUTBOUND_CONSENT_BOUNDARY_V1';
const IMPORT = 'import { withOutboundConsentGuard } from "../repositories/outbound-consent.repository.js";';
const WRAPPER = `
/* ${MARKER}: shared final boundary for Run and standalone outbound calls. */
export async function createInstantOutboundCall(options) {
  const inputId = String(options?.agentVariables?.voter_id || "").trim().toLowerCase();
  const metadataId = String(options?.webhookMetadata?.voter_id || "").trim().toLowerCase();
  if (inputId && metadataId && inputId !== metadataId) {
    const error = new Error("Outbound voter identity is inconsistent");
    error.statusCode = 409;
    error.code = "OUTBOUND_IDENTITY_CONFLICT";
    throw error;
  }
  return withOutboundConsentGuard({ voterId: inputId || metadataId,
    phoneNumber: options?.userPhoneNumber }, () => createInstantOutboundCallUnchecked(options));
}
`;

function visit(node, callback, { skipImports = false } = {}) {
  if (!node || typeof node !== 'object' || (skipImports && node.type === 'ImportDeclaration')) return;
  callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => visit(item, callback, { skipImports }));
    else if (value && typeof value === 'object') visit(value, callback, { skipImports });
  }
}

function identifiers(ast, name, options) {
  const result = [];
  visit(ast, node => { if (node.type === 'Identifier' && node.name === name) result.push(node); }, options);
  return result;
}

function supportedOptionsSignature(declaration) {
  if (!declaration?.async || declaration.generator || declaration.params.length !== 1) return false;
  const parameter = declaration.params[0].type === 'AssignmentPattern'
    ? declaration.params[0].left : declaration.params[0];
  // The existing provider contract takes one options object. Do not silently
  // discard positional/rest arguments or adopt an unknown calling convention.
  return ['Identifier', 'ObjectPattern'].includes(parameter.type);
}

function validatePatchedBoundary(source, ast) {
  const exports = ast.body.filter(node => node.type === 'ExportNamedDeclaration'
    && node.declaration?.type === 'FunctionDeclaration'
    && node.declaration.id?.name === 'createInstantOutboundCall');
  const unchecked = ast.body.filter(node => node.type === 'FunctionDeclaration'
    && node.id?.name === 'createInstantOutboundCallUnchecked');
  const imports = ast.body.filter(node => node.type === 'ImportDeclaration'
    && node.source.value === '../repositories/outbound-consent.repository.js');
  if (!source.startsWith(IMPORT + '\n') || !source.endsWith(WRAPPER)
    || exports.length !== 1 || unchecked.length !== 1
    || !supportedOptionsSignature(unchecked[0]) || imports.length !== 1
    || imports[0].specifiers.length !== 1
    || imports[0].specifiers[0].type !== 'ImportSpecifier'
    || imports[0].specifiers[0].imported.name !== 'withOutboundConsentGuard'
    || imports[0].specifiers[0].local.name !== 'withOutboundConsentGuard') {
    throw new Error('Unrecognized or partial outbound consent boundary');
  }
  const publicReferences = identifiers(ast, 'createInstantOutboundCall');
  const uncheckedReferences = identifiers(ast, 'createInstantOutboundCallUnchecked');
  const guardReferences = identifiers(ast, 'withOutboundConsentGuard', { skipImports: true });
  const wrapperCalls = [];
  visit(exports[0].declaration.body, node => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') wrapperCalls.push(node.callee);
  });
  const uncheckedCall = wrapperCalls.find(node => node.name === 'createInstantOutboundCallUnchecked');
  const guardCall = wrapperCalls.find(node => node.name === 'withOutboundConsentGuard');
  if (publicReferences.length !== 1 || publicReferences[0] !== exports[0].declaration.id
    || uncheckedReferences.length !== 2 || uncheckedReferences[0] !== unchecked[0].id
    || uncheckedReferences[1] !== uncheckedCall
    || guardReferences.length !== 1 || guardReferences[0] !== guardCall) {
    // Idempotence is not permission to add an unchecked direct/alias export,
    // another provider-function reference, or an alternate guard binding.
    throw new Error('Unexpected outbound consent boundary references; manual review required');
  }
}

export function patchOutboundClient(source) {
  if (typeof source !== 'string') throw new TypeError('Outbound client source required');
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  if (source.includes(MARKER)) {
    validatePatchedBoundary(source, ast);
    return source;
  }
  if (source.includes('withOutboundConsentGuard') || source.includes('createInstantOutboundCallUnchecked')) {
    throw new Error('Conflicting outbound consent patch');
  }
  const exported=ast.body.filter(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration'
    &&node.declaration.id?.name==='createInstantOutboundCall');
  if(exported.length!==1||!supportedOptionsSignature(exported[0].declaration)){
    throw new Error('Expected one named async outbound export taking one options argument; no files changed');
  }
  // Recursive/internal calls or alternate local references require review, not
  // an automatic rewrite of unknown network paths.
  const declaration=exported[0].declaration;
  const references=identifiers(ast,'createInstantOutboundCall');
  if(references.length!==1||references[0]!==declaration.id){
    throw new Error('Unexpected outbound function references; manual review required');
  }
  const renamed=source.slice(0,exported[0].start)+source.slice(declaration.start,declaration.id.start)
    +'createInstantOutboundCallUnchecked'+source.slice(declaration.id.end);
  const patched = IMPORT+'\n'+renamed+WRAPPER;
  validatePatchedBoundary(patched, parse(patched, { ecmaVersion:'latest', sourceType:'module' }));
  return patched;
}
