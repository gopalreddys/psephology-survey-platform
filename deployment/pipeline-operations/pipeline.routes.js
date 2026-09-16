import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getPipelineOverview, recoveryTimerStatus } from "../repositories/pipeline.repository.js";

const router = express.Router();

router.get(
  "/pipeline",
  requireAuth,
  requireRole(["SUPER_ADMIN"]),
  async function (_req, res) {
    const timer = await recoveryTimerStatus();
    try {
      return res.json({ ...await getPipelineOverview(), api: { status: "reachable" }, timer });
    } catch (error) {
      console.error("Unable to load Pipeline diagnostics:", { code: error.code, message: error.message });
      return res.status(503).json({
        error: "Pipeline database diagnostics are unavailable",
        api: { status: "reachable" },
        database: { status: "unreachable" },
        timer
      });
    }
  }
);

export default router;
