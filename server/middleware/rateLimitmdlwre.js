const datefns = require("date-fns");
const { sendErrorResponse } = require("../utils/response.utils");
const RESPONSE_STATUS = require("../utils/standard.messages");
const { log, logBlock } = require("../utils/log.utils");
const { checkRedisRateLimit } = require("../redis/redis.ratelimit");

//rate limit map
const rateLimitMap = new Map();
// rate limie object structure token bucket
// {capacity : 0 ,currentTokens : 0 , refillRate : 0 , lastRefillTimestamp : 0}

// generate request key for rate limiting with the combination of user + method + route
function generateReteLimitKey(user, req) {
  const method = req.method;
  const ip = req.ip;
  const url = req.route?.path ? req?.baseUrl + req?.route?.path : req.originalUrl || req.url;
  // console.log("generateReteLimitKey", user, ip, method, url);

  const primary = user?.user_id > 0 ? user?.user_id : ip;
  return primary + ":" + method + ":" + url;
}
// rate limit check middleware
const checkRateLimit = (refillRate, capacity) => async (req, res, next) => {
  // RATE_LIMIT_BYPASS=true is for automated test runs only; never set it on a real deployment
  if (process.env.RATE_LIMIT_BYPASS === 'true') return next();

  logBlock('[rateLimit] checkRateLimit:', `refillRate: ${refillRate}, capacity: ${capacity}`);
  // generate the key for the current request based on user, method and route
  const key = generateReteLimitKey(req.user, req);
  const now = datefns.getTime(new Date());

  // REDIS - PRIMARY
    try {
      const redisResult = await checkRedisRateLimit({key : 'rate_limmit:'+ key, refillRate: refillRate, capacity: capacity});

      log("Redis rate limiter result:", redisResult);

      if(redisResult?.status === "LIMITED") {
          return sendErrorResponse(req, res, 
            `Too many requests. Please try again after ${datefns.formatDuration(datefns.intervalToDuration({start: 0, end: redisResult.retryAfter * 1000,}))}`, 
            RESPONSE_STATUS.TOOMANY_REQUESTS, { function: "checkRateLimit" });
      }

      return next();
    } catch (error) {
      log("Redis rate limiter unavailable, using the in-memory bucket:", error?.message || error);

      // Redis failed during this request.
      // Continue to Node.js in-memory fallback.
    }

  // NODE.JS MEMORY - FALLBACK

  if (!rateLimitMap.has(key)) {
    const body = {
      currentTokens: capacity - 1,
      capacity,
      refillRate,
      lastRefillTimestamp: now,
    };

    log("Node.js in-memory rate limiter: creating new bucket for key:", key, body);
    rateLimitMap.set(key, body);

    return next();
  }

  const rateLimitData = rateLimitMap.get(key);

    // calculate the time elapsed since the last refill.
  const elapsedMs = datefns.differenceInMilliseconds(now, rateLimitData.lastRefillTimestamp);

    // refill the tokens based on the elapsed time and refill rate.
  rateLimitData.currentTokens = Math.min(rateLimitData.capacity, rateLimitData.currentTokens + (elapsedMs / 1000) * rateLimitData.refillRate);

    // update the last refill timestamp
  rateLimitData.lastRefillTimestamp = now;

  log("Node.js in-memory rate limiter: existing bucket for key:", key, rateLimitData);

  if (rateLimitData.currentTokens >= 1) {
    rateLimitData.currentTokens--;
      // update the count of the key in the map
    rateLimitMap.set(key, rateLimitData);

    return next();
  }

  const waitSeconds = Math.ceil((1 - rateLimitData.currentTokens) /  rateLimitData.refillRate);

  const waitText = datefns.formatDuration(datefns.intervalToDuration({start: 0, end: waitSeconds * 1000,})
  );

  res.setHeader("Retry-After", waitSeconds);

  log("Node.js in-memory rate limiter: sending rate limit error for key:", key, waitText);
  return sendErrorResponse(req, res, `Too many requests. Please try again in ${waitText}.`, 
    RESPONSE_STATUS.TOOMANY_REQUESTS, { function: "checkRateLimit" });
};

// delete the rate limit keys that are older than one hour to prevent memory leak
setInterval(() => {
  const now = datefns.getTime(new Date());
  for (const [key, rateLimitData] of rateLimitMap.entries()) {
    const elapsedSeconds = datefns.differenceInMinutes(
      now,
      rateLimitData.lastRefillTimestamp,
    );
    if (elapsedSeconds > 60) {
      rateLimitMap.delete(key);
    }
  }
}, 3600000).unref(); // run every hour; unref so the timer never keeps a shutting-down process alive

exports.checkRateLimit = checkRateLimit;
