import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  getUserProfile,
  updateUserProfile
} from "../repositories/user-profiles.repository.js";

const router = express.Router();
const roles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];

router.get(
  "/users/:id/profile",
  requireAuth,
  requireRole(roles),
  async function (req, res) {
    try {
      res.json(await getUserProfile(req.params.id, req.platformUser));
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Unable to load user profile"
      });
    }
  }
);

router.patch(
  "/users/:id/profile",
  requireAuth,
  requireRole(roles),
  async function (req, res) {
    try {
      res.json(await updateUserProfile(req.params.id, req.body || {}, req.platformUser));
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Unable to update user profile"
      });
    }
  }
);

export default router;
