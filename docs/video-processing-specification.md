# Video Processing System Specification

## Overview

This document describes a comprehensive video processing system that allows users to paste video URLs from TikTok, Instagram, YouTube, and other platforms, automatically download and process those videos, and attach them to social media posts. The system handles the entire pipeline from URL input to Twitter-ready video files.

## Core Functionality Requirements

### 1. Video URL Input & Validation

**User Experience:**
- Users can paste video URLs from supported platforms (TikTok, Instagram, YouTube, etc.)
- URLs are automatically detected and validated
- Invalid URLs show clear error messages
- Supported URL formats include:
  - TikTok: `https://www.tiktok.com/@username/video/1234567890`
  - Instagram: `https://www.instagram.com/reel/ABC123/` or `https://www.instagram.com/p/ABC123/`
  - YouTube: `https://www.youtube.com/watch?v=ABC123` or `https://youtu.be/ABC123`

**Technical Implementation:**
- URL validation using regex patterns for each platform
- Real-time validation feedback in the UI
- Error handling for malformed or unsupported URLs

### 2. Asynchronous Video Processing Pipeline

**Core Workflow:**
1. **URL Submission** → User pastes video URL and clicks submit
2. **Immediate UI Response** → Show processing state with progress indicator
3. **Background Download** → Fetch video from source platform via Apify
4. **Video Transcoding** → Convert to Twitter-compatible format (H.264/AAC)
5. **Cloud Storage** → Upload processed video to S3
6. **Twitter Upload** → Upload video to Twitter API and get media_id
7. **Auto-Post** → Immediately post tweet with attached video to Twitter
8. **UI Update** → Show completion status and success confirmation

**Key Requirements:**
- **Non-blocking**: Users can continue using the app while videos process
- **Persistent**: Processing continues even if user closes browser tab
- **Resilient**: Automatic retry logic for failed downloads/uploads
- **Transparent**: Clear status updates throughout the process

### 3. Auto-Post Integration

**Smart Posting Logic:**
- If user clicks "Post" while video is downloading → Show "Processing..." state and wait
- Show clear message: "Processing video... Tweet will post when ready."
- Update button text to "Processing..." during this process
- Tooltip shows: "Video downloading - will post automatically when ready"

**Auto-Post Management:**
- Tweet creation waits in pending state with video S3 key
- When video processing completes, automatically attach video and post immediately
- Video processing status visible during the wait
- Real-time updates every 5 seconds until posting

### 4. Video Processing Status Dashboard

**Status Display Requirements:**
- Show on `/studio/scheduled` page above regular queue
- Only appear when videos are processing or queued with videos
- Real-time updates every 5 seconds
- Clear visual indicators for each state

**Status States:**
- **Processing**: Spinner icon + "Video processing... • Will post automatically when ready"
- **Posting**: Upload icon + "Video ready • Posting to Twitter now..."
- **Posted**: Green checkmark + "Video posted successfully!"
- **Failed**: Red X + Error message with retry option

**Information Displayed:**
- Tweet content preview (first 50 characters)
- Processing status with visual icons
- Current processing stage (downloading, transcoding, uploading, posting)
- Status badges (Processing/Posting/Posted/Failed)
- Platform source (TikTok, Instagram, etc.)
- Estimated time remaining (when available)

## Technical Architecture

### 1. Video Download Service (Apify Integration)

**Apify Actor Configuration:**
- **Actor ID**: `ceeA8aQjRcp3E6cNx`
- **Actor Name**: Video Downloader (Without Logo)
- **API Endpoint**: `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/run-sync`
- **Purpose**: Downloads videos from social media platforms (watermark-free)
- **Supported Platforms**: TikTok, Instagram, YouTube, Twitter/X, Facebook, LinkedIn, and 997+ additional platforms

**API Integration:**
```javascript
// Apify API Call Structure - Direct HTTP Request
const downloadVideo = async (videoUrl, quality = 'high') => {
  const response = await fetch('https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/run-sync', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      video_urls: [videoUrl],
      quality: quality // "medium" or "high" (up to 4K)
    })
  });
  
  if (!response.ok) {
    throw new Error(`Apify API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.videos[0]; // Return first video from batch
};
```

**Response Data Structure:**
```javascript
// API returns a wrapper object with videos array
{
  "videos": [
    {
      sourceUrl: "https://www.tiktok.com/@user/video/123",
      processor: "https://apify.com/marketingme/video-downloader",
      processedAt: "2025-08-22T17:22:40.557362+00:00",
      contentId: "ABC123",
      platform: "TikTok",
      title: "Video Title",
      description: "Video description...",
      durationSeconds: 67.245,
      publishedAt: "2025-07-02T13:00:51",
      author: "Username",
      authorId: "user_id",
      authorUrl: "https://www.tiktok.com/@user",
      viewCount: 1000000,
      likeCount: 50000,
      sharesCount: 1250,
      commentCount: 1000,
      width: 1080,
      height: 1920,
      fps: 30,
      mediaUrl: "https://apify.com/storage/video_ABC123.mp4", // Direct MP4 link (watermark-free)
      thumbnailUrl: "https://apify.com/storage/thumb_ABC123.png",
      totalSize: 5.2, // Size in MB
      categories: ["Entertainment", "Dance"],
      tags: ["fyp", "trending", "viral"],
      comments: [
        {
          author: "CommenterName",
          text: "Amazing video!",
          likeCount: 42,
          publishedAt: "2025-07-02T14:15:30.000Z"
        }
      ]
    }
  ]
}

// For single video processing, access the first video:
const videoData = response.videos[0];
```

**Batch Processing Capabilities:**
- **Single Request**: Process 1 video URL
- **Batch Request**: Process up to 5 video URLs simultaneously
- **Performance**: Batch processing is more efficient for multiple videos
- **Rate Limits**: Recommended 30 requests per second

**Batch Processing Example:**
```javascript
// Process multiple videos in a single request
const downloadMultipleVideos = async (videoUrls, quality = 'high') => {
  if (videoUrls.length > 5) {
    throw new Error('Maximum 5 URLs per batch request');
  }
  
  const response = await fetch('https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/run-sync', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      video_urls: videoUrls, // Array of up to 5 URLs
      quality: quality
    })
  });
  
  const data = await response.json();
  return data.videos; // Returns array of processed videos
};

// Usage example
const videoUrls = [
  'https://www.tiktok.com/@creator1/video/12345',
  'https://www.instagram.com/p/ABCDEF/',
  'https://www.youtube.com/watch?v=xyz123'
];
const videos = await downloadMultipleVideos(videoUrls, 'high');
```

**Processing Logic:**
- **Synchronous Processing**: Uses `/run-sync` endpoint for immediate results
- **No Polling Required**: Results returned directly in response
- **Error Handling**: Failed downloads return error objects per URL
- **Automatic Retry**: Built-in retry logic for transient failures

### 2. Video Quality Options & Transcoding Requirements

**Apify Quality Settings:**
- **"high"**: Up to 4K/2160p resolution (recommended for best quality)
- **"medium"**: Standard HD resolution (faster processing, smaller files)

**Quality Selection Strategy:**
```javascript
// Choose quality based on use case
const quality = {
  socialMedia: 'high',    // Best quality for professional content
  bulk: 'medium',         // Faster processing for large batches
  mobile: 'medium',       // Smaller files for mobile users
  preview: 'medium'       // Quick previews and testing
};

// Dynamic quality selection based on platform
const getOptimalQuality = (platform, fileSize) => {
  if (platform === 'TikTok' && fileSize > 100) return 'medium'; // TikTok prefers smaller files
  if (platform === 'YouTube') return 'high'; // YouTube supports high quality
  return 'high'; // Default to high quality
};
```

**Twitter Video Specifications (Post-Processing):**
- **Container**: MP4
- **Video Codec**: H.264 (Baseline, Main, or High profile)
- **Audio Codec**: AAC (LC profile)
- **Maximum Duration**: 2 minutes 20 seconds (140 seconds)
- **Maximum File Size**: 512 MB
- **Resolution**: Up to 1920x1200 (landscape) or 1200x1920 (portrait)
- **Frame Rate**: Up to 40 fps
- **Bitrate**: Up to 25 Mbps

**FFmpeg Transcoding Command:**
```bash
ffmpeg -i input.mp4 \
  -y \
  -acodec aac \
  -vcodec libx264 \
  -f mp4 \
  -preset fast \
  -crf 23 \
  -movflags +faststart \
  -pix_fmt yuv420p \
  output.mp4
```

**Transcoding Parameters Explained:**
- `-acodec aac`: Audio codec (AAC)
- `-vcodec libx264`: Video codec (H.264)
- `-f mp4`: Output format
- `-preset fast`: Encoding speed vs compression trade-off
- `-crf 23`: Constant Rate Factor (quality setting, 18-28 range)
- `-movflags +faststart`: Optimize for web streaming
- `-pix_fmt yuv420p`: Pixel format for compatibility

**Quality & Size Optimization:**
- **Apify Pre-Processing**: Videos are already optimized and watermark-free
- **Skip Transcoding**: Most Apify videos are already Twitter-compatible (MP4/H.264)
- **Quality Check**: Verify video meets Twitter specs before optional re-encoding
- **Smart Transcoding**: Only re-encode if file size > 512MB or format incompatible
- **Preserve Metadata**: Maintain aspect ratio, orientation, and quality from Apify
- **Progress Logging**: Track transcoding progress for user feedback

### 3. Cloud Storage Integration (AWS S3)

**S3 Configuration:**
- **Bucket**: Content storage bucket with public read access
- **Path Structure**: `tweet-media/{userId}/{randomId}.mp4`
- **Security**: Signed URLs for uploads, public URLs for access
- **Lifecycle**: Optional cleanup of old files after 30+ days

**Upload Process:**
```javascript
// S3 Upload Implementation - Enhanced for Apify Integration
const uploadToS3 = async (apifyVideoData, userId) => {
  // Download video from Apify storage
  const videoResponse = await fetch(apifyVideoData.mediaUrl);
  const videoBuffer = await videoResponse.buffer();
  
  const s3Key = `tweet-media/${userId}/${apifyVideoData.contentId || generateRandomId()}.mp4`;
  
  await s3Client.upload({
    Bucket: process.env.S3_BUCKET,
    Key: s3Key,
    Body: videoBuffer,
    ContentType: 'video/mp4',
    ACL: 'public-read',
    Metadata: {
      'original-platform': apifyVideoData.platform,
      'original-title': apifyVideoData.title,
      'content-id': apifyVideoData.contentId,
      'duration': apifyVideoData.durationSeconds.toString(),
      'author': apifyVideoData.author
    }
  }).promise();
  
  return {
    s3Key,
    url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${s3Key}`,
    originalData: apifyVideoData // Preserve Apify metadata
  };
};
```

### 4. Twitter API Integration

**Media Upload Process:**
- Use Twitter API v1.1 media/upload endpoint
- Support chunked uploads for large files
- Handle media processing status polling
- Get media_id and media_key for tweet attachment

**Upload Implementation:**
```javascript
// Twitter Media Upload
const uploadToTwitter = async (videoBuffer) => {
  // Initialize upload
  const initResponse = await twitterClient.post('media/upload', {
    command: 'INIT',
    total_bytes: videoBuffer.length,
    media_type: 'video/mp4',
    media_category: 'tweet_video'
  });
  
  const mediaId = initResponse.media_id_string;
  
  // Upload chunks (if needed for large files)
  await twitterClient.post('media/upload', {
    command: 'APPEND',
    media_id: mediaId,
    media: videoBuffer,
    segment_index: 0
  });
  
  // Finalize upload
  const finalizeResponse = await twitterClient.post('media/upload', {
    command: 'FINALIZE',
    media_id: mediaId
  });
  
  return {
    media_id: mediaId,
    media_key: finalizeResponse.media_key
  };
};
```

### 5. Database Schema

**Tweets Table Updates:**
```sql
-- Add video processing fields to tweets table
ALTER TABLE tweets ADD COLUMN pending_video_url TEXT;
ALTER TABLE tweets ADD COLUMN video_processing_status VARCHAR(20); -- 'downloading', 'transcoding', 'uploading', 'complete', 'failed'
ALTER TABLE tweets ADD COLUMN video_error_message TEXT;

-- Media field structure (JSON) - Updated for new API response
{
  "s3Key": "tweet-media/user123/video.mp4",
  "media_id": "1234567890", -- Twitter media ID (optional during processing)
  "media_key": "abc123", -- Twitter media key (optional)
  "url": "https://bucket.s3.amazonaws.com/path/video.mp4",
  "type": "video",
  "platform": "TikTok", -- Source platform
  "originalUrl": "https://tiktok.com/@user/video/123",
  "title": "Video Title",
  "description": "Video description from platform",
  "author": "Username",
  "authorId": "unique_author_id",
  "authorUrl": "https://platform.com/@username",
  "durationSeconds": 67.245,
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "totalSize": 5.24, -- Size in MB (from API)
  "viewCount": 1000000,
  "likeCount": 50000,
  "sharesCount": 1250,
  "commentCount": 1000,
  "categories": ["Entertainment", "Dance"],
  "tags": ["fyp", "trending", "viral"],
  "thumbnailUrl": "https://apify.com/storage/thumb_ABC123.png",
  "processedAt": "2025-08-22T17:22:40.557362+00:00",
  "contentId": "ABC123"
}
```

### 6. Error Handling & Recovery

**Error Categories:**
1. **URL Validation Errors**: Invalid or unsupported URLs
2. **Download Errors**: Platform restrictions, deleted videos, network issues
3. **Transcoding Errors**: Corrupted files, unsupported formats
4. **Upload Errors**: S3 failures, Twitter API limits
5. **Timeout Errors**: Long-running processes exceeding limits

**Recovery Strategies:**
- **Automatic Retry**: 3 attempts with exponential backoff
- **Graceful Degradation**: Continue with original video if transcoding fails
- **User Notification**: Clear error messages with suggested actions
- **Cleanup**: Remove temporary files and partial uploads on failure

**Error Response Format:**
```javascript
{
  success: false,
  error: {
    code: "DOWNLOAD_FAILED",
    message: "Video could not be downloaded from TikTok",
    details: "The video may be private or deleted",
    retryable: true,
    suggestedAction: "Try a different video URL"
  }
}
```

## Implementation Guidelines

### 1. Progress Tracking

**UI Progress Indicators:**
- Download: 0-40% (Apify processing)
- Transcoding: 40-70% (FFmpeg processing)  
- S3 Upload: 70-85% (Cloud storage)
- Twitter Upload: 85-100% (Social media platform)

**Progress Updates:**
```javascript
// Progress update structure
{
  stage: "downloading", // downloading, transcoding, uploading_s3, uploading_twitter, complete
  progress: 45, // 0-100 percentage
  message: "Downloading video from TikTok...",
  estimatedTimeRemaining: 30 // seconds (optional)
}
```

### 2. Performance Optimization

**Caching Strategy:**
- **Cache Apify Results**: Store successful downloads for duplicate URLs (24 hour TTL)
- **Batch Processing**: Use batch requests for multiple videos to reduce API calls
- **Metadata Storage**: Store video metadata to avoid re-processing
- **CDN Integration**: Implement CloudFront for frequently accessed videos
- **Quality-Based Caching**: Cache different quality versions separately

**Resource Management:**
- **Concurrent Processing**: Limit to 5 video downloads per user simultaneously
- **Rate Limiting**: Respect Apify's 30 requests/second recommendation
- **Batch Optimization**: Group multiple URLs into single requests when possible
- **Storage Monitoring**: Track S3 usage and implement cost alerts
- **Cleanup**: Remove temporary files and failed downloads automatically

### 3. Security Considerations

**Input Validation:**
- Sanitize all user-provided URLs
- Validate file types and sizes
- Prevent path traversal attacks in S3 keys

**Access Control:**
- User-specific S3 paths
- Authenticated API endpoints only
- Rate limiting on video processing requests

**Privacy:**
- No permanent storage of source URLs
- Optional automatic cleanup of processed videos
- Respect platform terms of service

## Testing Strategy

### 1. Unit Tests
- URL validation functions
- Video transcoding logic
- S3 upload/download operations
- Database operations

### 2. Integration Tests
- End-to-end video processing pipeline
- Apify API integration
- Twitter API integration
- Error handling scenarios

### 3. Performance Tests
- Concurrent video processing
- Large file handling (up to 512MB)
- Network failure scenarios
- Memory usage under load

## Monitoring & Observability

### 1. Logging Requirements
- All API calls with response times
- Video processing stages with timestamps
- Error occurrences with stack traces
- User actions and success rates

### 2. Metrics to Track
- Video processing success rate
- Average processing time per stage
- File size distribution
- Platform-specific success rates
- User engagement with video features

### 3. Alerting
- High error rates (>5% failures)
- Processing time spikes (>5 minutes)
- S3 storage quota warnings
- Twitter API rate limit approaches

## Deployment Considerations

### 1. Environment Variables
```bash
# Apify Configuration - Updated for new API
APIFY_API_TOKEN=your_apify_token
APIFY_ACTOR_ID=ceeA8aQjRcp3E6cNx

# AWS S3 Configuration  
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your_bucket_name
S3_REGION=us-east-1

# Twitter API Configuration
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_token_secret

# Processing Configuration - Updated for new API
MAX_CONCURRENT_VIDEOS=5
MAX_BATCH_SIZE=5 # Maximum URLs per Apify request
VIDEO_PROCESSING_TIMEOUT=300000 # 5 minutes in ms
APIFY_RATE_LIMIT=30 # Requests per second
TEMP_FILE_CLEANUP_INTERVAL=3600000 # 1 hour in ms
DEFAULT_VIDEO_QUALITY=high # "medium" or "high"
```

### 2. Infrastructure Requirements
- **CPU**: Moderate requirements (2+ cores) - Apify handles video processing
- **Memory**: 1GB+ for handling video downloads and uploads
- **Storage**: Temporary space for video transfer (5GB+ recommended)
- **Network**: High bandwidth for video downloads from Apify and uploads to S3/Twitter
- **API Limits**: Monitor Apify usage and Twitter API rate limits

### 3. Scaling Considerations
- **Job Queue System**: Implement Redis/Bull for high-volume video processing
- **Batch Processing**: Leverage Apify's batch capabilities to reduce API calls
- **CDN Integration**: Use CloudFront for serving processed videos globally
- **Rate Limit Management**: Implement smart batching to stay within Apify limits
- **Horizontal Scaling**: Scale video download/upload workers based on demand
- **Microservice Architecture**: Consider separate service for video operations

This specification provides a complete blueprint for implementing a robust video processing system using the updated Apify Video Downloader API. The system handles the entire pipeline from URL input to social media-ready content with watermark-free, high-quality video downloads from 1000+ platforms.

## Key Improvements with Updated API

### Enhanced Capabilities
- **Watermark-Free Videos**: All downloaded videos are clean without platform watermarks
- **Batch Processing**: Process up to 5 videos simultaneously for better performance
- **Quality Options**: Choose between medium and high quality based on use case
- **Rich Metadata**: Access detailed video information including views, likes, comments, and tags
- **Better Platform Support**: Support for 997+ platforms beyond the core social networks

### Simplified Architecture
- **No Polling Required**: Synchronous API eliminates complex polling logic
- **Pre-Optimized Videos**: Most videos are already Twitter-compatible, reducing transcoding needs
- **Direct MP4 Links**: Apify provides direct download links for seamless integration
- **Automatic Retry**: Built-in retry logic reduces error handling complexity

### Cost Optimization
- **Efficient Batching**: Reduce API calls by processing multiple videos per request
- **Smart Quality Selection**: Choose optimal quality based on platform and use case
- **Reduced Transcoding**: Skip unnecessary video processing when files are already compatible
- **Better Caching**: More detailed metadata enables better caching strategies
