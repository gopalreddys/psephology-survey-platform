const BASE_URL = "https://apps.sarvam.ai/api/app-authoring/v1";

function requiredEnvironment(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : "");
  if (!value) {
    const error = new Error(`${name} is not configured on the API service`);
    error.statusCode = 503;
    throw error;
  }
  return value;
}

function configuration() {
  return {
    apiKey: requiredEnvironment("SARVAM_VOICE_API_KEY", "SARVAM_API_KEY"),
    organizationId: requiredEnvironment("SARVAM_ORG_ID"),
    workspaceId: requiredEnvironment("SARVAM_WORKSPACE_ID")
  };
}

async function sarvamGet(pathname, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; }
    catch { body = { message: text }; }
    if (!response.ok) {
      const error = new Error(body.error || body.message || `Sarvam returned ${response.status}`);
      error.statusCode = response.status === 401 || response.status === 403 ? 502 : 503;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Sarvam agent synchronization timed out");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSarvamDeployments() {
  const config = configuration();
  const basePath = `/orgs/${encodeURIComponent(config.organizationId)}/workspaces/${encodeURIComponent(config.workspaceId)}/deployments`;
  const deployments = [];
  let offset = 0;

  while (true) {
    const page = await sarvamGet(`${basePath}?limit=100&offset=${offset}&sort_by=updated_at&sort_order=desc`, config.apiKey);
    const items = Array.isArray(page.items) ? page.items : [];
    deployments.push(...items);
    offset += items.length;
    if (!items.length || offset >= Number(page.total || 0)) break;
  }

  const detailed = await Promise.all(deployments.map(async function (deployment) {
    const id = String(deployment.deployment_id || "").trim();
    if (!id) return deployment;
    try {
      return await sarvamGet(`${basePath}/${encodeURIComponent(id)}`, config.apiKey);
    } catch (error) {
      console.warn(`Unable to load Sarvam deployment details for ${id}:`, error.message);
      return deployment;
    }
  }));

  return detailed.filter(function (deployment) {
    return deployment.deployment_id && deployment.app_id && Number(deployment.app_version) > 0;
  });
}
