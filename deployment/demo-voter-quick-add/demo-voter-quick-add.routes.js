import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  addDemoVoterToMaster,
  listDemoVoterGeographies
} from "../repositories/demo-voter-quick-add.repository.js";

const router = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN"];

function replyWithError(res, error) {
  if (error.code === "23505") {
    return res.status(409).json({ error: "This demo voter already exists", code: "DUPLICATE" });
  }
  console.error("Demo voter quick add failed:", {
    code: error.code || null
  });
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "Unable to add demo voter",
    code: error.statusCode ? error.code : "QUICK_ADD_FAILED"
  });
}

router.get(
  "/voters/demo-voter-geographies",
  requireAuth,
  requireRole(adminRoles),
  async function (req, res) {
    try {
      const geographies = await listDemoVoterGeographies();
      return res.json({ geographies });
    } catch (error) {
      return replyWithError(res, error);
    }
  }
);

router.post(
  "/voters/demo-voters",
  requireAuth,
  requireRole(adminRoles),
  async function (req, res) {
    try {
      const result = await addDemoVoterToMaster(req.platformUser, req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return replyWithError(res, error);
    }
  }
);

export default router;
