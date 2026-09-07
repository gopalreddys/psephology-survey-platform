import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { listCampaignPrograms } from "../repositories/campaign-programs.repository.js";

const router = express.Router();
const roles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"];

router.get("/campaign-programs", requireAuth, requireRole(roles), async function (req, res) {
  try {
    res.json(await listCampaignPrograms(req.platformUser));
  } catch (error) {
    console.error("Load campaign programs failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to load assigned programs" });
  }
});

export default router;
