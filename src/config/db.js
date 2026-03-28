const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, '../../ca.pem')),
  },
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
});

// Test connection
pool.getConnection()
  .then(conn => {
    console.log('✅ Connected to Aiven MySQL successfully!');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

module.exports = pool;