// Test script for thread API
const API_URL = 'http://localhost:3000/api/thread/createThread';

// This is a test script - replace with actual auth token from browser
const AUTH_COOKIE = 'YOUR_AUTH_COOKIE_HERE';

async function testThreadCreation() {
  console.log('🧵 Testing thread creation API...');
  
  const threadData = {
    tweets: [
      {
        content: "This is the first tweet in my test thread!",
        media: [],
        delayMs: 0
      },
      {
        content: "This is the second tweet, posted 5 seconds after the first",
        media: [],
        delayMs: 5000
      },
      {
        content: "And this is the third tweet, posted 10 seconds after the second",
        media: [],
        delayMs: 10000
      }
    ]
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': AUTH_COOKIE
      },
      body: JSON.stringify(threadData)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Thread created successfully:', result);
    console.log(`Thread ID: ${result.threadId}`);
    console.log(`Number of tweets: ${result.tweets.length}`);
  } catch (error) {
    console.error('❌ Error creating thread:', error);
  }
}

// Instructions for use
console.log(`
⚠️  INSTRUCTIONS:
1. Open your browser and go to http://localhost:3000
2. Log in to your account
3. Open DevTools (F12) and go to the Network tab
4. Navigate to any studio page
5. Look for any API request and copy the 'Cookie' header value
6. Replace YOUR_AUTH_COOKIE_HERE in this script with that value
7. Run this script again with: node test-thread-api.js
`);

// Only run if auth cookie is set
if (AUTH_COOKIE !== 'YOUR_AUTH_COOKIE_HERE') {
  testThreadCreation();
}
