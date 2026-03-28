const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/ratelimiter');
const crypto = require('crypto');
const db = require('../config/db');
const redis = require('../config/redis');

// IP based rate limiter for register endpoint
const registerAttempts = new Map();

const ipRateLimiter = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxAttempts = 5;

  if (!registerAttempts.has(ip)) {
    registerAttempts.set(ip, []);
  }

  const attempts = registerAttempts.get(ip);
  const recentAttempts = attempts.filter(time => now - time < windowMs);

  if (recentAttempts.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message: 'Too many registration attempts. Try again in 60 seconds.',
    });
  }

  recentAttempts.push(now);
  registerAttempts.set(ip, recentAttempts);
  next();
};

// ✅ Register — BEFORE rate limiter, protected by IP limiter
router.post('/register', ipRateLimiter, async (req, res) => {
  const { name, email } = req.body;
  try {
    const [userResult] = await db.query(
      `INSERT INTO users (name, email) VALUES (?, ?)`,
      [name, email]
    );
    const userId = userResult.insertId;
    const apiKey = crypto.randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO api_keys (user_id, api_key) VALUES (?, ?)`,
      [userId, apiKey]
    );
    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      api_key: apiKey,
      warning: 'Save this key — it will not be shown again!'
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Email already registered!'
      });
    }
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ✅ Dashboard — no API key needed
router.get('/dashboard', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../../dashboard.html'));
});

// ✅ Status — no API key needed, no sensitive data exposed
router.get('/status', async (req, res) => {
  try {
    const [summary] = await db.query(`SELECT * FROM active_request_summary`);

    const [violations] = await db.query(
      `SELECT u.name, e.route, COUNT(*) as total_violations
       FROM rate_limit_violations rlv
       JOIN api_keys ak ON rlv.api_key_id = ak.key_id
       JOIN users u ON ak.user_id = u.user_id
       JOIN endpoints e ON rlv.endpoint_id = e.endpoint_id
       GROUP BY u.name, e.route
       ORDER BY total_violations DESC`
    );

    // Now includes served_by column
    const [recentLogs] = await db.query(
      `SELECT u.name, e.route, e.method, rl.served_by, rl.request_timestamp
       FROM request_logs rl
       JOIN api_keys ak ON rl.api_key_id = ak.key_id
       JOIN users u ON ak.user_id = u.user_id
       JOIN endpoints e ON rl.endpoint_id = e.endpoint_id
       ORDER BY rl.request_timestamp DESC
       LIMIT 20`
    );
    const [dbStats] = await db.query(
  `SELECT 
    (SELECT COUNT(*) FROM request_logs) as total_logs,
    (SELECT COUNT(*) FROM rate_limit_violations) as total_violations,
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM api_keys WHERE is_active = true) as active_keys,
    (SELECT COUNT(*) FROM endpoints) as total_endpoints`
);

    const redisEnabled = process.env.REDIS_ENABLED === 'true';
    let redisKeys = [];

    if (redisEnabled) {
      try {
        const keys = await redis.keys('rl:*');
        redisKeys = await Promise.all(keys.map(async (key) => ({
          key,
          count: await redis.get(key),
          ttl: await redis.ttl(key)
        })));
      } catch {
        redisKeys = [];
      }
    }

    res.json({
      success: true,
      redis_enabled: redisEnabled,
      active_requests: summary,
      violations: violations,
      recent_logs: recentLogs,
      redis_keys: redisKeys,
      db_stats: dbStats[0]
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ Rate limiter applies to everything below
router.use(rateLimiter);

// Mock login endpoint
router.post('/login', (req, res) => {
  res.json({
    success: true,
    message: `Welcome back ${req.user.name}!`,
    user: req.user.name,
    email: req.user.email,
    token: 'mock-jwt-token-xyz',
  });
});

// Mock transfer endpoint
router.post('/transfer', (req, res) => {
  res.json({
    success: true,
    message: `Transfer initiated by ${req.user.name}`,
    amount: req.body.amount || 1000,
    from: 'ACC001',
    to: 'ACC002',
  });
});

// Mock balance endpoint
router.get('/balance', (req, res) => {
  res.json({
    success: true,
    message: `Balance for ${req.user.name}`,
    balance: 50000,
    currency: 'INR',
  });
});

module.exports = router;