import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { getCampaignResearchReport } from '../repositories/research-report.repository.js';

const router = express.Router();
const scalarQuery = (value) => {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 160) {
    const error = new Error('Research report filters must be single text values');
    error.statusCode = 400;
    throw error;
  }
  return value.trim() || null;
};
const enumQuery = (value, permitted, field) => {
  const selected = scalarQuery(value);
  if (selected && !permitted.includes(selected)) {
    const error = new Error(`Choose a supported ${field} filter`);
    error.statusCode = 400;
    throw error;
  }
  return selected;
};

router.get('/analytics/campaigns/:campaignId/research-report', requireAuth,
  requireRole(['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER']), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.json(await getCampaignResearchReport(req.params.campaignId, req.platformUser, {
        iterationId: scalarQuery(req.query.iterationId), runId: scalarQuery(req.query.runId),
        gender: enumQuery(req.query.gender, ['Female', 'Male', 'Other / self-described', 'Unknown'], 'gender'),
        ageBand: enumQuery(req.query.ageBand, ['18–29', '30–39', '40–49', '50+'], 'age-band'),
        mandal: scalarQuery(req.query.mandal), sentimentConstruct: scalarQuery(req.query.sentimentConstruct)
      }));
    } catch (error) {
      console.error('Unable to load aggregate research report', { code: error.code || 'RESEARCH_REPORT_ERROR' });
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : 'Unable to load aggregate research report'
      });
    }
  });

export default router;
