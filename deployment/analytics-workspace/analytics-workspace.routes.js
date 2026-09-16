import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getAnalyticsWorkspace } from "../repositories/analytics-workspace.repository.js";

const router = express.Router();

router.get(
  "/analytics",
  requireAuth,
  requireRole(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"]),
  async function (req, res) {
    try {
      return res.json(await getAnalyticsWorkspace(req.platformUser));
    } catch (error) {
      console.error("Unable to load Analytics workspace:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Unable to load Analytics workspace"
      });
    }
  }
);

export default router;
