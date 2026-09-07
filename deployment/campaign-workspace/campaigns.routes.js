import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { createCampaign, deleteCampaign, getCampaignById, listCampaigns, listCampaignVoters, updateCampaignStatus } from "../repositories/campaigns.repository.js";

const router = express.Router();
const viewRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];
const manageRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"];
const reviewRoles = ["SUPER_ADMIN", "ADMIN"];

router.get("/campaigns", requireAuth, requireRole(viewRoles), async function (req, res) {
  try { res.json(await listCampaigns(req.platformUser)); }
  catch (error) { console.error("Load campaigns failed:", error); res.status(500).json({ error: "Unable to load campaigns" }); }
});

router.get("/campaigns/:id", requireAuth, requireRole(viewRoles), async function (req, res) {
  try {
    const campaign = await getCampaignById(req.params.id, req.platformUser);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  } catch (error) { console.error("Load campaign failed:", error); res.status(500).json({ error: "Unable to load campaign" }); }
});

router.get("/campaigns/:id/voters", requireAuth, requireRole(viewRoles), async function (req, res) {
  try {
    const voters = await listCampaignVoters(req.params.id, req.platformUser, { limit: req.query.limit, offset: req.query.offset });
    if (!voters) return res.status(404).json({ error: "Campaign not found" });
    res.json(voters);
  } catch (error) { console.error("Load campaign voters failed:", error); res.status(500).json({ error: "Unable to load campaign voters" }); }
});

router.patch("/campaigns/:id/status", requireAuth, requireRole(reviewRoles), async function (req, res) {
  try { res.json(await updateCampaignStatus(req.params.id, req.body?.status, req.platformUser)); }
  catch (error) {
    console.error("Update campaign status failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to update campaign status" });
  }
});

router.delete("/campaigns/:id", requireAuth, requireRole(manageRoles), async function (req, res) {
  try { res.json(await deleteCampaign(req.params.id, req.platformUser)); }
  catch (error) {
    console.error("Delete campaign failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to delete campaign" });
  }
});

router.post("/campaigns", requireAuth, requireRole(manageRoles), async function (req, res) {
  try { res.status(201).json(await createCampaign(req.body || {}, req.platformUser)); }
  catch (error) {
    console.error("Create campaign failed:", error);
    if (error.code === "23505") return res.status(409).json({ error: "Campaign code or allocation already exists" });
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to create campaign" });
  }
});

export default router;
