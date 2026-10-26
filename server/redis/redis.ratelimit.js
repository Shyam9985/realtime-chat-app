const { redisClient } = require("./redis.client");

const RATE_LIMIT_TTL = 30 * 60; // 30 minutes

const tokenBucketScript = `
local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call("GET", key)

local currentTokens
local lastRefillTimestamp

if not data then

    currentTokens = capacity - 1
    lastRefillTimestamp = now

else

    local bucket = cjson.decode(data)

    currentTokens = tonumber(bucket.currentTokens)
    lastRefillTimestamp = tonumber(bucket.lastRefillTimestamp)

    local elapsedMs = now - lastRefillTimestamp

    currentTokens = math.min(
        capacity,
        currentTokens + (elapsedMs / 1000) * refillRate
    )

    if currentTokens >= 1 then

        currentTokens = currentTokens - 1
        lastRefillTimestamp = now

    else

        local waitSeconds = math.ceil((1 - currentTokens) / refillRate)
        return {0, tostring(currentTokens), tostring(waitSeconds)}

    end

end

local bucket = cjson.encode({
    currentTokens = currentTokens,
    lastRefillTimestamp = lastRefillTimestamp
})

redis.call("SET", key, bucket, "EX", ttl)

return {1, tostring(currentTokens), "0"}
`;

async function checkRedisRateLimit({
    key,
    refillRate,
    capacity
}) {
    if (!redisClient.isReady) {
        throw new Error("Redis is not ready");
    }

    const now = Date.now();

    const result = await redisClient.eval(tokenBucketScript, {
        keys: [key],
        arguments: [
            String(capacity),
            String(refillRate),
            String(now),
            String(RATE_LIMIT_TTL)
        ]
    });

    const allowed = Number(result[0]) === 1;

    return {
        key,
        status: allowed ? "ALLOWED" : "LIMITED",
        remainingTokens: Number(result[1]),
        retryAfter: Number(result[2])
    };
}

module.exports = {
    checkRedisRateLimit
};