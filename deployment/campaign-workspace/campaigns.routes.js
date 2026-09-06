import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { createCampaign, listCampaigns } from "../repositories/campaigns.repository.js";

const router = express.Router();
const viewRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];
const manageRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"];

router.get("/campaigns", requireAuth, requireRole(viewRoles), async function (_req, res) {
  try {
    res.json(await listCampaigns());
  } catch (error) {
    console.error("Load campaigns failed:", error);
    res.status(500).json({ error: "Unable to load campaigns" });
  }
});

router.post("/campaigns", requireAuth, requireRole(manageRoles), async function (req, res) {
  try {
    const campaign = await createCampaign(req.body || {});
    res.status(201).json(campaign);
  } catch (error) {
    console.error("Create campaign failed:", error);
    if (error.code === "23505") return res.status(409).json({ error: "Campaign code already exists" });
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to create campaign" });
  }
});

export default router;
