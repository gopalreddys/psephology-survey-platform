import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getCallOperation, listCallOperations } from "../repositories/call-operations.repository.js";

const router = express.Router();
const roles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];

router.get("/call-operations", requireAuth, requireRole(roles), async function (req, res) {
  try {
    res.json(await listCallOperations(req.platformUser, req.query || {}));
  } catch (error) {
    console.error("Load call operations failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to load call operations" });
  }
});

router.get("/call-operations/:executionId", requireAuth, requireRole(roles), async function (req, res) {
  try {
    const result = await getCallOperation(req.platformUser, req.params.executionId);
    if (!result) return res.status(404).json({ error: "Call attempt not found" });
    res.json(result);
  } catch (error) {
    console.error("Load call operation failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to load call operation" });
  }
});

export default router;
