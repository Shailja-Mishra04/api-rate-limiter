# API Rate Limiter

A production-inspired API Rate Limiter built with **Node.js**, **Express**, and **MySQL** (hosted on Aiven), implementing the **Sliding Window algorithm** to control request rates per API key and endpoint.

## Tech Stack
- **Backend:** Node.js + Express
- **Database:** MySQL (Cloud hosted on Aiven)
- **Algorithm:** Sliding Window Log

## Features
- Per API key rate limiting
- Per endpoint rate limit rules
- Sliding window algorithm with millisecond precision
- Rate limit violation logging
- Returns `429 Too Many Requests` with `Retry-After` header

## Database Schema
- `users` — registered users
- `api_keys` — API keys per user
- `endpoints` — protected routes
- `rate_limit_rules` — max requests per window per endpoint
- `request_logs` — timestamped log of every request (core of sliding window)
- `rate_limit_violations` — log of all rejected requests

## Setup

### Prerequisites
- Node.js
- MySQL Workbench
- Aiven account

### Installation
```bash
git clone https://github.com/Shailja-Mishra04/api-rate-limiter.git
cd api-rate-limiter
npm install
```

### Environment Variables
Create a `.env` file in the root:
```env
DB_HOST=your_aiven_host
DB_PORT=your_port
DB_NAME=rate_limiter_db
DB_USER=your_user
DB_PASSWORD=your_password
DB_SSL=true
CA_CERT_PATH=./ca.pem
PORT=3000
```

> ⚠️ You will need to download the CA certificate from your Aiven dashboard and place it as `ca.pem` in the project root.

### Run
```bash
npm run dev
```

## API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check |
| POST | `/api/login` | Mock login endpoint |
| POST | `/api/transfer` | Mock transfer endpoint |
| GET | `/api/balance` | Mock balance endpoint |

## Algorithm
The **Sliding Window Log** algorithm works by:
1. Storing every request as a timestamped log entry
2. On each new request, deleting entries older than the window
3. Counting remaining entries
4. Allowing or denying based on the rule for that endpoint

---
Made by Shailja
