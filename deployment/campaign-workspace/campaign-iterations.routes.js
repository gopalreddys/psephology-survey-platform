import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  createCampaignIteration,
  listCampaignIterationAllocations,
  listCampaignIterations,
  saveCampaignIterationAllocations,
  updateCampaignIterationStatus
} from "../repositories/campaign-iterations.repository.js";

const router = express.Router();
const viewRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];
const statusRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"];

function sendError(res, error, fallback) {
  console.error(fallback, error);
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback
  });
}

router.get("/campaigns/:id/iterations", requireAuth, requireRole(viewRoles), async function (req, res) {
  try {
    return res.json(await listCampaignIterations(req.params.id, req.platformUser));
  } catch (error) {
    return sendError(res, error, "Unable to load campaign iterations");
  }
});

router.post("/campaigns/:id/iterations", requireAuth, requireRole(["CAMPAIGN_MANAGER"]), async function (req, res) {
  try {
    const body = req.body || {};
    const result = await createCampaignIteration({
      campaignId: req.params.id,
      iterationName: body.iterationName,
      researchPhase: body.researchPhase,
      objective: body.objective,
      sampleDesignType: body.sampleDesignType,
      targetSampleSize: body.targetSampleSize,
      plannedStartDate: body.plannedStartDate,
      plannedEndDate: body.plannedEndDate,
      createdBy: req.platformUser.id
    });
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, "Unable to create campaign iteration");
  }
});

router.get("/campaigns/:campaignId/iterations/:iterationId/allocations", requireAuth, requireRole(viewRoles), async function (req, res) {
  try {
    return res.json(await listCampaignIterationAllocations(
      req.params.campaignId,
      req.params.iterationId,
      req.platformUser
    ));
  } catch (error) {
    return sendError(res, error, "Unable to load iteration allocations");
  }
});

router.put("/campaigns/:campaignId/iterations/:iterationId/allocations", requireAuth, requireRole(["CAMPAIGN_MANAGER"]), async function (req, res) {
  try {
    return res.json(await saveCampaignIterationAllocations(
      req.params.campaignId,
      req.params.iterationId,
      req.body?.assignments,
      req.platformUser
    ));
  } catch (error) {
    return sendError(res, error, "Unable to save iteration allocations");
  }
});

router.patch("/campaigns/:campaignId/iterations/:iterationId/status", requireAuth, requireRole(statusRoles), async function (req, res) {
  try {
    return res.json(await updateCampaignIterationStatus(
      req.params.campaignId,
      req.params.iterationId,
      req.body?.status,
      req.platformUser
    ));
  } catch (error) {
    return sendError(res, error, "Unable to update campaign iteration status");
  }
});

export default router;
