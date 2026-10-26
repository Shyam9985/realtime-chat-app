/*
 * A small in-memory token bucket per user for socket events. The http limiter needs a request
 * object, so it cannot be reused here; the maths is the same. Buckets idle for an hour are dropped.
 */
const buckets = new Map();

const take = (key, capacity, refillPerSecond) => {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { tokens: capacity, updatedAt: now };
        buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) / 1000) * refillPerSecond);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
};

setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, bucket] of buckets) if (bucket.updatedAt < cutoff) buckets.delete(key);
}, 60 * 60 * 1000).unref();

module.exports = { take };
