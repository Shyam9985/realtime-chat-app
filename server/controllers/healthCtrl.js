const dbConfig = require('../config/db.config');
const { isRedisReady } = require('../redis/redis.client');

// GET /health - liveness plus a real database round trip. 503 when the database is unreachable
// so a load balancer can take the instance out; redis is informational (the limiter has a fallback)
exports.check = async (req, res) => {
    const body = { status: 'ok', uptime_seconds: Math.round(process.uptime()), database: 'up', redis: isRedisReady() ? 'up' : 'down', timestamp: new Date().toISOString() };
    try {
        await dbConfig.pool.query('select 1');
    } catch (error) {
        body.status = 'degraded';
        body.database = 'down';
        return res.status(503).json(body);
    }
    return res.status(200).json(body);
};
