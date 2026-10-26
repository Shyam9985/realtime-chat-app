const { createClient } = require("redis");
const { logBlock } = require("../utils/log.utils");

let redisReady = false;

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
});

redisClient.on("error", (error) => {
    logBlock('[redis] error:', error);
});

redisClient.on("connect", () => {
    logBlock('[redis] connect:', "Redis client connecting...");
});

redisClient.on("ready", () => {
    logBlock('[redis] ready:', "Redis client ready");
    //set local flag to true when redis is ready
    redisReady = true;
});

redisClient.on("end", () => {
    logBlock('[redis] end:', "Redis client disconnected");
    //set local flag to false when redis is disconnected
    redisReady = false;
});

const connectRedis = async () => {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
};

const destroyRedis = async () => {
    logBlock('[redis] destroy:', "Destroying Redis client...");
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
};

const isRedisReady = () => redisReady;

module.exports = {
    redisClient,
    connectRedis,
    destroyRedis,
    isRedisReady
};