import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { listLocalBodies, listLocalBodyElectoralAreas } from "../repositories/local-bodies.repository.js";

const router = express.Router();
const roles = ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"];

router.get("/local-bodies", requireAuth, requireRole(roles), async function (req, res) {
  try {
    res.json(await listLocalBodies({ bodyType: req.query.bodyType || null, search: req.query.search || null, limit: req.query.limit, offset: req.query.offset }));
  } catch (error) {
    console.error("Load local bodies failed:", error);
    res.status(500).json({ error: "Unable to load local bodies" });
  }
});

router.get("/local-bodies/:id/electoral-areas", requireAuth, requireRole(roles), async function (req, res) {
  try {
    res.json(await listLocalBodyElectoralAreas(req.params.id, { limit: req.query.limit, offset: req.query.offset }));
  } catch (error) {
    console.error("Load local body electoral areas failed:", error);
    res.status(500).json({ error: "Unable to load local body electoral areas" });
  }
});

export default router;
