const Redis = require('ioredis');
require('dotenv').config();

const redis = new Redis(process.env.REDIS_URL, {
  


  retryStrategy: (times) => {
    if (times > 3) return null;
    return Math.min(times * 200, 1000);
  }
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis Cloud successfully!');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

module.exports = redis;