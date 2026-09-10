import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { classifyVoiceAgent, listVoiceAgents, registerVoiceAgent, synchronizeVoiceAgents } from "../repositories/voice-agents.repository.js";

const router = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN"];
const catalogRoles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"];

function sendError(res, error, fallback) {
  console.error(fallback, error);
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback });
}

router.get("/voice-agents", requireAuth, requireRole(catalogRoles), async function (req, res) {
  try {
    return res.json(await listVoiceAgents({ selectableOnly: req.query.selectable === "true" }));
  } catch (error) {
    return sendError(res, error, "Unable to load voice agents");
  }
});

router.post("/voice-agents/sync", requireAuth, requireRole(adminRoles), async function (req, res) {
  try {
    return res.json(await synchronizeVoiceAgents(req.platformUser));
  } catch (error) {
    return sendError(res, error, "Unable to synchronize Sarvam voice agents");
  }
});

router.post("/voice-agents/register", requireAuth, requireRole(adminRoles), async function (req, res) {
  try {
    return res.status(201).json(await registerVoiceAgent(req.body || {}, req.platformUser));
  } catch (error) {
    return sendError(res, error, "Unable to register Sarvam Agent App");
  }
});

router.patch("/voice-agents/:id", requireAuth, requireRole(adminRoles), async function (req, res) {
  try {
    return res.json(await classifyVoiceAgent(req.params.id, req.body || {}, req.platformUser));
  } catch (error) {
    return sendError(res, error, "Unable to update voice-agent classification");
  }
});

export default router;
