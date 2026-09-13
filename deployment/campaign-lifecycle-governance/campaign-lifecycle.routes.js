import express from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  completeCampaign,
  getCampaignLifecycle
} from "../repositories/campaign-lifecycle.repository.js";

const router = express.Router();

router.get(
  "/campaigns/:campaignId/lifecycle",
  requireAuth,
  requireRole(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"]),
  async function (req, res) {
    try {
      return res.json(
        await getCampaignLifecycle(req.params.campaignId, req.platformUser)
      );
    } catch (error) {
      console.error("Unable to load Campaign lifecycle:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Unable to load Campaign lifecycle"
      });
    }
  }
);

router.post(
  "/campaigns/:campaignId/complete",
  requireAuth,
  requireRole(["CAMPAIGN_MANAGER"]),
  async function (req, res) {
    try {
      return res.json(
        await completeCampaign(req.params.campaignId, req.platformUser)
      );
    } catch (error) {
      console.error("Unable to complete Campaign:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Unable to complete Campaign"
      });
    }
  }
);

export default router;
