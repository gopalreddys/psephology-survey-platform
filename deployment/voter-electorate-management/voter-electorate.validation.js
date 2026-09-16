const identifierTypes = new Set([
  "EPIC", "MLC_GRADUATE_ROLL", "MLC_TEACHER_ROLL",
  "MLC_LOCAL_AUTHORITY_ROLL", "LOCAL_BODY_ROLL", "INTERNAL_DEMO", "OTHER"
]);

const identifierStatuses = new Set(["ACTIVE", "SUPERSEDED", "REVOKED", "UNVERIFIED"]);

const registrationRules = {
  PARLIAMENTARY: { targetType: "MP", basis: "EPIC", identifierType: "EPIC", scope: "JURISDICTION" },
  ASSEMBLY: { targetType: "MLA", basis: "EPIC", identifierType: "EPIC", scope: "JURISDICTION" },
  MLC_GRADUATES: { targetType: "MLC", basis: "GRADUATE_ROLL", identifierType: "MLC_GRADUATE_ROLL", scope: "JURISDICTION" },
  MLC_TEACHERS: { targetType: "MLC", basis: "TEACHER_ROLL", identifierType: "MLC_TEACHER_ROLL", scope: "JURISDICTION" },
  MLC_LOCAL_AUTHORITIES: { targetType: "MLC", basis: "LOCAL_AUTHORITY_ROLL", identifierType: "MLC_LOCAL_AUTHORITY_ROLL", scope: "JURISDICTION" },
  LOCAL_BODY: { targetType: null, basis: "LOCAL_BODY_ROLL", identifierType: "LOCAL_BODY_ROLL", scope: "LOCAL_BODY" },
  DEMO: { targetType: "DEMO", basis: "CONSENTED_DEMO", identifierType: "INTERNAL_DEMO", scope: "DEMO" }
};

const localTargets = new Set([
  "ZPTC", "MPTC", "GRAM_PANCHAYAT", "MUNICIPAL_CORPORATION", "MUNICIPALITY"
]);

function fail(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  throw error;
}

function text(value) {
  return String(value || "").trim();
}

function optionalUuid(value, label, code) {
  const parsed = text(value) || null;
  if (parsed && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) {
    fail(`${label} is invalid`, code);
  }
  return parsed;
}

export function validateIdentifier(input = {}) {
  const identifierType = text(input.identifierType).toUpperCase();
  const identifierValue = text(input.identifierValue);
  if (!identifierTypes.has(identifierType)) fail("Select a valid identifier type", "IDENTIFIER_TYPE_INVALID");
  if (!identifierValue) fail("Identifier value is required", "IDENTIFIER_VALUE_REQUIRED");
  if (identifierValue.length > 160) fail("Identifier value is too long", "IDENTIFIER_VALUE_INVALID");
  return {
    identifierType,
    identifierValue,
    issuingAuthority: text(input.issuingAuthority) || null,
    sourceName: text(input.sourceName) || null,
    isPrimary: Boolean(input.isPrimary)
  };
}

export function validateIdentifierStatus(value) {
  const status = text(value).toUpperCase();
  if (!identifierStatuses.has(status)) fail("Select a valid identifier status", "IDENTIFIER_STATUS_INVALID");
  return status;
}

export function validateRegistration(input = {}) {
  const electorateType = text(input.electorateType).toUpperCase();
  const rule = registrationRules[electorateType];
  if (!rule) fail("Select a valid electorate type", "ELECTORATE_TYPE_INVALID");
  const targetType = rule.targetType || text(input.targetType).toUpperCase();
  if (rule.scope === "LOCAL_BODY" && !localTargets.has(targetType)) {
    fail("Select the local-body office for this roll", "TARGET_TYPE_INVALID");
  }
  const jurisdictionId = optionalUuid(input.jurisdictionId, "Constituency", "JURISDICTION_INVALID");
  const localBodyId = optionalUuid(input.localBodyId, "Local body", "LOCAL_BODY_INVALID");
  const localBodyAreaId = optionalUuid(input.localBodyAreaId, "Electoral area", "LOCAL_BODY_AREA_INVALID");
  const rollIdentifierId = optionalUuid(input.rollIdentifierId, "Roll identifier", "ROLL_IDENTIFIER_INVALID");
  if (rule.scope === "JURISDICTION" && !jurisdictionId) {
    fail("Select the constituency for this registration", "JURISDICTION_REQUIRED");
  }
  if (rule.scope === "LOCAL_BODY" && !localBodyId) {
    fail("Select the local body for this registration", "LOCAL_BODY_REQUIRED");
  }
  if (!rollIdentifierId) fail("Select the supporting roll identifier", "ROLL_IDENTIFIER_REQUIRED");
  if (!Boolean(input.verified)) {
    fail("Confirm that the roll membership was verified", "VERIFICATION_REQUIRED");
  }
  return {
    electorateType,
    targetType,
    eligibilityBasis: rule.basis,
    expectedIdentifierType: rule.identifierType,
    jurisdictionId,
    localBodyId,
    localBodyAreaId,
    rollIdentifierId,
    sourceName: text(input.sourceName) || null,
    validFrom: text(input.validFrom) || null,
    validTo: text(input.validTo) || null
  };
}

export function validateRegistrationStatus(value) {
  const status = text(value).toUpperCase();
  if (!["ELIGIBLE", "VERIFIED", "UNVERIFIED", "INACTIVE", "REJECTED"].includes(status)) {
    fail("Select a valid registration status", "REGISTRATION_STATUS_INVALID");
  }
  return status;
}

export { identifierTypes, registrationRules };
