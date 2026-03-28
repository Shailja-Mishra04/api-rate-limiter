require('dotenv').config({ path: __dirname + '/.env' });
console.log('ENV CHECK:', process.env.TEST_API_URL, process.env.TEST_KEY_1);

const API_URL = process.env.TEST_API_URL || 'http://localhost:3000/api/login';
const TOTAL_REQUESTS = parseInt(process.env.TEST_TOTAL_REQUESTS) || 10;

const AVAILABLE_KEYS = {
  user1: process.env.TEST_KEY_1,
  user2: process.env.TEST_KEY_2,
  user3: process.env.TEST_KEY_3,
  user4: process.env.TEST_KEY_4,
  user5: process.env.TEST_KEY_5,
};

// Change this to test different users
const ACTIVE_KEY = process.env.TEST_KEY_1 || 'test-key-shailja-001';

let allowedCount = 0;
let blockedCount = 0;

async function makeRequest(id) {
  const start = Date.now();
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ACTIVE_KEY,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const duration = Date.now() - start;
    const status = response.status;

    if (status === 200) {
      allowedCount++;
      console.log(`Request ${id}: 200 OK — ${duration}ms — served by: ${data.served_by || 'unknown'}`);
    } else if (status === 429) {
      blockedCount++;
      console.log(`Request ${id}: 429 BLOCKED — ${duration}ms`);
    }
      else if (status === 503) {
  console.log(`Request ${id}: 503 DEADLOCK — ${duration}ms — server busy`);
}
     else {
      console.log(`Request ${id}: ${status} — ${duration}ms — ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`Request ${id}: ERROR — ${err.message}`);
  }
}

async function runRaceConditionTest() {
  console.log('\n=== RACE CONDITION TEST ===');
  console.log(`URL: ${API_URL}`);
  console.log(`Firing ${TOTAL_REQUESTS} simultaneous requests with same API key`);
  console.log(`Rate limit is 5 — exactly 5 should pass if locking works correctly`);
  console.log('===========================\n');

  const requests = Array.from({ length: TOTAL_REQUESTS }, (_, i) =>
    makeRequest(i + 1)
  );

  await Promise.all(requests);

  console.log('\n=== RESULT ===');
  console.log(`Allowed: ${allowedCount}`);
  console.log(`Blocked: ${blockedCount}`);
  console.log(`Total:   ${allowedCount + blockedCount}`);
  console.log('');

  if (allowedCount === 5) {
    console.log('PASS — exactly 5 requests allowed. Transaction locking is working correctly.');
  } else if (allowedCount > 5) {
    console.log(`FAIL — ${allowedCount} requests allowed. Race condition detected! Locking is not working.`);
  } else {
    console.log(`NOTE — only ${allowedCount} allowed. Previous requests may still be in the window. Clear request_logs and retry.`);
  }
}

runRaceConditionTest();