import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repository = await readFile(
  path.resolve(packageRoot, "../campaign-workspace/campaign-iterations.repository.js"),
  "utf8"
);

assert.match(repository, /FROM campaign_iteration_links link/);
assert.match(repository, /permitted\.iteration_id = link\.iteration_id OR permitted\.iteration_id IS NULL/);
assert.match(repository, /permitted\.campaigner_user_id = \$\$\{parameterNumber\}/);
assert.match(repository, /campaignReviewVisibilitySql\(actor, "campaign", parameterNumber\)/);
assert.match(repository, /WHERE link\.campaign_id = \$1 AND \$\{visibility\.sql\}/);

console.log("Campaign Iteration visibility checks passed.");
