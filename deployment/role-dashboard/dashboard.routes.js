import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getRoleDashboard } from "../repositories/dashboard.repository.js";

const router = express.Router();

router.get(
  "/dashboard",
  requireAuth,
  requireRole(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"]),
  async function (req, res) {
    try {
      return res.json(await getRoleDashboard(req.platformUser, {
        programId: req.query.programId || "",
        campaignId: req.query.campaignId || "",
        iterationId: req.query.iterationId || "",
        mandal: req.query.mandal || "",
        ageBand: req.query.ageBand || "",
        gender: req.query.gender || "",
        sentimentConstruct: req.query.sentimentConstruct || ""
      }));
    } catch (error) {
      console.error("Unable to load role Dashboard:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Unable to load Dashboard"
      });
    }
  }
);

export default router;
