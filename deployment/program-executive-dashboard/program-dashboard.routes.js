import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getProgramDashboard } from "../repositories/program-dashboard.repository.js";

const router = express.Router();

router.get(
  "/programs/:programId/dashboard",
  requireAuth,
  requireRole(["SUPER_ADMIN", "ADMIN"]),
  async function (req, res) {
    try {
      return res.json(
        await getProgramDashboard(req.params.programId, req.platformUser)
      );
    } catch (error) {
      console.error("Unable to load Program executive dashboard:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Unable to load Program executive dashboard"
      });
    }
  }
);

export default router;
