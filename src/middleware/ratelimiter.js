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

    // 4. Redis ON — atomic decision, MySQL for audit only
    // Redis INCR is atomic — no race condition, no deadlock, exactly N requests always
    if (redisAvailable) {
      console.log(`⚡ Redis handling request for key ${redisKey}`);

      const count = await redis.incr(redisKey);

      // Set TTL only on first request of the window
      if (count === 1) {
        await redis.expire(redisKey, window_seconds);
        console.log(`⏱️ TTL set for key ${redisKey} — ${window_seconds}s`);
      }

      if (count > max_requests) {
        // Fire and forget — violation log to MySQL
        connection.query(
          `INSERT INTO rate_limit_violations (api_key_id, endpoint_id) VALUES (?, ?)`,
          [apiKeyId, endpointId]
        ).catch(err => console.error('Violation log error:', err.message));
        connection.release();

        const ttl = await redis.ttl(redisKey);
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Rate limit exceeded.',
          limit: max_requests,
          used: count,
          remaining: 0,
          window_seconds: window_seconds,
          retry_after: `${ttl} seconds`,
          served_by: 'redis'
        });
      }

      // Fire and forget — request log to MySQL
      connection.query(
        `INSERT INTO request_logs (api_key_id, endpoint_id, served_by) VALUES (?, ?, 'redis')`,
        [apiKeyId, endpointId]
      ).catch(err => console.error('Request log error:', err.message));
      connection.release();

      res.setHeader('X-RateLimit-Limit', max_requests);
      res.setHeader('X-RateLimit-Remaining', max_requests - count);
      res.setHeader('X-RateLimit-Window', window_seconds);
      res.setHeader('X-Served-By', 'redis');

      return next();
    }

    // 5. Redis OFF — full MySQL sliding window with strict locking
    // SELECT FOR UPDATE ensures no race condition
    // Under high concurrency this may cause deadlocks — demonstrating MySQL's limitation
    console.log(`🐢 MySQL handling request for key ${redisKey}`);

    await connection.beginTransaction();

    // Pessimistic lock — prevents race condition, may cause deadlock under load
    await connection.query(
      `SELECT 1 FROM request_logs
       WHERE api_key_id = ? AND endpoint_id = ?
       FOR UPDATE`,
      [apiKeyId, endpointId]
    );

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

    // Allow — log request
    await connection.query(
      `INSERT INTO request_logs (api_key_id, endpoint_id, served_by) VALUES (?, ?, 'mysql')`,
      [apiKeyId, endpointId]
    );

    await connection.commit();
    connection.release();

    const newCount = requestCount + 1;

    res.setHeader('X-RateLimit-Limit', max_requests);
    res.setHeader('X-RateLimit-Remaining', max_requests - newCount);
    res.setHeader('X-RateLimit-Window', window_seconds);
    res.setHeader('X-Served-By', 'mysql');

    return next();

  } catch (err) {
    await connection.rollback();
    connection.release();

    // Deadlock — proof of MySQL limitation under high concurrency
    if (err.code === 'ER_LOCK_DEADLOCK') {
      console.log('💥 Deadlock detected — transaction rolled back');
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