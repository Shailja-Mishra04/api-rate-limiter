# API Rate Limiter

A backend project built with Node.js, Express, and MySQL (hosted on Aiven) that implements a Sliding Window Log algorithm to rate limit API requests. This was built as a database assignment to explore advanced MySQL concepts like transactions, pessimistic locking, and time-series data management — going beyond the usual CRUD-based projects.

---

## Why this project

Most rate limiters you see in production use Redis because it is fast and has native TTL support. But building one on MySQL forced me to actually understand what makes rate limiting hard — concurrency, race conditions, atomic operations, and efficient querying under load. The friction of doing it the hard way made the learning stick.

---

## How it works

Every incoming API request goes through a middleware that does the following:

1. Checks for an `x-api-key` header and validates it against the database
2. Looks up the requested endpoint and fetches its rate limit rule (max requests allowed within a time window)
3. Opens a MySQL transaction and acquires a row-level lock using `SELECT FOR UPDATE` to prevent race conditions
4. Deletes all request logs for that API key and endpoint that fall outside the current time window
5. Counts the remaining logs (these are all requests made within the window)
6. If the count is at or above the limit, it logs a violation and returns a `429 Too Many Requests` response
7. If the count is under the limit, it logs the request and allows it through

This is the Sliding Window Log algorithm. The window "slides" with time — it always looks back exactly N seconds from the current moment, not from some fixed reset point like a fixed window counter would.

---

## Tech Stack

- **Node.js + Express** — API server and middleware
- **MySQL** — primary data store, hosted on Aiven (cloud)
- **mysql2** — MySQL driver for Node.js with promise support
- **dotenv** — environment variable management
- **nodemon** — auto-restart during development

---

## Database Schema

Six tables, each serving a clear purpose:

**users** — stores registered users who consume the API

**api_keys** — each user gets one or more API keys used to authenticate requests. Keys can be deactivated without deleting the user.

**endpoints** — the routes that are protected by the rate limiter. Storing these in the DB means rules can be updated without touching code.

**rate_limit_rules** — defines the max number of requests and the window duration (in seconds) for each endpoint. Different endpoints can have different rules.

**request_logs** — the core of the sliding window. Every allowed request is stored here with a millisecond-precision timestamp. On each new request, expired logs are deleted and the remaining ones are counted.

**rate_limit_violations** — every rejected request is logged here separately. Useful for monitoring abuse patterns and for the project report.

---

## Database Concepts Covered

This project was specifically designed to go beyond basic schema design and touch more advanced database territory:

- Normalized schema with foreign key constraints and cascading deletes
- Composite indexing on `(api_key_id, endpoint_id, request_timestamp)` for fast sliding window queries
- ACID-compliant transactions with `BEGIN`, `COMMIT`, and `ROLLBACK`
- Pessimistic locking using `SELECT FOR UPDATE` to handle concurrent requests safely
- Time-series data management with `TIMESTAMP(3)` for millisecond precision
- Data lifecycle management — expired records are evicted on every request cycle
- SSL-encrypted connection to a cloud-hosted MySQL instance
- Connection pooling via mysql2's `createPool`

---

## Race Condition Handling

Without transactions, two simultaneous requests could both read a count of 4 (under a limit of 5), both pass the check, and both insert — resulting in 6 total requests when only 5 should have been allowed.

The fix is wrapping the entire check-and-insert logic in a transaction and using `SELECT FOR UPDATE` to lock the relevant rows. Any concurrent request hitting the same API key and endpoint will wait until the first transaction commits before it can read. This guarantees correctness under concurrency.

---

## Project Structure

```
api-rate-limiter/
├── src/
│   ├── config/
│   │   └── db.js               # Aiven MySQL connection pool with SSL
│   ├── middleware/
│   │   └── rateLimiter.js      # Sliding window logic with transaction locking
│   ├── routes/
│   │   └── api.js              # Mock protected endpoints
│   └── index.js                # Express server entry point
├── sql/
│   └── schema.sql              # Full database schema
├── .env                        # Environment variables (not committed)
├── .gitignore
├── ca.pem                      # Aiven SSL certificate (not committed)
└── package.json
```

---

## Setup

### Prerequisites

- Node.js installed
- An Aiven account with a MySQL service running
- MySQL Workbench or DBeaver to run the schema

### Clone and install

```bash
git clone https://github.com/Shailja-Mishra04/api-rate-limiter.git
cd api-rate-limiter
npm install
```

### Environment variables

Create a `.env` file in the root directory:

```env
DB_HOST=your_aiven_host
DB_PORT=your_aiven_port
DB_NAME=rate_limiter_db
DB_USER=avnadmin
DB_PASSWORD=your_password
DB_SSL=true
CA_CERT_PATH=./ca.pem
PORT=3000
```

You will also need to download the CA certificate from your Aiven dashboard and place it as `ca.pem` in the project root. This file is required for the SSL connection.

### Run the schema

Open MySQL Workbench, connect to your Aiven instance, and run `sql/schema.sql` to create all tables.

### Start the server

```bash
npm run dev
```

You should see the server start on port 3000 and a successful database connection message.

---

## API Endpoints

All endpoints require an `x-api-key` header with a valid API key.

| Method | Route | Rate Limit | Description |
|--------|-------|------------|-------------|
| POST | `/api/login` | 5 per 60s | Mock login |
| POST | `/api/transfer` | 3 per 60s | Mock fund transfer |
| GET | `/api/balance` | 10 per 60s | Mock balance check |

### Example request

```
POST http://localhost:3000/api/login
Headers:
  x-api-key: test-key-shailja-001
  Content-Type: application/json
```

### When rate limit is hit

```json
{
  "success": false,
  "message": "Too many requests. Rate limit exceeded.",
  "limit": 5,
  "window_seconds": 60,
  "retry_after": "60 seconds"
}
```

### Response headers on allowed requests

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Window: 60
```

---

## Seed Data

The project includes seed data for testing — two users with API keys and three endpoints with different rate limit rules. Run the insert statements from the setup guide to populate the tables before testing.

---

## What I would do differently with Redis

If this were a production system, Redis would replace MySQL for the rate limiting layer entirely. Redis sorted sets make the sliding window trivial — a few atomic commands versus a full transaction with locking. The MySQL version exists to understand the problem deeply. The Redis version would exist to solve it efficiently.

---

## Author

Shailja Mishra
