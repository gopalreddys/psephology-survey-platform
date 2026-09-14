import assert from "node:assert/strict";

import {
  createResilientDatabase,
  isDatabaseAuthenticationFailure
} from "./resilient-database.js";

function authenticationError() {
  const error = new Error("password authentication failed for user");
  error.code = "28P01";
  return error;
}

class FakePool {
  constructor({ rejectAuthentication = false, queryValue = null } = {}) {
    this.rejectAuthentication = rejectAuthentication;
    this.queryValue = queryValue;
    this.ended = 0;
  }

  async query() {
    if (this.rejectAuthentication) throw authenticationError();
    return { rows: [{ value: this.queryValue }] };
  }

  async connect() {
    if (this.rejectAuthentication) throw authenticationError();
    return { release() {} };
  }

  async end() {
    this.ended += 1;
  }
}

assert.equal(isDatabaseAuthenticationFailure(authenticationError()), true);
assert.equal(isDatabaseAuthenticationFailure(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), false);

const stalePool = new FakePool({ rejectAuthentication: true });
const refreshedPool = new FakePool({ queryValue: "refreshed" });
const pools = [stalePool, refreshedPool];
let credentialLoads = 0;
const warnings = [];

const database = createResilientDatabase({
  async loadCredentials() {
    credentialLoads += 1;
    return { generation: credentialLoads };
  },
  createPool() {
    return pools.shift();
  },
  logger: {
    warn(message, details) {
      warnings.push({ message, details });
    },
    error() {}
  },
  retireDelayMs: 0
});

await database.ready();
const results = await Promise.all([
  database.query("SELECT 1"),
  database.query("SELECT 1")
]);
assert.deepEqual(
  results.map(function (result) { return result.rows[0].value; }),
  ["refreshed", "refreshed"]
);
assert.equal(credentialLoads, 2);
assert.equal(warnings.length, 2);
assert.equal(warnings[0].details.code, "28P01");
assert.equal(stalePool.ended, 1);
assert.equal(typeof (await database.connect()).release, "function");

const normalError = Object.assign(new Error("query failed"), { code: "42601" });
let nonAuthenticationAttempts = 0;
const nonAuthenticationDatabase = createResilientDatabase({
  async loadCredentials() {
    return {};
  },
  createPool() {
    return {
      async query() {
        nonAuthenticationAttempts += 1;
        throw normalError;
      },
      async end() {}
    };
  },
  logger: { warn() {}, error() {} }
});

await assert.rejects(
  nonAuthenticationDatabase.query("INVALID"),
  function (error) {
    return error === normalError;
  }
);
assert.equal(nonAuthenticationAttempts, 1);

await database.end();
await nonAuthenticationDatabase.end();

console.log("Database credential resilience tests passed.");
