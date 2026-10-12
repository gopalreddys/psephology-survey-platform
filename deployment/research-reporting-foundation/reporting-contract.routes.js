import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { getDb } from "../db/postgres.js";
import { listQuestionnaireReportingCoverage, saveQuestionReportingContract } from "../repositories/reporting-contract.repository.js";

const router = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN"];

function sendError(res, error, fallback) {
  // Do not log question text, metadata, provider payloads or respondent data.
  console.error(fallback, { code: error.code || null });
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    code: error.statusCode ? error.code : "REPORTING_CONTRACT_UNAVAILABLE"
  });
}

router.get("/questionnaires/:questionnaireId/reporting-coverage", requireAuth, requireRole(adminRoles), async function (req, res) {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await listQuestionnaireReportingCoverage(await getDb(), req.platformUser, req.params.questionnaireId));
  } catch (error) { return sendError(res, error, "Unable to load questionnaire reporting contracts"); }
});

router.patch("/questionnaires/:questionnaireId/questions/:questionId/reporting-contract", requireAuth, requireRole(adminRoles), async function (req, res) {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await saveQuestionReportingContract(await getDb(), req.platformUser,
      req.params.questionnaireId, req.params.questionId, req.body || {}));
  } catch (error) { return sendError(res, error, "Unable to save questionnaire reporting contract"); }
});

export default router;
