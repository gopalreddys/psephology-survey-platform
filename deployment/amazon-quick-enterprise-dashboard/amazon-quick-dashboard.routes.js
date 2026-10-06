import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getDb } from "../db/postgres.js";

const router = express.Router();
const permittedRoles = ["SUPER_ADMIN", "ADMIN"];
const permittedBoundaryTypes = new Set([
  "STATE", "DISTRICT", "ASSEMBLY_CONSTITUENCY", "MANDAL"
]);

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
  "/enterprise-dashboard/geography-boundaries",
  requireAuth,
  requireRole(permittedRoles),
  async function (req, res) {
    try {
      const boundaryType = String(req.query.layer || "ASSEMBLY_CONSTITUENCY")
        .trim()
        .toUpperCase();
      if (!permittedBoundaryTypes.has(boundaryType)) {
        return res.status(400).json({
          error: "Layer must be STATE, DISTRICT, ASSEMBLY_CONSTITUENCY or MANDAL",
          code: "INVALID_BOUNDARY_LAYER"
        });
      }

      const db = await getDb();
      const result = await db.query(
        `SELECT
           boundary_code,
           boundary_name,
           parent_district_name,
           parent_division_name,
           geometry,
           demo_scope,
           source_name,
           source_url,
           verified_at
         FROM analytics_geo_boundary_reference
         WHERE boundary_type = $1
           AND is_active = TRUE
         ORDER BY boundary_name, source_object_id`,
        [boundaryType]
      );
      const first = result.rows[0] || null;
      return res.json({
        layer: boundaryType,
        featureCount: result.rows.length,
        source: first ? {
          name: first.source_name,
          url: first.source_url,
          verifiedAt: first.verified_at
        } : null,
        demoConstituency: {
          number: 52,
          name: "Serilingampally",
          district: "Rangareddy"
        },
        featureCollection: {
          type: "FeatureCollection",
          features: result.rows.map((row) => ({
            type: "Feature",
            properties: {
              code: row.boundary_code,
              name: row.boundary_name,
              district: row.parent_district_name,
              division: row.parent_division_name,
              demoScope: row.demo_scope
            },
            geometry: row.geometry
          }))
        }
      });
    } catch (error) {
      console.error("Unable to load Telangana administrative boundaries:", error);
      return res.status(503).json({
        error: "Unable to load Telangana administrative boundaries",
        code: "BOUNDARY_MAP_UNAVAILABLE"
      });
    }
  }
);

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
