# Stripe CLI Setup Guide

This guide walks you through setting up the Stripe CLI for local development and testing of webhook events.

## Prerequisites

- Stripe CLI installed and configured
- Local development server running on port 3000
- Access to your Stripe dashboard

## Quick Start

### 1. Install Stripe CLI (if not already installed)

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Other platforms: https://stripe.com/docs/stripe-cli/install
```

### 2. Authenticate with Stripe

```bash
stripe login
```

This will open your browser and ask you to confirm the pairing code.

### 3. Start Webhook Forwarding

In one terminal, start your development server:
```bash
bun run dev
```

In another terminal, start webhook forwarding:
```bash
bun run stripe:webhook:dev
```

This will:
- Forward webhook events from Stripe to `http://localhost:3000/webhooks/stripe`
- Print a webhook signing secret (starts with `whsec_`)
- Listen for all subscription-related events

### 4. Configure Webhook Secret

Copy the webhook signing secret from the terminal output and add it to your `.env.local` file:

```bash
# .env.local
STRIPE_WEBHOOK_SECRET=whsec_785bb51c219e1674d6fe99971dac2d57538fc086debdd6c809c93280e9dfc3ad
```

## Testing Webhook Events

### Interactive Testing

Use our interactive testing tool:
```bash
bun run stripe:webhook:test
```

This provides a menu to trigger common events:
1. `customer.subscription.created` - Test user upgrade to Pro plan
2. `customer.subscription.updated` - Test subscription status change  
3. `customer.subscription.deleted` - Test user downgrade to Free plan
4. `invoice.paid` - Test successful payment
5. `customer.deleted` - Test customer deletion

### Manual Testing

You can also trigger events manually using the Stripe CLI:

```bash
# Test subscription creation (upgrades user to Pro)
stripe trigger customer.subscription.created

# Test subscription cancellation (downgrades user to Free)  
stripe trigger customer.subscription.deleted

# Test successful payment
stripe trigger invoice.paid

# Test customer deletion
stripe trigger customer.deleted
```

## Webhook Events Handled

Our webhook endpoint (`/webhooks/stripe`) handles these events:

| Event | Description | User Plan Change |
|-------|-------------|------------------|
| `customer.subscription.created` | New subscription created | Free → Pro |
| `customer.subscription.updated` | Subscription status changed | Based on status |
| `customer.subscription.deleted` | Subscription cancelled | Pro → Free |
| `customer.subscription.paused` | Subscription paused | Pro → Free |
| `customer.subscription.resumed` | Subscription resumed | Free → Pro |
| `invoice.paid` | Successful payment | Free → Pro (if needed) |
| `customer.deleted` | Customer deleted | Clears stripeId |
| `customer.updated` | Customer info updated | Updates user name |

## Troubleshooting

### Common Issues

**"Authorization failed, status=401"**
- Your API key has expired
- Run `stripe login` to re-authenticate

**"Connection refused" or "Cannot connect"**
- Make sure your dev server is running on port 3000
- Check that the webhook endpoint exists at `/webhooks/stripe`

**"Webhook signature verification failed"**
- Make sure `STRIPE_WEBHOOK_SECRET` is set in `.env.local`
- The secret should start with `whsec_`
- Restart your dev server after adding the secret

**Events not triggering plan changes**
- Check your database to see if the user has a `stripeId`
- Verify the webhook logs in your terminal
- Make sure the subscription uses the correct price ID

### Debugging Tips

1. **Check webhook logs**: The webhook endpoint logs all events to the console
2. **Verify database changes**: Use `bun run db:studio` to check user plan changes
3. **Monitor Stripe dashboard**: Check the webhook events in your Stripe dashboard
4. **Test with real data**: Create a test subscription in your Stripe dashboard

## Development Workflow

### Typical Development Session

1. Start the dev server: `bun run dev`
2. Start webhook forwarding: `bun run stripe:webhook:dev` 
3. Copy the webhook secret to `.env.local`
4. Test subscription flows using `bun run stripe:webhook:test`
5. Verify plan changes in your application UI

### Testing Subscription Flow

1. **Create a user** in your application
2. **Trigger subscription creation**: `stripe trigger customer.subscription.created`
3. **Check the user's plan** changed to "Pro" in the UI
4. **Trigger subscription deletion**: `stripe trigger customer.subscription.deleted`  
5. **Verify the user** was downgraded to "Free"

## Production Deployment

When deploying to production, you'll need to:

1. **Create a webhook endpoint** in your Stripe dashboard
2. **Set the endpoint URL** to `https://yourdomain.com/webhooks/stripe`
3. **Configure the same events** we listen for in development
4. **Add the production webhook secret** to your environment variables
5. **Test the webhook** using Stripe's webhook testing tools

The webhook endpoint code is already production-ready and handles all the events correctly.

## Scripts Reference

- `bun run stripe:webhook:dev` - Start webhook forwarding for development
- `bun run stripe:webhook:test` - Interactive webhook event testing
- `stripe login` - Authenticate with Stripe CLI
- `stripe listen --help` - View Stripe CLI webhook options
- `stripe trigger --help` - View available test events

## Security Notes

- Webhook secrets are sensitive - never commit them to version control
- The webhook endpoint validates signatures to ensure events are from Stripe
- Events are processed idempotently to prevent duplicate processing
- Failed webhook processing is logged for debugging

## Need Help?

- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Testing Webhooks Locally](https://stripe.com/docs/webhooks/test)
