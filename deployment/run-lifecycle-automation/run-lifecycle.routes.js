import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { reconcileRunLifecycleById } from "../repositories/run-lifecycle.repository.js";

const router = express.Router();

router.post(
  "/runs/:runId/reconcile",
  requireAuth,
  requireRole(["CAMPAIGN_MANAGER", "CAMPAIGNER"]),
  async function (req, res) {
    try {
      return res.json(
        await reconcileRunLifecycleById(req.params.runId, req.platformUser)
      );
    } catch (error) {
      console.error("Unable to reconcile Run lifecycle:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Unable to reconcile Run lifecycle"
      });
    }
  }
);

export default router;
