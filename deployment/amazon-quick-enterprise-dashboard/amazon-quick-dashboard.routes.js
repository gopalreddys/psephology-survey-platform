import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";

const router = express.Router();
const permittedRoles = ["SUPER_ADMIN", "ADMIN"];

function dashboardConfiguration() {
  const allowedDomains = String(process.env.QUICKSIGHT_ALLOWED_DOMAINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
  return {
    region: process.env.QUICKSIGHT_REGION || process.env.AWS_REGION || "ap-south-1",
    accountId: process.env.QUICKSIGHT_AWS_ACCOUNT_ID || "",
    dashboardId: process.env.QUICKSIGHT_DASHBOARD_ID || "",
    userArn: process.env.QUICKSIGHT_READER_USER_ARN || "",
    allowedDomains,
    staticEmbedUrl: process.env.QUICKSIGHT_ONE_CLICK_EMBED_URL || ""
  };
}

function missingConfiguration(config) {
  if (config.staticEmbedUrl) return [];
  return [
    ["QUICKSIGHT_AWS_ACCOUNT_ID", config.accountId],
    ["QUICKSIGHT_DASHBOARD_ID", config.dashboardId],
    ["QUICKSIGHT_READER_USER_ARN", config.userArn],
    ["QUICKSIGHT_ALLOWED_DOMAINS", config.allowedDomains.length]
  ].filter(([, value]) => !value).map(([name]) => name);
}

router.get(
  "/enterprise-dashboard/config",
  requireAuth,
  requireRole(permittedRoles),
  function (req, res) {
    const config = dashboardConfiguration();
    const missing = missingConfiguration(config);
    return res.json({
      provider: "AMAZON_QUICK_SIGHT",
      configured: missing.length === 0,
      mode: config.staticEmbedUrl ? "ONE_CLICK" : "REGISTERED_USER_API",
      region: config.region,
      dashboardId: config.dashboardId || null,
      missing
    });
  }
);

router.get(
  "/enterprise-dashboard/embed-url",
  requireAuth,
  requireRole(permittedRoles),
  async function (req, res) {
    try {
      const config = dashboardConfiguration();
      const missing = missingConfiguration(config);
      if (missing.length) {
        return res.status(503).json({
          error: `Amazon Quick Sight is not configured: ${missing.join(", ")}`,
          code: "QUICKSIGHT_NOT_CONFIGURED",
          missing
        });
      }
      if (config.staticEmbedUrl) {
        return res.json({
          provider: "AMAZON_QUICK_SIGHT",
          mode: "ONE_CLICK",
          embedUrl: config.staticEmbedUrl
        });
      }

      const {
        QuickSightClient,
        GenerateEmbedUrlForRegisteredUserCommand
      } = await import("@aws-sdk/client-quicksight");
      const client = new QuickSightClient({ region: config.region });
      const response = await client.send(
        new GenerateEmbedUrlForRegisteredUserCommand({
          AwsAccountId: config.accountId,
          UserArn: config.userArn,
          AllowedDomains: config.allowedDomains,
          SessionLifetimeInMinutes: 120,
          ExperienceConfiguration: {
            Dashboard: { InitialDashboardId: config.dashboardId }
          }
        })
      );
      return res.json({
        provider: "AMAZON_QUICK_SIGHT",
        mode: "REGISTERED_USER_API",
        dashboardId: config.dashboardId,
        requestId: response.RequestId || null,
        embedUrl: response.EmbedUrl
      });
    } catch (error) {
      console.error("Unable to create Amazon Quick Sight embed session:", error);
      const dependencyMissing = error?.code === "ERR_MODULE_NOT_FOUND";
      return res.status(503).json({
        error: dependencyMissing
          ? "Amazon Quick Sight SDK is not installed on the API host"
          : "Unable to open Amazon Quick Sight enterprise dashboard",
        code: dependencyMissing ? "QUICKSIGHT_SDK_MISSING" : "QUICKSIGHT_EMBED_FAILED"
      });
    }
  }
);

export default router;
