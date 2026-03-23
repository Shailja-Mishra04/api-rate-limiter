require('dotenv').config();

const API_URL = 'http://localhost:3000/api/login';
const API_KEY = 'test-key-shailja-001';
const TOTAL_REQUESTS = 10;

async function makeRequest(id) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const status = response.status;

    if (status === 200) {
      console.log(`Request ${id}: ✅ 200 OK — ${data.message}`);
    } else if (status === 429) {
      console.log(`Request ${id}: ❌ 429 BLOCKED — ${data.message}`);
    } else {
      console.log(`Request ${id}: ⚠️  ${status} — ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`Request ${id}: 💥 ERROR — ${err.message}`);
  }
}

async function runStressTest() {
  console.log(`\nFiring ${TOTAL_REQUESTS} concurrent requests to ${API_URL}`);
  console.log(`API Key: ${API_KEY}`);
  console.log(`Rate Limit: 5 requests per 60 seconds\n`);
  console.log('--- Results ---');

  // Fire all requests simultaneously
  const requests = Array.from({ length: TOTAL_REQUESTS }, (_, i) =>
    makeRequest(i + 1)
  );

  await Promise.all(requests);

  console.log('\n--- Done ---');
  console.log('First 5 should be allowed, rest should be blocked.');
}

runStressTest();