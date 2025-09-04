#!/usr/bin/env node

/**
 * Stripe Webhook Development Helper
 * 
 * This script sets up Stripe CLI webhook forwarding for local development.
 * It forwards all relevant Stripe events to the local webhook endpoint.
 */

const { spawn } = require('child_process');
const path = require('path');

const LOCAL_PORT = 3000;
const WEBHOOK_PATH = '/webhooks/stripe';
const LOCAL_URL = `http://localhost:${LOCAL_PORT}${WEBHOOK_PATH}`;

// Events we want to listen for (matches our webhook handler)
const EVENTS = [
  'customer.deleted',
  'customer.updated', 
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid'
];

console.log('🔗 Setting up Stripe webhook forwarding for local development...');
console.log(`📍 Local webhook endpoint: ${LOCAL_URL}`);
console.log(`🎯 Listening for events: ${EVENTS.join(', ')}`);
console.log('');

// Build the Stripe CLI command
const stripeArgs = [
  'listen',
  '--forward-to', LOCAL_URL,
  '--events', EVENTS.join(','),
  '--print-secret'
];

console.log(`💻 Running: stripe ${stripeArgs.join(' ')}`);
console.log('');

// Start the Stripe CLI webhook forwarding
const stripeProcess = spawn('stripe', stripeArgs, {
  stdio: 'inherit',
  shell: true
});

// Handle process exit
stripeProcess.on('exit', (code) => {
  console.log(`\n🔌 Stripe webhook forwarding exited with code ${code}`);
  process.exit(code);
});

// Handle errors
stripeProcess.on('error', (error) => {
  console.error(`❌ Error: ${error.message}`);
  console.log('\n💡 Make sure you have:');
  console.log('   1. Stripe CLI installed: https://stripe.com/docs/stripe-cli');
  console.log('   2. Authenticated: stripe login');
  console.log('   3. Your local dev server running on port 3000');
  process.exit(1);
});

// Handle graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    console.log(`\n🛑 Received ${signal}, shutting down webhook forwarding...`);
    stripeProcess.kill(signal);
  });
});

console.log('🚀 Webhook forwarding started! Keep this terminal open.');
console.log('📝 Copy the webhook signing secret (whsec_...) that appears above');
console.log('🔑 Add it to your .env.local as STRIPE_WEBHOOK_SECRET=whsec_...');
console.log('');
console.log('Press Ctrl+C to stop webhook forwarding');
