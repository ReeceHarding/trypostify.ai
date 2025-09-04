#!/bin/bash

# Start Stripe webhook forwarding in the background
echo "🔗 Starting Stripe webhook forwarding..."

# Kill any existing stripe listen processes
pkill -f "stripe listen" 2>/dev/null || true

# Start the webhook forwarding in the background
stripe listen \
  --forward-to http://localhost:3000/webhooks/stripe \
  --events customer.deleted,customer.updated,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,invoice.paid \
  --print-secret \
  > stripe-webhook-output.log 2>&1 &

# Store the process ID
STRIPE_PID=$!
echo $STRIPE_PID > stripe-webhook.pid

echo "✅ Stripe webhook forwarding started with PID: $STRIPE_PID"
echo "📝 Check stripe-webhook-output.log for the webhook secret"
echo "🛑 To stop: kill \$(cat stripe-webhook.pid)"

# Wait a moment for the secret to be generated
sleep 3

# Show the webhook secret if available
if [ -f stripe-webhook-output.log ]; then
    echo ""
    echo "🔑 Webhook Secret:"
    grep "whsec_" stripe-webhook-output.log | tail -1
fi
