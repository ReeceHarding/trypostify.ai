#!/usr/bin/env node

/**
 * Stripe Webhook Testing Helper
 * 
 * This script helps test webhook events using the Stripe CLI.
 * It provides easy commands to trigger common subscription events.
 */

const { spawn } = require('child_process');

const EVENTS_TO_TEST = [
  {
    name: 'customer.subscription.created',
    description: 'Test user upgrade to Pro plan',
    command: 'stripe trigger customer.subscription.created'
  },
  {
    name: 'customer.subscription.updated', 
    description: 'Test subscription status change',
    command: 'stripe trigger customer.subscription.updated'
  },
  {
    name: 'customer.subscription.deleted',
    description: 'Test user downgrade to Free plan',
    command: 'stripe trigger customer.subscription.deleted'
  },
  {
    name: 'invoice.paid',
    description: 'Test successful payment',
    command: 'stripe trigger invoice.paid'
  },
  {
    name: 'customer.deleted',
    description: 'Test customer deletion',
    command: 'stripe trigger customer.deleted'
  }
];

function showMenu() {
  console.log('\n🧪 Stripe Webhook Testing Menu');
  console.log('================================');
  console.log('');
  
  EVENTS_TO_TEST.forEach((event, index) => {
    console.log(`${index + 1}. ${event.name}`);
    console.log(`   ${event.description}`);
    console.log('');
  });
  
  console.log('0. Exit');
  console.log('');
  console.log('💡 Make sure you have:');
  console.log('   1. Dev server running (bun run dev)');
  console.log('   2. Webhook forwarding active (bun run stripe:webhook:dev)');
  console.log('   3. STRIPE_WEBHOOK_SECRET set in .env.local');
  console.log('');
}

function triggerEvent(eventIndex) {
  if (eventIndex === 0) {
    console.log('👋 Goodbye!');
    process.exit(0);
  }

  const event = EVENTS_TO_TEST[eventIndex - 1];
  if (!event) {
    console.log('❌ Invalid selection');
    return;
  }

  console.log(`\n🚀 Triggering: ${event.name}`);
  console.log(`📝 ${event.description}`);
  console.log(`💻 Running: ${event.command}`);
  console.log('');

  const [command, ...args] = event.command.split(' ');
  const process = spawn(command, args, {
    stdio: 'inherit',
    shell: true
  });

  process.on('exit', (code) => {
    if (code === 0) {
      console.log(`\n✅ Event ${event.name} triggered successfully!`);
      console.log('📋 Check your webhook logs and database to verify the event was processed.');
    } else {
      console.log(`\n❌ Event triggering failed with code ${code}`);
    }
    
    setTimeout(() => {
      showMenu();
      promptUser();
    }, 1000);
  });

  process.on('error', (error) => {
    console.error(`❌ Error: ${error.message}`);
    showMenu();
    promptUser();
  });
}

function promptUser() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Select an option (0-5): ', (answer) => {
    rl.close();
    const selection = parseInt(answer);
    
    if (isNaN(selection) || selection < 0 || selection > EVENTS_TO_TEST.length) {
      console.log('❌ Please enter a valid number (0-5)');
      promptUser();
      return;
    }

    triggerEvent(selection);
  });
}

// Start the interactive menu
console.log('🔗 Stripe Webhook Event Tester');
console.log('This tool helps you test webhook events locally.');

showMenu();
promptUser();
