import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { assertRunAccess } from "../repositories/run-access.repository.js";
import { listPendingRunContacts } from "../repositories/run-launch-preview.repository.js";

const router = express.Router();

router.get(
  "/runs/:runId/pending-contacts",
  requireAuth,
  requireRole(["CAMPAIGNER"]),
  async function (req, res) {
    try {
      await assertRunAccess(
        req.params.runId,
        req.platformUser,
        { mutate: true }
      );

      return res.json(
        await listPendingRunContacts(req.params.runId, req.query.limit)
      );
    } catch (error) {
      console.error("Unable to preview pending Run contacts:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Unable to preview pending voters"
      });
    }
  }
);

export default router;
