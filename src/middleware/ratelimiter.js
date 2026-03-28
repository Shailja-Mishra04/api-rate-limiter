const db = require('../config/db');
const redis = require('../config/redis');

const isRedisAvailable = async () => {
  if (process.env.REDIS_ENABLED !== 'true') {
    console.log('⚠️ Redis disabled via config');
    return false;
  }
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
};

const slidingWindowRateLimiter = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key is required. Pass it as x-api-key header.',
    });
  }

  const connection = await db.getConnection();

  try {
    // 1. Validate API key and get user info
    const [keyRows] = await connection.query(
      `SELECT ak.key_id, u.name, u.email 
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.user_id
       WHERE ak.api_key = ? AND ak.is_active = true`,
      [apiKey]
    );

    if (keyRows.length === 0) {
      connection.release();
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive API key.',
      });
    }

    const apiKeyId = keyRows[0].key_id;
    req.user = { name: keyRows[0].name, email: keyRows[0].email };
    const route = '/api' + req.path;
    const method = req.method;

    // 2. Find endpoint
    const [endpointRows] = await connection.query(
      `SELECT endpoint_id FROM endpoints WHERE route = ? AND method = ?`,
      [route, method]
    );

    if (endpointRows.length === 0) {
      connection.release();
      return next();
    }

    const endpointId = endpointRows[0].endpoint_id;

    // 3. Get rate limit rule
    const [ruleRows] = await connection.query(
      `SELECT max_requests, window_seconds FROM rate_limit_rules WHERE endpoint_id = ?`,
      [endpointId]
    );

    if (ruleRows.length === 0) {
      connection.release();
      return next();
    }

    const { max_requests, window_seconds } = ruleRows[0];
    const redisKey = `rl:${apiKeyId}:${endpointId}`;
    const redisAvailable = await isRedisAvailable();

    // 4. Redis fast path — frequent users
    if (redisAvailable) {
      const cachedCount = await redis.get(redisKey);

      if (cachedCount !== null) {
        console.log(`⚡ Redis cache hit for key ${redisKey} — count: ${cachedCount}`);
        const count = parseInt(cachedCount);

        if (count >= max_requests) {
          await connection.query(
            `INSERT INTO rate_limit_violations (api_key_id, endpoint_id) VALUES (?, ?)`,
            [apiKeyId, endpointId]
          );
          connection.release();

          return res.status(429).json({
            success: false,
            message: 'Too many requests. Rate limit exceeded.',
            limit: max_requests,
            used: count,
            remaining: 0,
            window_seconds: window_seconds,
            retry_after: `${await redis.ttl(redisKey)} seconds`,
            served_by: 'redis'
          });
        }

        await redis.incr(redisKey);

        // Log with served_by redis
        await connection.query(
          `INSERT INTO request_logs (api_key_id, endpoint_id, served_by) VALUES (?, ?, 'redis')`,
          [apiKeyId, endpointId]
        );
        connection.release();

        res.setHeader('X-RateLimit-Limit', max_requests);
        res.setHeader('X-RateLimit-Remaining', max_requests - count - 1);
        res.setHeader('X-RateLimit-Window', window_seconds);
        res.setHeader('X-Served-By', 'redis');

        return next();
      }

      console.log(`🐢 Redis miss — going to MySQL for key ${redisKey}`);
    } else {
      console.log(`⚠️ Redis disabled/unavailable — using MySQL`);
    }

    // 5. MySQL sliding window path
    console.log(`🐢 MySQL handling request for key ${redisKey}`);

    await connection.beginTransaction();

    // Delete expired logs outside window
    await connection.query(
      `DELETE FROM request_logs 
       WHERE api_key_id = ? AND endpoint_id = ? 
       AND request_timestamp < TIMESTAMPADD(SECOND, ?, NOW(3))`,
      [apiKeyId, endpointId, -window_seconds]
    );

    // Count current window
    const [countRows] = await connection.query(
      `SELECT COUNT(*) as request_count FROM request_logs 
       WHERE api_key_id = ? AND endpoint_id = ?
       AND request_timestamp >= TIMESTAMPADD(SECOND, ?, NOW(3))`,
      [apiKeyId, endpointId, -window_seconds]
    );

    const requestCount = countRows[0].request_count;

    // Check limit
    if (requestCount >= max_requests) {
      await connection.query(
        `INSERT INTO rate_limit_violations (api_key_id, endpoint_id) VALUES (?, ?)`,
        [apiKeyId, endpointId]
      );
      await connection.commit();
      connection.release();

      return res.status(429).json({
        success: false,
        message: 'Too many requests. Rate limit exceeded.',
        limit: max_requests,
        used: requestCount,
        remaining: 0,
        window_seconds: window_seconds,
        retry_after: `${window_seconds} seconds`,
        served_by: 'mysql'
      });
    }

    // Allow — log request with served_by mysql
    await connection.query(
      `INSERT INTO request_logs (api_key_id, endpoint_id, served_by) VALUES (?, ?, 'mysql')`,
      [apiKeyId, endpointId]
    );

    await connection.commit();
    connection.release();

    const newCount = requestCount + 1;

    // Cache in Redis if available
    if (redisAvailable) {
      await redis.set(redisKey, newCount, 'EX', window_seconds);
      console.log(`💾 Cached in Redis — key: ${redisKey}, count: ${newCount}, TTL: ${window_seconds}s`);
    }

    res.setHeader('X-RateLimit-Limit', max_requests);
    res.setHeader('X-RateLimit-Remaining', max_requests - newCount);
    res.setHeader('X-RateLimit-Window', window_seconds);
    res.setHeader('X-Served-By', 'mysql');

    return next();

  } catch (err) {
    await connection.rollback();
    connection.release();

    if (err.code === 'ER_LOCK_DEADLOCK') {
      console.log('Deadlock detected — returning 503');
      return res.status(503).json({
        success: false,
        message: 'Server busy due to concurrent requests. Please retry.',
        error: 'DEADLOCK'
      });
    }

    console.error('Rate limiter error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error in rate limiter.',
    });
  }
};

module.exports = slidingWindowRateLimiter;