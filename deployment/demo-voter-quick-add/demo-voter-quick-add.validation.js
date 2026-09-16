function fail(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function validateQuickAddInput(input = {}) {
  const fullName = String(input.fullName || "").trim().replace(/\s+/g, " ");
  const digits = String(input.phoneNumber || "").replace(/\D/g, "");
  const phoneNumber = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
  const geoUnitId = String(input.geoUnitId || "").trim();
  const preferredLanguage = String(input.preferredLanguage || "Telugu").trim();
  const age = input.age === "" || input.age == null ? null : Number(input.age);
  const gender = String(input.gender || "").trim().toUpperCase() || null;

  if (fullName.length < 2 || fullName.length > 120) {
    throw fail("Enter a demo voter's name (2–120 characters)", 400, "NAME_INVALID");
  }
  if (!/^[6-9][0-9]{9}$/.test(phoneNumber)) {
    throw fail("Enter a valid 10-digit Indian mobile number", 400, "PHONE_INVALID");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(geoUnitId)) {
    throw fail("Select a Run geography", 400, "GEOGRAPHY_REQUIRED");
  }
  if (input.consentConfirmed !== true) {
    throw fail("Confirm consent for the AI test call and its recording/transcript", 400, "CONSENT_REQUIRED");
  }
  if (preferredLanguage.length > 50) {
    throw fail("Preferred language is too long", 400, "LANGUAGE_INVALID");
  }
  if (age != null && (!Number.isInteger(age) || age < 18 || age > 100)) {
    throw fail("Age must be between 18 and 100", 400, "AGE_INVALID");
  }
  if (gender && !["FEMALE", "MALE", "OTHER", "PREFER_NOT_TO_SAY"].includes(gender)) {
    throw fail("Select a valid gender", 400, "GENDER_INVALID");
  }

  return { fullName, phoneNumber, geoUnitId, preferredLanguage, age, gender };
}
