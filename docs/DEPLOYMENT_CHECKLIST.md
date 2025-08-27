# Vercel Deployment Checklist

## Fixed Issues

1. **✅ Hardcoded ngrok URLs** - Replaced with `WEBHOOK_URL` environment variable
   - Previously: `https://sponge-relaxing-separately.ngrok-free.app`
   - Now: Uses `process.env.WEBHOOK_URL || getBaseUrl()`

## Environment Variables Required in Vercel

### Core Functionality
- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Authentication secret key
- `NEXT_PUBLIC_SITE_URL` - Your production URL (e.g., https://yourdomain.com)

### AI Features
- `OPENROUTER_API_KEY` - For AI chat functionality

### Twitter/X Integration
- `TWITTER_BEARER_TOKEN`
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`
- `TWITTER_CLIENT_ID`
- `TWITTER_CLIENT_SECRET`
- `TWITTER_CONSUMER_KEY`
- `TWITTER_CONSUMER_SECRET`

### File Storage (S3)
- `AWS_GENERAL_ACCESS_KEY`
- `AWS_GENERAL_SECRET_KEY`
- `AWS_REGION`
- `NEXT_PUBLIC_S3_BUCKET_NAME`

### Scheduling (QStash)
- `QSTASH_URL` (usually https://qstash.upstash.io)
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

### Redis Cache
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### Payments (Stripe)
- `STRIPE_PUBLIC_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Video Processing
- `COCONUT_API_KEY` - For video transcoding service (coconut.io)

#### Video Transcoding Cost Controls
- **File Size Limit**: 100MB max (larger files blocked)
- **Duration Limit**: 10 minutes max (longer videos blocked)  
- **Monthly Limit**: 100 transcodes per user per month
- **Format Pre-check**: .mp4/.mov files under 25MB try direct upload first
- **Cost Estimation**: ~$0.05/minute, warns if over $0.50

### Optional Services
- `GOOGLE_CLIENT_ID` - For Google OAuth
- `GOOGLE_CLIENT_SECRET` - For Google OAuth
- `FIRECRAWL_API_KEY` - For web crawling features
- `NEXT_PUBLIC_POSTHOG_KEY` - For analytics
- `NEXT_PUBLIC_POSTHOG_HOST` - For analytics
- `POSTHOG_API_KEY` - For server-side analytics
- `POSTHOG_ENV_ID` - For analytics environment

### Development/Local Only
- `WEBHOOK_URL` - Only needed if using ngrok or similar for local webhook testing

## Build Configuration

The project uses the standard Next.js build process:
- Build command: `npm run build` or `npm run build-no-log`
- Output directory: `.next`
- Install command: `npm install` or `bun install`

## Database Migrations

After deployment, you'll need to run database migrations:
```bash
npm run db:migrate
```

## Webhook Configuration

For scheduled posts to work, you need to configure QStash webhooks:
1. Set up QStash with your Upstash account
2. Configure the webhook URL to point to your production domain
3. Update the `WEBHOOK_URL` if different from your main domain

## CORS Configuration

The app is configured to accept requests from:
- `http://localhost:3000` (development)
- `https://trypostify.ai`
- `https://www.trypostify.ai`
- Your Vercel deployment URL (automatically handled)

## Potential Issues to Watch

1. **File Upload Size** - Default limit is 10MB, may need adjustment in Vercel
2. **Function Timeout** - Some operations (like posting threads) may need longer timeouts
3. **Cold Starts** - First requests after idle may be slower
4. **Rate Limiting** - Ensure Redis is properly configured for rate limiting

## Post-Deployment Steps

1. Run database migrations
2. Test Twitter/X authentication flow
3. Test file uploads to S3
4. Test scheduled post functionality
5. Verify webhook endpoints are accessible
6. Test payment flow if using Stripe
