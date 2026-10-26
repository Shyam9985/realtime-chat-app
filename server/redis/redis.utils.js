const { redisClient } = require("./redis.client");

// set a key in Redis with optional expiration time
async function setKey(key, value, options = {}) {
    const data =
        typeof value === "string"
            ? value
            : JSON.stringify(value);

    return await redisClient.set(key, data, options);
}

//
async function getOrSetKey(key, value, options = {}) {
    const result = await redisClient.set(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
        options
    );

    // Key already exists
    if (result === null) {
        const existingValue = await redisClient.get(key);

        try {
            return JSON.parse(existingValue);
        } catch {
            return existingValue;
        }
    }

    // Key was created
    return value;
}

// set expire time for a key in Redis
async function setExpireTime(key, expirationInSeconds) {
  await redisClient.expire(key, expirationInSeconds);
}

// get the values of the key
async function getValue(key) {
  const value = await redisClient.get(key);
  return value ? typeof value === 'object' ? JSON.parse(value) : value : null;
}

// get the ttl in seconds for a key in Redis
async function getKeyTTL(key) {
  const ttl = await redisClient.ttl(key);
  return ttl;
}

// get a key from Redis and parse its value as JSON
async function getKeyAndParse(key) {
  const value = await redisClient.get(key);
  return value ? JSON.parse(value) : null;
}

// check if a key exists in Redis
async function checkIfKeyExists(key) {
  const exists = await redisClient.exists(key);
  return exists === 1;
}

// delete a key from Redis
async function deleteKey(key) {
  await redisClient.del(key);
}

// delete all key from Redis
async function deleteAllKeys() {
  await redisClient.flushDb();
}

module.exports = {
  setKey,
  getValue,
  getOrSetKey,
  setExpireTime,
  getKeyTTL,
  getKeyAndParse,
  checkIfKeyExists,
  deleteKey,
  deleteAllKeys,
};
