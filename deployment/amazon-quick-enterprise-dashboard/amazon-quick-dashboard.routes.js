import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getDb } from "../db/postgres.js";

const router = express.Router();
const permittedRoles = ["SUPER_ADMIN", "ADMIN"];
const permittedBoundaryTypes = new Set([
  "STATE", "DISTRICT", "ASSEMBLY_CONSTITUENCY", "MANDAL"
]);
const permittedSamplingMethods = new Set([
  "CENSUS", "SIMPLE_RANDOM", "STRATIFIED_RANDOM", "CLUSTER",
  "SYSTEMATIC", "QUOTA", "PURPOSIVE", "CONVENIENCE",
  "DIRECTIONAL_NON_PROBABILITY"
]);
const permittedWeightingStatuses = new Set([
  "NOT_CONFIGURED", "NOT_REQUIRED", "PLANNED", "APPLIED"
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

function numeric(value) {
  return Number(value || 0);
}

function percentage(value, total) {
  return total ? Number(((numeric(value) / numeric(total)) * 100).toFixed(1)) : 0;
}

function mapQuality(row) {
  return {
    campaignId: row.campaign_id,
    campaignCode: row.campaign_code,
    campaignName: row.campaign_name,
    campaignStatus: row.campaign_status,
    programId: row.program_id,
    programCode: row.program_code,
    programName: row.program_name,
    iterationCount: numeric(row.iteration_count),
    callAttempts: numeric(row.call_attempts),
    callbacksReceived: numeric(row.callbacks_received),
    connectedCalls: numeric(row.connected_calls),
    transcriptsCaptured: numeric(row.transcripts_captured),
    responsesCaptured: numeric(row.responses_captured),
    respondentBase: numeric(row.respondent_base),
    averageDurationSeconds: numeric(row.average_duration_seconds),
    callbackCoveragePct: numeric(row.callback_coverage_pct),
    connectionRatePct: numeric(row.connection_rate_pct),
    transcriptCoveragePct: numeric(row.transcript_coverage_pct),
    responseCoveragePct: numeric(row.response_coverage_pct),
    demographicCompletenessPct: numeric(row.demographic_completeness_pct),
    directMeasureCoveragePct: numeric(row.direct_measure_coverage_pct),
    fieldworkStartedAt: row.fieldwork_started_at,
    fieldworkEndedAt: row.fieldwork_ended_at,
    samplingDesign: row.sampling_design,
    weightingStatus: row.weighting_status,
    evidenceQualityStatus: row.evidence_quality_status,
    interpretationLabel: row.interpretation_label
  };
}

function mapMovement(row) {
  return {
    campaignId: row.campaign_id,
    campaignCode: row.campaign_code,
    campaignName: row.campaign_name,
    iterationId: row.iteration_id,
    iterationNumber: numeric(row.iteration_number),
    iterationName: row.iteration_name,
    respondentBase: numeric(row.respondent_base),
    averageDirectPartyStrength: row.average_direct_party_strength === null
      ? null : numeric(row.average_direct_party_strength),
    directMeasureBase: numeric(row.direct_measure_base),
    positiveSentimentPct: numeric(row.positive_sentiment_pct),
    negativeSentimentPct: numeric(row.negative_sentiment_pct),
    candidatePositivePct: numeric(row.candidate_positive_pct),
    issueResponseBase: numeric(row.issue_response_base),
    partyStrengthChange: row.party_strength_change === null
      ? null : numeric(row.party_strength_change),
    positiveSentimentChangePct: row.positive_sentiment_change_pct === null
      ? null : numeric(row.positive_sentiment_change_pct),
    candidatePositiveChangePct: row.candidate_positive_change_pct === null
      ? null : numeric(row.candidate_positive_change_pct),
    comparisonBasis: row.comparison_basis,
    comparisonReasons: row.comparison_reasons || [],
    interpretationLabel: row.interpretation_label
  };
}

function mapResearchDesign(row) {
  return {
    campaignId: row.campaign_id,
    campaignCode: row.campaign_code,
    campaignName: row.campaign_name,
    iterationId: row.iteration_id,
    iterationNumber: numeric(row.iteration_number),
    iterationName: row.iteration_name,
    questionnaireId: row.questionnaire_id,
    questionnaireFingerprint: row.questionnaire_fingerprint,
    targetPopulation: row.target_population || "Not declared",
    sampleFrameName: row.sample_frame_name || "",
    samplingMethod: row.sampling_method || "DIRECTIONAL_NON_PROBABILITY",
    selectionMethod: row.selection_method || "",
    weightingStatus: row.weighting_status || "NOT_CONFIGURED",
    weightingMethod: row.weighting_method || "",
    weightingVariables: row.weighting_variables || [],
    fieldworkMode: row.fieldwork_mode || "AI_ASSISTED_OUTBOUND_VOICE",
    methodologyNotes: row.methodology_notes || "",
    declaredAt: row.declared_at,
    comparisonStatus: row.comparison_status,
    comparisonReasons: row.comparison_reasons || []
  };
}

function cleanText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

router.put(
  "/enterprise-dashboard/research-designs/:iterationId",
  requireAuth,
  requireRole(permittedRoles),
  async function (req, res) {
    try {
      const iterationId = cleanText(req.params.iterationId, 40);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(iterationId)) {
        return res.status(400).json({
          error: "A valid Iteration ID is required",
          code: "INVALID_ITERATION_ID"
        });
      }
      const targetPopulation = cleanText(req.body?.targetPopulation);
      const samplingMethod = cleanText(req.body?.samplingMethod, 80).toUpperCase();
      const weightingStatus = cleanText(req.body?.weightingStatus, 40).toUpperCase();
      const weightingMethod = cleanText(req.body?.weightingMethod);
      const weightingVariables = Array.from(new Set(
        (Array.isArray(req.body?.weightingVariables) ? req.body.weightingVariables : [])
          .map((value) => cleanText(value, 80))
          .filter(Boolean)
      )).slice(0, 20);
      if (!targetPopulation) {
        return res.status(400).json({
          error: "Target population is required",
          code: "TARGET_POPULATION_REQUIRED"
        });
      }
      if (!permittedSamplingMethods.has(samplingMethod)) {
        return res.status(400).json({
          error: "Select a supported sampling method",
          code: "INVALID_SAMPLING_METHOD"
        });
      }
      if (!permittedWeightingStatuses.has(weightingStatus)) {
        return res.status(400).json({
          error: "Select a supported weighting status",
          code: "INVALID_WEIGHTING_STATUS"
        });
      }
      if (["PLANNED", "APPLIED"].includes(weightingStatus) && !weightingMethod) {
        return res.status(400).json({
          error: "Weighting method is required when weighting is planned or applied",
          code: "WEIGHTING_METHOD_REQUIRED"
        });
      }

      const db = await getDb();
      const saved = await db.query(`
        WITH target AS (
          SELECT iteration.id AS iteration_id, link.campaign_id
          FROM program_iterations iteration
          JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
          JOIN campaigns campaign ON campaign.id = link.campaign_id
          WHERE iteration.id = $1::uuid
            AND campaign.status <> 'ARCHIVED'
          ORDER BY link.created_at
          LIMIT 1
        )
        INSERT INTO analytics_research_design_registry (
          iteration_id, campaign_id, target_population, sample_frame_name,
          sampling_method, selection_method, weighting_status, weighting_method,
          weighting_variables, fieldwork_mode, methodology_notes,
          declared_by_user_id, declared_at, updated_at
        )
        SELECT
          target.iteration_id, target.campaign_id, $2, NULLIF($3, ''),
          $4, NULLIF($5, ''), $6, NULLIF($7, ''),
          $8::jsonb, $9, NULLIF($10, ''), $11::uuid, now(), now()
        FROM target
        ON CONFLICT (iteration_id) DO UPDATE SET
          campaign_id = EXCLUDED.campaign_id,
          target_population = EXCLUDED.target_population,
          sample_frame_name = EXCLUDED.sample_frame_name,
          sampling_method = EXCLUDED.sampling_method,
          selection_method = EXCLUDED.selection_method,
          weighting_status = EXCLUDED.weighting_status,
          weighting_method = EXCLUDED.weighting_method,
          weighting_variables = EXCLUDED.weighting_variables,
          fieldwork_mode = EXCLUDED.fieldwork_mode,
          methodology_notes = EXCLUDED.methodology_notes,
          declared_by_user_id = EXCLUDED.declared_by_user_id,
          declared_at = EXCLUDED.declared_at,
          updated_at = now()
        RETURNING iteration_id
      `, [
        iterationId,
        targetPopulation,
        cleanText(req.body?.sampleFrameName),
        samplingMethod,
        cleanText(req.body?.selectionMethod),
        weightingStatus,
        weightingMethod,
        JSON.stringify(weightingVariables),
        cleanText(req.body?.fieldworkMode, 120) || "AI_ASSISTED_OUTBOUND_VOICE",
        cleanText(req.body?.methodologyNotes, 2000),
        req.platformUser.id
      ]);
      if (!saved.rowCount) {
        return res.status(404).json({
          error: "Iteration was not found",
          code: "ITERATION_NOT_FOUND"
        });
      }
      const result = await db.query(`
        SELECT *
        FROM analytics_iteration_comparability_v1
        WHERE iteration_id = $1::uuid
      `, [iterationId]);
      return res.json(mapResearchDesign(result.rows[0]));
    } catch (error) {
      console.error("Unable to save research design:", error);
      return res.status(503).json({
        error: "Unable to save research design",
        code: "RESEARCH_DESIGN_SAVE_FAILED"
      });
    }
  }
);

router.get(
  "/enterprise-dashboard/research-quality",
  requireAuth,
  requireRole(permittedRoles),
  async function (req, res) {
    try {
      const db = await getDb();
      const [qualityResult, movementResult, designResult] = await Promise.all([
        db.query(`
          SELECT *
          FROM analytics_research_quality_v1
          ORDER BY fieldwork_ended_at DESC NULLS LAST, campaign_name
        `),
        db.query(`
          SELECT *
          FROM analytics_iteration_movement_v1
          ORDER BY campaign_name, iteration_number
        `),
        db.query(`
          SELECT *
          FROM analytics_iteration_comparability_v1
          ORDER BY campaign_name, iteration_number
        `)
      ]);
      const campaigns = qualityResult.rows.map(mapQuality);
      const totals = campaigns.reduce((summary, campaign) => ({
        callAttempts: summary.callAttempts + campaign.callAttempts,
        callbacksReceived: summary.callbacksReceived + campaign.callbacksReceived,
        connectedCalls: summary.connectedCalls + campaign.connectedCalls,
        transcriptsCaptured: summary.transcriptsCaptured + campaign.transcriptsCaptured,
        responsesCaptured: summary.responsesCaptured + campaign.responsesCaptured,
        respondentBase: summary.respondentBase + campaign.respondentBase
      }), {
        callAttempts: 0,
        callbacksReceived: 0,
        connectedCalls: 0,
        transcriptsCaptured: 0,
        responsesCaptured: 0,
        respondentBase: 0
      });
      const demographicWeightedTotal = campaigns.reduce(
        (total, campaign) => total +
          (campaign.demographicCompletenessPct * campaign.respondentBase),
        0
      );
      const limitedCampaigns = campaigns.filter(
        (campaign) => campaign.evidenceQualityStatus === "LIMITED"
      ).length;
      const researchDesigns = designResult.rows.map(mapResearchDesign);
      const declaredDesigns = researchDesigns.filter((design) => design.declaredAt);
      const samplingMethods = Array.from(new Set(
        declaredDesigns.map((design) => design.samplingMethod)
      ));
      const weightingStatuses = Array.from(new Set(
        declaredDesigns.map((design) => design.weightingStatus)
      ));
      const evidenceQualityStatus = !campaigns.length || !declaredDesigns.length
        ? "LIMITED"
        : declaredDesigns.length < researchDesigns.length || limitedCampaigns > 0
          ? "MIXED"
          : "DIRECTIONAL";
      return res.json({
        portfolio: {
          campaignCount: campaigns.length,
          respondentBase: totals.respondentBase,
          callAttempts: totals.callAttempts,
          connectedCalls: totals.connectedCalls,
          connectionRatePct: percentage(totals.connectedCalls, totals.callAttempts),
          transcriptCoveragePct: percentage(
            totals.transcriptsCaptured,
            totals.connectedCalls
          ),
          responseCoveragePct: percentage(totals.responsesCaptured, totals.connectedCalls),
          demographicCompletenessPct: totals.respondentBase
            ? Number((demographicWeightedTotal / totals.respondentBase).toFixed(1))
            : 0,
          evidenceQualityStatus
        },
        methodology: {
          samplingDesign: !declaredDesigns.length
            ? "Not declared"
            : samplingMethods.length === 1
              ? samplingMethods[0].replaceAll("_", " ")
              : "Mixed declared methods",
          weightingStatus: !declaredDesigns.length
            ? "Not declared"
            : weightingStatuses.length === 1
              ? weightingStatuses[0].replaceAll("_", " ")
              : "Mixed declared statuses",
          statisticalPrecision: "No sampling margin of error",
          comparisonRule: "Interpret movement only when the core questionnaire and sampling approach remain comparable",
          permittedUse: "Aggregate research planning and repeated-wave comparison",
          prohibitedUse: "Constituency vote-share forecast or individual political profiling"
        },
        campaigns,
        movement: movementResult.rows.map(mapMovement),
        researchDesigns,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Unable to load enterprise research quality:", error);
      return res.status(503).json({
        error: "Unable to load enterprise research quality",
        code: "RESEARCH_QUALITY_UNAVAILABLE"
      });
    }
  }
);

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
