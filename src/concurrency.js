async function mapPool(items, concurrency, worker, options = {}) {
  if (!items.length) return [];
  const limit = Math.max(1, concurrency || 1);
  const results = new Array(items.length);
  let nextIndex = 0;
  const isAborted = typeof options.isAborted === 'function'
    ? options.isAborted
    : () => !!(options.signal && options.signal.aborted);

  async function runWorker() {
    while (nextIndex < items.length) {
      if (isAborted()) {
        const err = new Error('cancelled');
        err.code = 'CANCELLED';
        throw err;
      }
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}

module.exports = { mapPool };
