// Simple test script to verify Pulse API endpoints
// Run with: node web/src/test-pulse-integration.js

const API_BASE = process.env.VITE_API_URL || 'http://localhost:3402/v1';

async function testPulseAPI() {
  console.log('Testing Pulse API endpoints...');
  console.log('API Base:', API_BASE);

  // Test health check
  try {
    const response = await fetch(`${API_BASE}/pulse/drafts`, {
      headers: {
        'Authorization': 'Bearer fake-token-for-structure-test'
      }
    });

    console.log('Draft endpoint status:', response.status);

    if (response.status === 401) {
      console.log('✓ API is responding and correctly requiring auth');
    } else {
      const text = await response.text();
      console.log('Response:', text);
    }
  } catch (error) {
    console.log('Error:', error.message);
  }
}

testPulseAPI();