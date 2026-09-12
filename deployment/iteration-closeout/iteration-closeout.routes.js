import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  completeIteration,
  getIterationCloseout,
  getIterationNavigation
} from "../repositories/iteration-closeout.repository.js";

const router = express.Router();
const viewRoles = [
  "SUPER_ADMIN",
  "ADMIN",
  "CAMPAIGN_MANAGER",
  "CAMPAIGNER"
];

function sendError(res, error, fallback) {
  console.error(fallback, error);
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback
  });
}

router.get(
  "/iterations/:iterationId/navigation",
  requireAuth,
  requireRole(viewRoles),
  async function (req, res) {
    try {
      return res.json(
        await getIterationNavigation(
          req.params.iterationId,
          req.platformUser
        )
      );
    } catch (error) {
      return sendError(res, error, "Unable to load iteration navigation");
    }
  }
);

router.get(
  "/iterations/:iterationId/closeout",
  requireAuth,
  requireRole(viewRoles),
  async function (req, res) {
    try {
      return res.json(
        await getIterationCloseout(
          req.params.iterationId,
          req.platformUser
        )
      );
    } catch (error) {
      return sendError(res, error, "Unable to load iteration closeout");
    }
  }
);

router.post(
  "/iterations/:iterationId/complete",
  requireAuth,
  requireRole(["CAMPAIGN_MANAGER"]),
  async function (req, res) {
    try {
      return res.json(
        await completeIteration(
          req.params.iterationId,
          req.platformUser
        )
      );
    } catch (error) {
      return sendError(res, error, "Unable to complete iteration");
    }
  }
);

export default router;
