import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  addQuickDemoVoterToRun,
  listQuickAddGeographies
} from "../repositories/demo-voter-quick-add.repository.js";

const router = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN"];

function replyWithError(res, error) {
  if (error.code === "23505") {
    return res.status(409).json({ error: "Demo voter or Run recipient already exists", code: "DUPLICATE" });
  }
  console.error("Demo voter quick add failed:", {
    code: error.code || null
  });
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "Unable to add demo voter",
    code: error.statusCode ? error.code : "QUICK_ADD_FAILED"
  });
}

router.get(
  "/runs/:runId/demo-voter-geographies",
  requireAuth,
  requireRole(adminRoles),
  async function (req, res) {
    try {
      const geographies = await listQuickAddGeographies(req.params.runId, req.platformUser);
      return res.json({ geographies });
    } catch (error) {
      return replyWithError(res, error);
    }
  }
);

router.post(
  "/runs/:runId/demo-voters",
  requireAuth,
  requireRole(adminRoles),
  async function (req, res) {
    try {
      const result = await addQuickDemoVoterToRun(req.params.runId, req.platformUser, req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return replyWithError(res, error);
    }
  }
);

export default router;
