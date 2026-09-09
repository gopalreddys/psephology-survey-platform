import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  listVoterDemoCalls,
  reserveVoterDemoCall,
  updateVoterDemoCall
} from "../repositories/voter-demo-calls.repository.js";
import { dispatchVoterDemoCall } from "../services/voter-demo-call.service.js";

const router = express.Router();
const demoCallRoles = ["SUPER_ADMIN", "ADMIN"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get(
  "/voters/:voterId/demo-calls",
  requireAuth,
  requireRole(demoCallRoles),
  async function (req, res) {
    try {
      if (!UUID_PATTERN.test(req.params.voterId)) {
        return res.status(400).json({ error: "Invalid voter id" });
      }

      const items = await listVoterDemoCalls(req.params.voterId, req.query.limit);
      return res.json({ items });
    } catch (error) {
      console.error("Load voter demo calls failed:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Unable to load demo call history"
      });
    }
  }
);

router.post(
  "/voters/:voterId/demo-calls",
  requireAuth,
  requireRole(demoCallRoles),
  async function (req, res) {
    let reservation = null;

    try {
      const voterId = req.params.voterId;
      const idempotencyKey = String(req.body?.idempotencyKey || "").trim();

      if (!UUID_PATTERN.test(voterId)) {
        return res.status(400).json({ error: "Invalid voter id" });
      }

      if (req.body?.consentConfirmed !== true) {
        return res.status(400).json({
          error: "Consent confirmation is required before a demo call can be launched"
        });
      }

      if (!UUID_PATTERN.test(idempotencyKey)) {
        return res.status(400).json({ error: "A valid idempotency key is required" });
      }

      reservation = await reserveVoterDemoCall({
        voterId,
        requestedBy: req.platformUser.id,
        idempotencyKey
      });

      if (reservation.repeated) {

        if (reservation.request.status === "FAILED") {
          return res.status(409).json({
            error: "This demo call request previously failed. Wait two minutes before submitting a new request."
          });
        }

        return res.status(200).json({
          demoCallId: reservation.request.id,
          status: reservation.request.status,
          repeated: true
        });
      }

      await updateVoterDemoCall(reservation.request.id, {
        status: "SUBMITTING"
      });

      const provider = await dispatchVoterDemoCall({
        demoCallId: reservation.request.id,
        idempotencyKey,
        voter: reservation.voter
      });

      const updated = await updateVoterDemoCall(reservation.request.id, {
        status: "SUBMITTED",
        providerCallId: provider.providerCallId
      });

      return res.status(202).json({
        demoCallId: updated.id,
        status: updated.status,
        providerCallId: updated.provider_call_id,
        analyticsExcluded: true
      });
    } catch (error) {
      if (reservation?.request?.id && !reservation.repeated) {
        try {
          await updateVoterDemoCall(reservation.request.id, {
            status: "FAILED",
            errorCode: error.code || "DEMO_CALL_FAILED",
            errorMessage: String(error.message || "Demo call failed").slice(0, 500)
          });
        } catch (auditError) {
          console.error("Update failed demo call audit failed:", auditError);
        }
      }

      console.error("Launch voter demo call failed:", error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Unable to launch the demo call"
      });
    }
  }
);

export default router;
