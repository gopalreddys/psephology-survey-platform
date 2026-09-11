import crypto from "node:crypto";
import express from "express";

import {
  recordSarvamOutboundResult
} from "../repositories/sarvam-outbound-webhook.repository.js";

const router = express.Router();

function tokenMatches(receivedToken) {
  const expectedToken = process.env.SARVAM_OUTBOUND_WEBHOOK_TOKEN || "";
  const received = Buffer.from(String(receivedToken || ""));
  const expected = Buffer.from(expectedToken);

  return Boolean(expectedToken) &&
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected);
}

router.post(
  "/outbound-results/:token",
  async function sarvamOutboundResult(req, res) {
    if (!tokenMatches(req.params.token)) {
      return res.status(404).json({ error: "Not found" });
    }

    try {
      const result = await recordSarvamOutboundResult(req.body || {});

      return res.status(result.matched === false ? 503 : 200).json({
        received: true,
        matched: result.matched !== false,
        duplicate: Boolean(result.duplicate)
      });
    } catch (error) {
      console.error("Sarvam outbound webhook processing failed:", {
        attemptId: req.body?.attempt_id || null,
        code: error.code || null,
        error: error.message
      });

      return res.status(error.statusCode || 500).json({
        error: error.statusCode && error.statusCode < 500
          ? error.message
          : "Unable to process Sarvam outbound result",
        code: error.code || "SARVAM_WEBHOOK_PROCESSING_FAILED"
      });
    }
  }
);

export default router;
