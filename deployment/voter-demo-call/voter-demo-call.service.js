import { createInstantOutboundCall } from "../clients/sarvam.js";
import { buildVoterDemoAgentVariables } from "./voter-demo-call-context.js";

const DEFAULT_SARVAM_CONFIGURATION = {
  appId: "Conversatio-040de042-626d",
  appVersion: 9,
  connectionId: "ee3407f4-85-8805a44f-a822",
  agentPhoneNumber: "+918065356536"
};

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeIndianPhone(phone) {
  if (!phone) {
    throw serviceError(
      "The selected voter does not have a phone number",
      409,
      "PHONE_NOT_AVAILABLE"
    );
  }

  let cleaned = String(phone).replace(/[^0-9+]/g, "");

  if (cleaned.startsWith("+91")) {
    const national = cleaned.slice(3);
    if (/^[6-9][0-9]{9}$/.test(national)) return cleaned;
  }

  cleaned = cleaned.replace(/\D/g, "");

  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    cleaned = cleaned.slice(2);
  }

  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  if (!/^[6-9][0-9]{9}$/.test(cleaned)) {
    throw serviceError(
      "The selected voter has an invalid Indian mobile number",
      409,
      "INVALID_PHONE_NUMBER"
    );
  }

  return `+91${cleaned}`;
}

function sarvamConfiguration() {
  const appVersion = Number(
    process.env.SARVAM_DEMO_APP_VERSION ||
    DEFAULT_SARVAM_CONFIGURATION.appVersion
  );

  if (!Number.isInteger(appVersion) || appVersion < 1) {
    throw serviceError(
      "SARVAM_DEMO_APP_VERSION must be a positive integer",
      503,
      "DEMO_CONFIGURATION_INVALID"
    );
  }

  return {
    appId:
      process.env.SARVAM_DEMO_APP_ID ||
      DEFAULT_SARVAM_CONFIGURATION.appId,
    appVersion,
    connectionId:
      process.env.SARVAM_DEMO_CONNECTION_ID ||
      DEFAULT_SARVAM_CONFIGURATION.connectionId,
    agentPhoneNumber:
      process.env.SARVAM_DEMO_AGENT_PHONE_NUMBER ||
      DEFAULT_SARVAM_CONFIGURATION.agentPhoneNumber
  };
}

export async function dispatchVoterDemoCall({
  demoCallId,
  voter
}) {
  const configuration = sarvamConfiguration();
  const phoneNumber = normalizeIndianPhone(voter.phone_number);
  const agentVariables = buildVoterDemoAgentVariables({ demoCallId, voter });

  let providerResponse;

  try {
    providerResponse = await createInstantOutboundCall({
      ...configuration,
      userPhoneNumber: phoneNumber,
      agentVariables,
      webhookMetadata: {
        demo_call_id: demoCallId,
        voter_id: voter.id,
        source: "VOTER_MASTER_DEMO",
        analytics_excluded: "true"
      }
    });
  } catch (error) {
    console.error("Sarvam demo call submission failed:", {
      demoCallId,
      voterId: voter.id,
      error: error.message
    });

    throw serviceError(
      "Sarvam did not accept the demo call. Review the API service log for the provider response.",
      502,
      "SARVAM_DEMO_SUBMISSION_FAILED"
    );
  }

  return {
    providerCallId:
      providerResponse?.attempt_id ||
      providerResponse?.attemptId ||
      providerResponse?.call_id ||
      providerResponse?.callId ||
      providerResponse?.id ||
      null,
    providerStatus: "SUBMITTED"
  };
}
