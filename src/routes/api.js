const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/ratelimiter');

// Apply rate limiter to all routes
router.use(rateLimiter);

// Mock login endpoint
router.post('/login', (req, res) => {
  res.json({
    success: true,
    message: 'Login successful!',
    user: 'Shailja',
    token: 'mock-jwt-token-xyz',
  });
});

// Mock transfer endpoint
router.post('/transfer', (req, res) => {
  res.json({
    success: true,
    message: 'Transfer successful!',
    amount: req.body.amount || 1000,
    from: 'ACC001',
    to: 'ACC002',
  });
});

// Mock balance endpoint
router.get('/balance', (req, res) => {
  res.json({
    success: true,
    message: 'Balance fetched!',
    balance: 50000,
    currency: 'INR',
  });
});

module.exports = router;