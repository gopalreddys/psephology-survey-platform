import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { getDb } from '../db/postgres.js';
import { getCallQualityExecution, saveCallQualityReview, saveCallQualityDecision, getCampaignCallQuality } from '../repositories/call-quality-review.repository.js';

const router = express.Router();
const adminRoles = ['SUPER_ADMIN', 'ADMIN'];
function sendError(res, error, fallback) {
  console.error(fallback, { code: error.code || null });
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback,
    code: error.statusCode ? error.code : 'CALL_QUALITY_UNAVAILABLE' });
}
router.get('/research-quality/executions/:executionId', requireAuth, requireRole(adminRoles), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return res.json(await getCallQualityExecution(await getDb(), req.platformUser, req.params.executionId)); }
  catch (error) { return sendError(res, error, 'Unable to load call-quality evidence'); }
});
router.post('/research-quality/executions/:executionId/reviews', requireAuth, requireRole(adminRoles), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return res.json(await saveCallQualityReview(await getDb(), req.platformUser, req.params.executionId, req.body)); }
  catch (error) { return sendError(res, error, 'Unable to record call-quality review'); }
});
router.post('/research-quality/executions/:executionId/decisions', requireAuth, requireRole(adminRoles), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { return res.json(await saveCallQualityDecision(await getDb(), req.platformUser, req.params.executionId, req.body)); }
  catch (error) { return sendError(res, error, 'Unable to record call-quality decision'); }
});
router.get('/research-quality/campaigns/:campaignId', requireAuth, requireRole(['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (Object.keys(req.query).some((key) => key !== 'iterationId') || (req.query.iterationId && typeof req.query.iterationId !== 'string')) {
      return res.status(400).json({ error: 'Select only an Iteration; quality review covers its complete scope', code: 'INVALID_CALL_QUALITY_INPUT' });
    }
    return res.json(await getCampaignCallQuality(await getDb(), req.platformUser, req.params.campaignId,
      req.query.iterationId ? { iterationId: req.query.iterationId } : {}));
  } catch (error) { return sendError(res, error, 'Unable to load call-quality summary'); }
});
export default router;
