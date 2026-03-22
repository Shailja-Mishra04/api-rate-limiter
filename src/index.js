const express = require('express');
require('dotenv').config();
const db = require('./config/db');
const apiRoutes = require('./routes/api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ message: 'API Rate Limiter is running!' });
});

// Mount routes
app.use('/api', apiRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});