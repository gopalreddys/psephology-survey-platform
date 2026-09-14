export function isDatabaseAuthenticationFailure(error) {
  return error?.code === "28P01" ||
    /password authentication failed/i.test(String(error?.message || ""));
}

export function createResilientDatabase({
  createPool,
  loadCredentials,
  logger = console,
  retireDelayMs = 30000
}) {
  let activePool = null;
  let refreshPromise = null;

  async function replacePool(failedPool = null) {
    if (failedPool && activePool && activePool !== failedPool) {
      return activePool;
    }

    if (refreshPromise) return refreshPromise;

    refreshPromise = (async function () {
      if (failedPool && activePool && activePool !== failedPool) {
        return activePool;
      }

      const credentials = await loadCredentials();
      const nextPool = createPool(credentials);
      const previousPool = activePool;
      activePool = nextPool;

      if (previousPool && previousPool !== nextPool) {
        const retire = function () {
          Promise.resolve(previousPool.end()).catch(function (error) {
            logger.error("Unable to retire stale database pool", {
              code: error?.code || null
            });
          });
        };

        if (retireDelayMs > 0) {
          const timer = setTimeout(retire, retireDelayMs);
          timer.unref?.();
        } else {
          retire();
        }
      }

      return nextPool;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function getActivePool() {
    return activePool || replacePool();
  }

  async function execute(method, args) {
    const selectedPool = await getActivePool();

    try {
      return await selectedPool[method](...args);
    } catch (error) {
      if (!isDatabaseAuthenticationFailure(error)) throw error;

      logger.warn("Database credentials rejected; refreshing managed secret", {
        code: error?.code || "28P01"
      });

      const refreshedPool = await replacePool(selectedPool);
      return refreshedPool[method](...args);
    }
  }

  return {
    async ready() {
      await getActivePool();
      return this;
    },

    query(...args) {
      return execute("query", args);
    },

    connect(...args) {
      return execute("connect", args);
    },

    async end() {
      const endingPool = activePool;
      activePool = null;
      if (endingPool) await endingPool.end();
    }
  };
}
