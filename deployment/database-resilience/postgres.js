import pg from "pg";

import { config } from "../config/config.js";
import { getDatabaseSecret } from "../config/secrets.js";
import { createResilientDatabase } from "./resilient-database.js";

const { Pool } = pg;

const database = createResilientDatabase({
  loadCredentials: getDatabaseSecret,

  createPool(secret) {
    const pool = new Pool({
      host:
        secret.host ||
        "voice-analytics-db.c16geiggocim.ap-south-1.rds.amazonaws.com",

      port: Number(secret.port || 5432),
      database: config.database.name,
      user: secret.username,
      password: secret.password,

      ssl: {
        rejectUnauthorized: false
      },

      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    pool.on("error", function (error) {
      console.error("Unexpected idle database connection error", {
        code: error?.code || null
      });
    });

    return pool;
  }
});

export async function getDb() {
  return database.ready();
}
