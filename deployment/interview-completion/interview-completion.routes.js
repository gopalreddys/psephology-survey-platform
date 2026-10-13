import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { getDb } from '../db/postgres.js';
import { getInterviewCompletionExecution, getCampaignInterviewCompletion } from '../repositories/interview-completion.repository.js';

const router = express.Router();
function sendError(res, error, fallback) {
  console.error(fallback, { code: error.code || null });
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback,
    code: error.statusCode ? error.code : 'INTERVIEW_COMPLETION_UNAVAILABLE' });
}
router.get('/interview-completion/executions/:executionId', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Execution assessment does not accept filters', code: 'INVALID_INTERVIEW_COMPLETION_INPUT' });
    return res.json(await getInterviewCompletionExecution(await getDb(), req.platformUser, req.params.executionId));
  } catch (error) { return sendError(res, error, 'Unable to load recorded interview completion'); }
});
router.get('/interview-completion/campaigns/:campaignId', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (Object.keys(req.query).some((key) => key !== 'iterationId') || (req.query.iterationId !== undefined && typeof req.query.iterationId !== 'string')) {
      return res.status(400).json({ error: 'Select only an Iteration; recorded coverage includes all Runs', code: 'INVALID_INTERVIEW_COMPLETION_INPUT' });
    }
    return res.json(await getCampaignInterviewCompletion(await getDb(), req.platformUser, req.params.campaignId,
      req.query.iterationId === undefined ? {} : { iterationId: req.query.iterationId }));
  } catch (error) { return sendError(res, error, 'Unable to load recorded interview coverage'); }
});
export default router;
