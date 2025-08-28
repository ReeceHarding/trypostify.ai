# Video Processing Environment Variables

This document lists all environment variables required for the video processing system to work properly on Vercel deployment.

## Required Environment Variables

### Core AWS Configuration
```bash
# AWS credentials for S3 storage
AWS_REGION=us-east-1
AWS_GENERAL_ACCESS_KEY=your_aws_access_key
AWS_GENERAL_SECRET_KEY=your_aws_secret_key

# S3 bucket for media storage
NEXT_PUBLIC_S3_BUCKET_NAME=your-bucket-name
```

### Twitter API Configuration
```bash
# Twitter API credentials for video uploads
TWITTER_CONSUMER_KEY=your_twitter_consumer_key
TWITTER_CONSUMER_SECRET=your_twitter_consumer_secret
# Note: User-specific tokens are stored in the database per account
```

### Video Processing Services
```bash
# Apify API for video downloads (required)
APIFY_API_TOKEN=your_apify_api_token

# Coconut.io API for video transcoding (optional but recommended for Vercel)
# Without this, videos that fail Twitter upload cannot be transcoded on Vercel
COCONUT_API_KEY=your_coconut_api_key

# Your application URL for webhooks
NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
```

### QStash Configuration
```bash
# For background job processing
QSTASH_URL=your_qstash_url
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=your_signing_key
QSTASH_NEXT_SIGNING_KEY=your_next_signing_key
```

## Optional Environment Variables

### Vercel-Specific
```bash
# Automatically set by Vercel
VERCEL=1
VERCEL_ENV=production
VERCEL_URL=your-deployment-url.vercel.app
```

## Setting Up Environment Variables

### Local Development (.env.local)
Create a `.env.local` file in your project root with all required variables:

```bash
# Copy all required variables from above
AWS_REGION=us-east-1
AWS_GENERAL_ACCESS_KEY=your_key_here
# ... etc
```

### Vercel Deployment

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add each variable with its value
4. Choose which environments to apply to (Production, Preview, Development)
5. Save changes

### Coconut.io Setup (Recommended for Production)

1. Sign up at https://coconut.co
2. Get your API key from the dashboard
3. Add to Vercel environment variables
4. Without this, video transcoding will fail on Vercel

### Video Processing Flow

1. **Video Download**: Uses Apify API to download videos from social platforms
2. **S3 Storage**: Stores downloaded videos in AWS S3
3. **Twitter Upload**: Attempts direct upload to Twitter
4. **Transcoding**: If upload fails, uses Coconut.io (or local FFmpeg in dev)
5. **Webhook**: Coconut.io calls back when transcoding completes
6. **Final Upload**: Uploads transcoded video to Twitter

## Troubleshooting

### Video Processing Fails on Vercel
- Check if `COCONUT_API_KEY` is set
- Verify `NEXT_PUBLIC_SITE_URL` matches your deployment URL
- Ensure webhook endpoint is accessible: `https://your-app.vercel.app/api/video/transcode-webhook`

### 404 Errors from Coconut.io
- Verify API key is valid
- Check if you're using the correct API endpoint (v2)
- Ensure S3 credentials are correct for Coconut.io to access files

### Twitter Upload Failures
- Verify Twitter API credentials
- Check video format requirements (H.264, AAC, max 512MB)
- Ensure user has authorized Twitter account

## Cost Considerations

- **Apify**: Charges per video download
- **Coconut.io**: Charges per minute of video transcoded (~$0.05/min)
- **AWS S3**: Storage and bandwidth costs
- **QStash**: Message processing costs

## Security Notes

- Never commit `.env.local` to version control
- Use Vercel's environment variable encryption
- Rotate API keys regularly
- Monitor usage to prevent abuse
