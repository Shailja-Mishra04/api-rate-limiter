require('dotenv').config({ path: __dirname + '/.env' });

const API_URL = process.env.TEST_API_URL;
const TOTAL_REQUESTS = parseInt(process.env.TEST_TOTAL_REQUESTS) || 10;

const AVAILABLE_KEYS = {
  user1: process.env.TEST_KEY_1,
  user2: process.env.TEST_KEY_2,
  user3: process.env.TEST_KEY_3,
  user4: process.env.TEST_KEY_4,
  user5: process.env.TEST_KEY_5,
};

// Change this to test different users
const ACTIVE_KEY = AVAILABLE_KEYS.user1;

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
      console.log(`Request ${id}: 200 OK — ${duration}ms — served by: ${data.served_by || 'unknown'}`);
    } else if (status === 429) {
      console.log(`Request ${id}: 429 BLOCKED — ${duration}ms — retry after: ${data.retry_after}`);
    } else {
      console.log(`Request ${id}: ${status} — ${duration}ms — ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`Request ${id}: ERROR — ${err.message}`);
  }
}

async function runStressTest() {
  console.log('\n=== STRESS TEST ===');
  console.log(`URL: ${API_URL}`);
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log(`Rate Limit: 5 requests per 60 seconds`);
  console.log('===================\n');

  const requests = Array.from({ length: TOTAL_REQUESTS }, (_, i) =>
    makeRequest(i + 1)
  );

  await Promise.all(requests);

  console.log('\n=== DONE ===');
  console.log('First 5 should be allowed, rest should be blocked.');
}

runStressTest();