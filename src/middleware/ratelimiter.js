const db = require('../config/db');

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
    // 1. Validate API key
    const [keyRows] = await connection.query(
      `SELECT key_id FROM api_keys WHERE api_key = ? AND is_active = true`,
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
    const route = '/api' + req.path;
    const method = req.method;
    // Fetch user details and attach to request
const [userRows] = await connection.query(
  `SELECT u.name, u.email FROM users u 
   JOIN api_keys ak ON u.user_id = ak.user_id 
   WHERE ak.key_id = ?`,
  [apiKeyId]
);
req.user = userRows[0];

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
    const windowStart = new Date(Date.now() - window_seconds * 1000).toISOString().slice(0, 23).replace('T', ' ');

    // 4. Begin transaction — prevents race conditions
    await connection.beginTransaction();

    // 5. Lock rows with FOR UPDATE (pessimistic locking)
    await connection.query(
      `SELECT 1 FROM request_logs 
       WHERE api_key_id = ? AND endpoint_id = ?
       FOR UPDATE`,
      [apiKeyId, endpointId]
    );

   // 6. Delete old logs outside window
const [deleteResult] = await connection.query(
  `DELETE FROM request_logs 
   WHERE api_key_id = ? AND endpoint_id = ? 
   AND request_timestamp < TIMESTAMPADD(SECOND, ?, NOW(3))`,
  [apiKeyId, endpointId, -window_seconds]
);
console.log('Rows deleted:', deleteResult.affectedRows);

// 7. Count requests in current window
const [countRows] = await connection.query(
  `SELECT COUNT(*) as request_count FROM request_logs 
   WHERE api_key_id = ? AND endpoint_id = ?
   AND request_timestamp >= TIMESTAMPADD(SECOND, ?, NOW(3))`,
  [apiKeyId, endpointId, -window_seconds]
);
const requestCount = countRows[0].request_count;
console.log('Request Count:', requestCount);

    // 8. Check if limit exceeded
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
        window_seconds: window_seconds,
        retry_after: `${window_seconds} seconds`,
      });
    }

    // 9. Allow — log the request
    await connection.query(
      `INSERT INTO request_logs (api_key_id, endpoint_id) VALUES (?, ?)`,
      [apiKeyId, endpointId]
    );

    await connection.commit();
    connection.release();

    res.setHeader('X-RateLimit-Limit', max_requests);
    res.setHeader('X-RateLimit-Remaining', max_requests - requestCount - 1);
    res.setHeader('X-RateLimit-Window', window_seconds);

    next();

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Rate limiter error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error in rate limiter.',
    });
  }
};

module.exports = slidingWindowRateLimiter;