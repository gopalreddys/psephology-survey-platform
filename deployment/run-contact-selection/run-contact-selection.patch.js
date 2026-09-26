const MARKER = "RUN_CONTACT_SELECTION_V1";

function replaceExactly(source, pattern, replacement, expected, description) {
  let count = 0;
  const updated = source.replace(pattern, function (...args) {
    count += 1;
    return typeof replacement === "function"
      ? replacement(...args)
      : replacement;
  });

  if (count !== expected) {
    throw new Error(
      `Expected ${expected} ${description} anchor${expected === 1 ? "" : "s"}; found ${count}`
    );
  }

  return updated;
}

function routeBlockBounds(source) {
  const start = source.indexOf('router.post(\n  "/runs/:runId/launch"');
  if (start < 0) {
    throw new Error("Unable to find the Run launch route");
  }

  const nextRoute = source.indexOf("\n\n\nrouter.", start + 1);
  return {
    start,
    end: nextRoute < 0 ? source.length : nextRoute
  };
}

export function patchRunLaunchRoute(source) {
  if (source.includes(MARKER)) {
    return source;
  }

  const bounds = routeBlockBounds(source);
  let block = source.slice(bounds.start, bounds.end);

  block = replaceExactly(
    block,
    /\s+const requestedLimit\s*=\s*Number\(\s*req\.body\?\.limit\s*\|\|\s*1\s*\);/,
    `
      /* ${MARKER}: launch only the contacts explicitly selected in the preview. */
      const suppliedContactIds = req.body?.runContactIds;

      if (
        suppliedContactIds !== undefined &&
        !Array.isArray(suppliedContactIds)
      ) {
        return res.status(400).json({
          error: "runContactIds must be an array"
        });
      }

      const requestedContactIds = Array.from(
        new Set(
          (suppliedContactIds || [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )
      );

      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (
        requestedContactIds.length > 50 ||
        requestedContactIds.some((id) => !uuidPattern.test(id))
      ) {
        return res.status(400).json({
          error: "Select between 1 and 50 valid Run contacts"
        });
      }

      const requestedLimit =
        requestedContactIds.length ||
        Number(req.body?.limit || 1);`,
    1,
    "requested limit"
  );

  block = replaceExactly(
    block,
    /(launchRun\(\{[\s\S]*?runId\s*:\s*req\.params\.runId\s*,[\s\S]*?limit\s*:\s*requestedLimit)(\s*\}\))/,
    function (_match, launchArguments, closeCall) {
      return `${launchArguments},\n          runContactIds: requestedContactIds${closeCall}`;
    },
    1,
    "launchRun invocation"
  );

  return source.slice(0, bounds.start) + block + source.slice(bounds.end);
}

export function patchRunLaunchService(source) {
  if (source.includes(MARKER)) {
    return source;
  }

  let updated = replaceExactly(
    source,
    /export async function launchRun\(\{\s*runId\s*,\s*limit\s*=\s*1\s*\}\)/,
    `export async function launchRun({
  runId,
  limit = 1,
  runContactIds = []
})`,
    1,
    "launchRun signature"
  );

  updated = replaceExactly(
    updated,
    /\s+const safeLimit\s*=\s*Math\.max\(\s*1\s*,\s*Math\.min\(\s*Number\(limit\)\s*\|\|\s*1\s*,\s*50\s*\)\s*\);/,
    `
  /* ${MARKER}: preserve the reviewed contact allow-list through submission. */
  const selectedContactIds = Array.from(
    new Set(
      (Array.isArray(runContactIds) ? runContactIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  if (selectedContactIds.length > 50) {
    const error = new Error("A maximum of 50 contacts can be launched at once");
    error.statusCode = 400;
    throw error;
  }

  const safeLimit = selectedContactIds.length ||
    Math.max(1, Math.min(Number(limit) || 1, 50));
  const selectedContactFilter = selectedContactIds.length
    ? selectedContactIds
    : null;`,
    1,
    "safe launch limit"
  );

  let contactQueryIndex = 0;
  updated = replaceExactly(
    updated,
    /(\s+rc\.run_id\s*=\s*\$1)/g,
    function (match) {
      contactQueryIndex += 1;
      const parameterIndex = contactQueryIndex === 1 ? 2 : 3;
      return `${match}\n\n          AND ($${parameterIndex}::uuid[] IS NULL OR rc.id = ANY($${parameterIndex}::uuid[]))`;
    },
    2,
    "Run contact query"
  );

  updated = replaceExactly(
    updated,
    /LIMIT\s+\$3/,
    "LIMIT $4",
    1,
    "retry Run contact limit"
  );

  updated = replaceExactly(
    updated,
    /LIMIT\s+\$2/,
    "LIMIT $3",
    1,
    "initial Run contact limit"
  );

  updated = replaceExactly(
    updated,
    /\[\s*runId\s*,\s*safeLimit\s*\]/,
    "[runId, selectedContactFilter, safeLimit]",
    1,
    "initial Run contact query parameter"
  );

  updated = replaceExactly(
    updated,
    /\[\s*runId\s*,\s*Number\(\s*cycle\.max_attempts_per_voter\s*\)\s*,\s*safeLimit\s*\]/,
    `[runId, Number(cycle.max_attempts_per_voter), selectedContactFilter, safeLimit]`,
    1,
    "retry Run contact query parameter"
  );

  updated = replaceExactly(
    updated,
    /(\s+const contacts\s*=\s*contactsResult\.rows\s*;)/,
    `
  if (
    selectedContactIds.length > 0 &&
    contactsResult.rows.length !== selectedContactIds.length
  ) {
    const error = new Error(
      "One or more selected voters are no longer eligible. Refresh the preview and select again."
    );
    error.statusCode = 409;
    throw error;
  }
$1`,
    1,
    "selected contact validation"
  );

  return updated;
}

export { MARKER };
