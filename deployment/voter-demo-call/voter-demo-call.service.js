const REQUEST_TIMEOUT_MS = 15000;

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export async function dispatchVoterDemoCall({
  demoCallId,
  idempotencyKey,
  voter
}) {
  const runtimeUrl = String(process.env.DEMO_CALL_RUNTIME_URL || "").trim();

  if (!runtimeUrl) {
    throw serviceError(
      "Demo call runtime is not configured. Set DEMO_CALL_RUNTIME_URL before launching a call.",
      503,
      "DEMO_RUNTIME_NOT_CONFIGURED"
    );
  }

  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey
  };

  const runtimeToken = String(process.env.DEMO_CALL_RUNTIME_TOKEN || "").trim();
  if (runtimeToken) {
    headers.Authorization = `Bearer ${runtimeToken}`;
  }

  let response;

  try {
    response = await fetch(runtimeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        demo_call_id: demoCallId,
        voter_id: voter.id,
        recipient_name: voter.full_name,
        phone_number: voter.phone_number,
        preferred_language: voter.preferred_language || null,
        source: "VOTER_MASTER_DEMO",
        analytics_excluded: true
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw serviceError(
      error?.name === "TimeoutError"
        ? "The demo call runtime timed out before accepting the request"
        : "The demo call runtime could not be reached",
      502,
      "DEMO_RUNTIME_UNAVAILABLE"
    );
  }

  const responseText = await response.text();
  let body = {};

  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = { message: responseText };
    }
  }

  if (!response.ok) {
    throw serviceError(
      body.error || body.message || `Demo call runtime returned ${response.status}`,
      502,
      "DEMO_RUNTIME_REJECTED"
    );
  }

  return {
    providerCallId:
      body.provider_call_id ||
      body.call_id ||
      body.id ||
      null,
    providerStatus: body.status || "SUBMITTED"
  };
}
