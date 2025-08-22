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
7. **Database Update** → Store all metadata and media references
8. **UI Update** → Show completion status and attach to tweet

**Key Requirements:**
- **Non-blocking**: Users can continue using the app while videos process
- **Persistent**: Processing continues even if user closes browser tab
- **Resilient**: Automatic retry logic for failed downloads/uploads
- **Transparent**: Clear status updates throughout the process

### 3. Auto-Queue Integration

**Smart Posting Logic:**
- If user clicks "Post" while video is downloading → Automatically queue for 5 minutes later
- Show clear message: "Tweet queued! Video will be attached when ready."
- Update button text to "Queueing..." during this process
- Tooltip shows: "Video downloading - will queue instead"

**Queue Management:**
- Queued tweets store video S3 key even without media_id
- When video processing completes, automatically update queued tweets
- Video processing status visible on scheduled page
- Real-time updates every 5 seconds

### 4. Video Processing Status Dashboard

**Status Display Requirements:**
- Show on `/studio/scheduled` page above regular queue
- Only appear when videos are processing or queued with videos
- Real-time updates every 5 seconds
- Clear visual indicators for each state

**Status States:**
- **Processing**: Spinner icon + "Video processing... • Will post when ready"
- **Ready**: Green checkmark + "Video ready • Queued for [time]"
- **Failed**: Red X + Error message with retry option

**Information Displayed:**
- Tweet content preview (first 50 characters)
- Processing status with visual icons
- Scheduled posting time
- Status badges (Processing/Ready/Failed)
- Platform source (TikTok, Instagram, etc.)

## Technical Architecture

### 1. Video Download Service (Apify Integration)

**Apify Actor Configuration:**
- **Actor ID**: `marketingme/video-downloader`
- **Purpose**: Downloads videos from social media platforms
- **Supported Platforms**: TikTok, Instagram, YouTube, Twitter, Facebook, LinkedIn

**API Integration:**
```javascript
// Apify API Call Structure
const apifyClient = new ApifyApi({
  token: process.env.APIFY_API_TOKEN
});

const input = {
  urls: [videoUrl],
  downloadVideo: true,
  downloadAudio: false,
  downloadThumbnail: true
};

const run = await apifyClient.actor('marketingme/video-downloader').call(input);
```

**Response Data Structure:**
```javascript
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
  viewCount: 1000000,
  likeCount: 50000,
  commentCount: 1000,
  width: 1080,
  height: 1920,
  mediaUrl: "https://api.apify.com/v2/key-value-stores/[id]/records/video.mp4",
  thumbnailUrl: "https://api.apify.com/v2/key-value-stores/[id]/records/thumb.png",
  totalSize: 5.2 // Size in MB
}
```

**Polling Logic:**
- Start Apify run and get run ID
- Poll every 1.5-3 seconds with exponential backoff
- Maximum 90 polling attempts (about 5 minutes timeout)
- Handle rate limiting and API errors gracefully

### 2. Video Transcoding Requirements

**Twitter Video Specifications:**
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
- Detect original video properties (resolution, bitrate, duration)
- Skip transcoding if already Twitter-compatible
- Adjust CRF based on original quality (18-28 range)
- Preserve aspect ratio and orientation
- Log transcoding progress for user feedback

### 3. Cloud Storage Integration (AWS S3)

**S3 Configuration:**
- **Bucket**: Content storage bucket with public read access
- **Path Structure**: `tweet-media/{userId}/{randomId}.mp4`
- **Security**: Signed URLs for uploads, public URLs for access
- **Lifecycle**: Optional cleanup of old files after 30+ days

**Upload Process:**
```javascript
// S3 Upload Implementation
const uploadToS3 = async (videoBuffer, userId) => {
  const s3Key = `tweet-media/${userId}/${generateRandomId()}.mp4`;
  
  await s3Client.upload({
    Bucket: process.env.S3_BUCKET,
    Key: s3Key,
    Body: videoBuffer,
    ContentType: 'video/mp4',
    ACL: 'public-read'
  }).promise();
  
  return {
    s3Key,
    url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${s3Key}`
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

-- Media field structure (JSON)
{
  "s3Key": "tweet-media/user123/video.mp4",
  "media_id": "1234567890", -- Twitter media ID (optional during processing)
  "media_key": "abc123", -- Twitter media key (optional)
  "url": "https://bucket.s3.amazonaws.com/path/video.mp4",
  "type": "video",
  "platform": "TikTok", -- Source platform
  "originalUrl": "https://tiktok.com/@user/video/123",
  "title": "Video Title",
  "duration": 67.245,
  "size": 5242880 -- Size in bytes
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
- Cache Apify results for duplicate URLs (24 hour TTL)
- Store video metadata to avoid re-processing
- Implement CDN for frequently accessed videos

**Resource Management:**
- Limit concurrent video processing (max 5 per user)
- Clean up temporary files after processing
- Monitor S3 storage usage and costs

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
# Apify Configuration
APIFY_API_TOKEN=your_apify_token

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

# Processing Configuration
MAX_CONCURRENT_VIDEOS=5
VIDEO_PROCESSING_TIMEOUT=300000 # 5 minutes in ms
TEMP_FILE_CLEANUP_INTERVAL=3600000 # 1 hour in ms
```

### 2. Infrastructure Requirements
- **CPU**: High for video transcoding (recommend 4+ cores)
- **Memory**: 2GB+ for FFmpeg operations
- **Storage**: Temporary space for video processing (10GB+ recommended)
- **Network**: High bandwidth for video downloads/uploads

### 3. Scaling Considerations
- Implement job queue system (Redis/Bull) for high volume
- Consider separate microservice for video processing
- Use CDN for serving processed videos
- Implement horizontal scaling for processing workers

## Success Metrics

### 1. User Experience
- Time from URL paste to video ready: <2 minutes average
- Success rate: >95% for valid URLs
- User satisfaction: Seamless integration with existing workflow

### 2. Technical Performance
- Processing throughput: 100+ videos per hour
- Error rate: <5% across all platforms
- Uptime: 99.9% availability for video processing service

### 3. Business Impact
- Increased user engagement with video content
- Reduced manual video handling time
- Higher social media post completion rates

This specification provides a complete blueprint for implementing a robust video processing system that handles the entire pipeline from URL input to social media-ready content.
