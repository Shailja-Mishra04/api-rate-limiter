const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/ratelimiter');

// Apply rate limiter to all routes
router.use(rateLimiter);

router.post('/login', (req, res) => {
  res.json({
    success: true,
    message: `Welcome back ${req.user.name}!`,
    user: req.user.name,
    email: req.user.email,
    token: 'mock-jwt-token-xyz',
  });
});

router.post('/transfer', (req, res) => {
  res.json({
    success: true,
    message: `Transfer initiated by ${req.user.name}`,
    amount: req.body.amount || 1000,
    from: 'ACC001',
    to: 'ACC002',
  });
});

router.get('/balance', (req, res) => {
  res.json({
    success: true,
    message: `Balance for ${req.user.name}`,
    balance: 50000,
    currency: 'INR',
  });
});

module.exports = router;