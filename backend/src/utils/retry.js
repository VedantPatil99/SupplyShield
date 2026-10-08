const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff (capped at 5 s), ~30 attempts by default — databases start slowly. */
async function withRetry(label, fn, { attempts = 30, baseMs = 250, maxMs = 5000, log = console } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = Math.min(maxMs, baseMs * 2 ** (i - 1));
      log.warn(`[${label}] attempt ${i}/${attempts} failed: ${err.message}. Retrying in ${wait} ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

module.exports = { withRetry, sleep };
