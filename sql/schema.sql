CREATE DATABASE IF NOT EXISTS rate_limiter_db;
USE rate_limiter_db;

-- 1. Users table
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. API Keys table
CREATE TABLE api_keys (
    key_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    api_key VARCHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 3. Endpoints table
CREATE TABLE endpoints (
    endpoint_id INT AUTO_INCREMENT PRIMARY KEY,
    route VARCHAR(255) NOT NULL,
    method ENUM('GET', 'POST', 'PUT', 'DELETE', 'PATCH') NOT NULL,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_route_method (route, method)
);

-- 4. Rate Limit Rules table
CREATE TABLE rate_limit_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    endpoint_id INT NOT NULL,
    max_requests INT NOT NULL,
    window_seconds INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(endpoint_id) ON DELETE CASCADE
);

-- 5. Request Logs table
CREATE TABLE request_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    api_key_id INT NOT NULL,
    endpoint_id INT NOT NULL,
    request_timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(key_id) ON DELETE CASCADE,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(endpoint_id) ON DELETE CASCADE,
    INDEX idx_api_key_endpoint_timestamp (api_key_id, endpoint_id, request_timestamp)
);

-- 6. Rate Limit Violations table
CREATE TABLE rate_limit_violations (
    violation_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    api_key_id INT NOT NULL,
    endpoint_id INT NOT NULL,
    violated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(key_id) ON DELETE CASCADE,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(endpoint_id) ON DELETE CASCADE
);
USE rate_limiter_db;

-- Hides api_key (sensitive), shows only useful monitoring info
CREATE VIEW active_request_summary AS
SELECT 
    u.name AS user_name,
    u.email,
    e.route,
    e.method,
    COUNT(rl.log_id) AS requests_in_window,
    r.max_requests,
    r.window_seconds,
    (r.max_requests - COUNT(rl.log_id)) AS remaining_requests
FROM request_logs rl
JOIN api_keys ak ON rl.api_key_id = ak.key_id
JOIN users u ON ak.user_id = u.user_id
JOIN endpoints e ON rl.endpoint_id = e.endpoint_id
JOIN rate_limit_rules r ON e.endpoint_id = r.endpoint_id
WHERE rl.request_timestamp >= TIMESTAMPADD(SECOND, -r.window_seconds, NOW(3))
GROUP BY u.name, u.email, e.route, e.method, r.max_requests, r.window_seconds;
ALTER TABLE request_logs 
ADD COLUMN served_by VARCHAR(10) DEFAULT 'mysql';
-- Seed Data (run after schema creation)
-- INSERT INTO users (name, email) VALUES ('Shailja', 'shailja@test.com')...
-- See README for full seed data instructions