import { REPORT_KEYS } from "./report-catalog.js";
export { REPORT_KEYS } from "./report-catalog.js";

// A collection contract declares intended measurement, not provider execution
// or model accuracy. Explicit missing states are never substantive answers.
export const EXPLICIT_MISSING_STATES = Object.freeze(["NOT_ANSWERED", "CANT_SAY", "REFUSED"]);
const keyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const targetTypes = new Set(["NONE", "PARTY", "CANDIDATE", "LEADER", "SCHEME"]);
const targetRequired = { candidate_impression: "CANDIDATE", candidate_fit: "CANDIDATE",
  leader_assessment: "LEADER", scheme_experience: "SCHEME" };
const fields = new Set(["reportKey", "outputVariables", "valueType", "allowedValues", "target", "missingPolicy"]);

export class ReportingContractError extends Error {
  constructor(message, code = "INVALID_REPORTING_CONTRACT", statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportingContractError(`${label} must be an object`);
  }
  return value;
}

function cleanText(value, label, maximum, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ReportingContractError(`${label} must be text of at most ${maximum} characters`);
  }
  const result = value.trim();
  if (!allowEmpty && !result) throw new ReportingContractError(`${label} cannot be empty`);
  return result;
}

function missingToken(value) {
  return value.toUpperCase().replace(/[\s-]+/g, "_").replace(/[’']/g, "");
}

export function validateReportingContract(input) {
  const body = object(input, "Reporting contract");
  if (Object.keys(body).some((key) => !fields.has(key))) {
    throw new ReportingContractError("Reporting contract contains unsupported fields");
  }
  const reportKey = cleanText(body.reportKey, "Report key", 80);
  if (!REPORT_KEYS.includes(reportKey)) throw new ReportingContractError("Choose a supported report construct");
  if (!Array.isArray(body.outputVariables) || !body.outputVariables.length || body.outputVariables.length > 10) {
    throw new ReportingContractError("Declare between one and ten output variables");
  }
  const outputVariables = body.outputVariables.map((value) => {
    const key = cleanText(value, "Output variable", 80);
    if (!keyPattern.test(key)) throw new ReportingContractError("Output variables must be lowercase snake_case keys");
    return key;
  });
  if (new Set(outputVariables).size !== outputVariables.length) {
    throw new ReportingContractError("Output variables cannot be duplicated");
  }
  const valueType = cleanText(body.valueType, "Value type", 30);
  if (!["CATEGORICAL", "TEXT", "NUMERIC"].includes(valueType)) {
    throw new ReportingContractError("Choose a supported answer value type");
  }
  if (!Array.isArray(body.allowedValues) || body.allowedValues.length > 30) {
    throw new ReportingContractError("Allowed values must be an array with at most thirty entries");
  }
  const allowedValues = body.allowedValues.map((value) => cleanText(value, "Allowed value", 120));
  if (new Set(allowedValues.map((value) => value.toLocaleLowerCase("en-US"))).size !== allowedValues.length) {
    throw new ReportingContractError("Allowed values cannot be duplicated");
  }
  if (allowedValues.some((value) => EXPLICIT_MISSING_STATES.includes(missingToken(value)))) {
    throw new ReportingContractError("Not answered, can't say and refused are separate missing states, not substantive allowed values");
  }
  if (valueType === "CATEGORICAL" && allowedValues.length < 2) {
    throw new ReportingContractError("Categorical measurement requires at least two substantive answer categories");
  }
  if (valueType !== "CATEGORICAL" && allowedValues.length) {
    throw new ReportingContractError("Text and numeric measurements must not declare categorical allowed values");
  }
  const targetInput = body.target === undefined ? { type: "NONE", id: "", name: "" } : object(body.target, "Measurement target");
  if (Object.keys(targetInput).some((key) => !["type", "id", "name"].includes(key))) {
    throw new ReportingContractError("Measurement target contains unsupported fields");
  }
  const type = cleanText(targetInput.type, "Target type", 20);
  if (!targetTypes.has(type)) throw new ReportingContractError("Choose a supported measurement target type");
  const target = {
    type,
    id: cleanText(targetInput.id ?? "", "Stable target ID", 120, type === "NONE"),
    name: cleanText(targetInput.name ?? "", "Target name", 160, type === "NONE")
  };
  if (type === "NONE" && (target.id || target.name)) {
    throw new ReportingContractError("An untargeted measurement must leave target ID and name empty");
  }
  if (type !== "NONE" && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(target.id)) {
    throw new ReportingContractError("Use a stable target ID containing letters, numbers, underscore, dot, colon or hyphen");
  }
  if (targetRequired[reportKey] && type !== targetRequired[reportKey]) {
    throw new ReportingContractError(`This report requires an explicit ${targetRequired[reportKey].toLowerCase()} target`);
  }
  if (["party_salience", "issue_leadership"].includes(reportKey) && !["NONE", "PARTY"].includes(type)) {
    throw new ReportingContractError("Party and group-issue measurements can only be untargeted or explicitly party-targeted");
  }
  if (!targetRequired[reportKey] && !["NONE", "PARTY", "LEADER"].includes(type)) {
    throw new ReportingContractError("This report can only be untargeted, party-targeted or leader-targeted");
  }
  if (body.missingPolicy !== "EXPLICIT_STATES") {
    throw new ReportingContractError("Keep not answered, can't say and refused as explicit separate missing states");
  }
  return { reportKey, outputVariables, valueType, allowedValues, target, missingPolicy: "EXPLICIT_STATES" };
}

export function validateContractSave(input) {
  const body = object(input, "Save request");
  if (Object.keys(body).some((key) => !["expectedContractFingerprint", "contract"].includes(key))) {
    throw new ReportingContractError("Save request contains unsupported fields");
  }
  if (typeof body.expectedContractFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(body.expectedContractFingerprint)) {
    throw new ReportingContractError("Reload the question's current fingerprint before saving", "REPORTING_CONTRACT_FINGERPRINT_REQUIRED");
  }
  return { expectedContractFingerprint: body.expectedContractFingerprint, contract: validateReportingContract(body.contract) };
}
