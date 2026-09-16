import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  createVoterIdentifier,
  createVoterRegistration,
  getVoterElectorateProfile,
  updateVoterIdentifierStatus,
  updateVoterRegistrationStatus
} from "../repositories/voter-electorate.repository.js";

const router = express.Router();
const roles = ["SUPER_ADMIN", "ADMIN"];

function sendError(res, error, fallback) {
  console.error(fallback, error);
  res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    code: error.code || null
  });
}

router.get("/voters/:voterId/electorate-profile", requireAuth, requireRole(roles), async function (req, res) {
  try { res.json(await getVoterElectorateProfile(req.params.voterId)); }
  catch (error) { sendError(res, error, "Unable to load electoral registrations"); }
});

router.post("/voters/:voterId/identifiers", requireAuth, requireRole(roles), async function (req, res) {
  try { res.status(201).json(await createVoterIdentifier(req.params.voterId, req.body || {}, req.platformUser)); }
  catch (error) { sendError(res, error, "Unable to record voter identifier"); }
});

router.patch("/voters/:voterId/identifiers/:identifierId/status", requireAuth, requireRole(roles), async function (req, res) {
  try { res.json(await updateVoterIdentifierStatus(req.params.voterId, req.params.identifierId, req.body?.status, req.platformUser)); }
  catch (error) { sendError(res, error, "Unable to update voter identifier"); }
});

router.post("/voters/:voterId/electorate-registrations", requireAuth, requireRole(roles), async function (req, res) {
  try { res.status(201).json(await createVoterRegistration(req.params.voterId, req.body || {}, req.platformUser)); }
  catch (error) { sendError(res, error, "Unable to record electorate registration"); }
});

router.patch("/voters/:voterId/electorate-registrations/:registrationId/status", requireAuth, requireRole(roles), async function (req, res) {
  try { res.json(await updateVoterRegistrationStatus(req.params.voterId, req.params.registrationId, req.body?.status, req.platformUser)); }
  catch (error) { sendError(res, error, "Unable to update electorate registration"); }
});

export default router;
