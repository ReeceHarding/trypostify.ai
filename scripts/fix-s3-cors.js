#!/usr/bin/env node

/**
 * Script to check and fix S3 CORS configuration for OpenAI API compatibility
 * This ensures OpenAI can download images from presigned URLs
 */

const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '.env.local' });

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY,
  },
});

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME;

const REQUIRED_CORS_CONFIG = {
  CORSRules: [
    {
      AllowedHeaders: ['*'],
      AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
      AllowedOrigins: ['*'], // Allow all origins for OpenAI access
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3000,
    },
  ],
};

async function checkAndFixCORS() {
  console.log(`[S3_CORS] Checking CORS configuration for bucket: ${BUCKET_NAME}`);

  try {
    // Get current CORS configuration
    const getCorsCommand = new GetBucketCorsCommand({ Bucket: BUCKET_NAME });
    let currentCors;
    
    try {
      const corsResponse = await s3Client.send(getCorsCommand);
      currentCors = corsResponse.CORSRules;
      console.log('[S3_CORS] Current CORS configuration:', JSON.stringify(currentCors, null, 2));
    } catch (error) {
      if (error.name === 'NoSuchCORSConfiguration') {
        console.log('[S3_CORS] No CORS configuration found');
        currentCors = [];
      } else {
        throw error;
      }
    }

    // Check if CORS allows OpenAI access
    const hasOpenAIAccess = currentCors?.some(rule => 
      rule.AllowedOrigins?.includes('*') &&
      rule.AllowedMethods?.includes('GET') &&
      rule.AllowedHeaders?.includes('*')
    );

    if (hasOpenAIAccess) {
      console.log('[S3_CORS] ✅ CORS configuration already allows OpenAI access');
      return;
    }

    console.log('[S3_CORS] ⚠️ CORS configuration needs updating for OpenAI compatibility');
    console.log('[S3_CORS] Applying OpenAI-compatible CORS configuration...');

    // Apply the required CORS configuration
    const putCorsCommand = new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: REQUIRED_CORS_CONFIG,
    });

    await s3Client.send(putCorsCommand);
    console.log('[S3_CORS] ✅ CORS configuration updated successfully');
    console.log('[S3_CORS] OpenAI should now be able to download images from presigned URLs');

  } catch (error) {
    console.error('[S3_CORS] ❌ Error updating CORS configuration:', error);
    console.error('[S3_CORS] Please check your AWS credentials and bucket permissions');
    process.exit(1);
  }
}

async function testPresignedURL() {
  console.log('[S3_CORS] Testing presigned URL generation...');
  
  try {
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    
    // Generate a test presigned URL
    const testUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ 
        Bucket: BUCKET_NAME, 
        Key: 'test-image.png' // This doesn't need to exist
      }),
      { expiresIn: 3600 }
    );

    console.log('[S3_CORS] ✅ Presigned URL generation working');
    console.log('[S3_CORS] Sample URL:', testUrl.substring(0, 100) + '...');
    
  } catch (error) {
    console.error('[S3_CORS] ❌ Error generating presigned URL:', error);
  }
}

async function main() {
  if (!BUCKET_NAME) {
    console.error('[S3_CORS] ❌ NEXT_PUBLIC_S3_BUCKET_NAME environment variable is required');
    process.exit(1);
  }

  if (!process.env.AWS_GENERAL_ACCESS_KEY || !process.env.AWS_GENERAL_SECRET_KEY) {
    console.error('[S3_CORS] ❌ AWS credentials are required (AWS_GENERAL_ACCESS_KEY, AWS_GENERAL_SECRET_KEY)');
    process.exit(1);
  }

  await checkAndFixCORS();
  await testPresignedURL();
  
  console.log('\n[S3_CORS] 🎉 S3 CORS configuration check completed');
  console.log('[S3_CORS] If you continue to see OpenAI download errors, the issue may be:');
  console.log('[S3_CORS] 1. S3 bucket policy restrictions');
  console.log('[S3_CORS] 2. Network connectivity between OpenAI and AWS');
  console.log('[S3_CORS] 3. File doesn\'t exist at the specified S3 key');
}

if (require.main === module) {
  main().catch(console.error);
}
