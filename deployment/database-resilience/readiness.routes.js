import express from "express";

import { getDb } from "../db/postgres.js";

const router = express.Router();

router.get("/ready", async function (req, res) {
  res.set("Cache-Control", "no-store");

  try {
    const db = await getDb();
    await db.query("SELECT 1 AS ready");

    return res.status(200).json({
      status: "ready",
      service: "psephology-api",
      database: "reachable"
    });
  } catch (error) {
    console.error("Database readiness check failed", {
      code: error?.code || null
    });

    return res.status(503).json({
      status: "not_ready",
      service: "psephology-api",
      database: "unreachable"
    });
  }
});

export default router;
