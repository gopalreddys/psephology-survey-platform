import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getCampaignAnalysis } from "../repositories/campaign-analysis.repository.js";

const router = express.Router();

router.get(
  "/campaigns/:campaignId/analysis",
  requireAuth,
  requireRole(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"]),
  async function (req, res) {
    try {
      return res.json(
        await getCampaignAnalysis(
          req.params.campaignId,
          req.platformUser
        )
      );
    } catch (error) {
      console.error("Unable to load Campaign comparative analysis:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Unable to load Campaign comparative analysis"
      });
    }
  }
);

export default router;
