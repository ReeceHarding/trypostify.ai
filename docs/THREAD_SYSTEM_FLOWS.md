# Thread System Flow Diagrams

## Creating a Thread Flow

```
User Input → ThreadTweetEditor
    ↓
[Create Thread]
    ↓
createThreadMutation → POST /api/tweet/createThread
    ↓
tweet-router.ts: createThread()
    ↓
Database: Insert tweets with:
- Same threadId (generated UUID)
- position: 0, 1, 2...
- isThreadStart: true (first only)
    ↓
Returns: { threadId }
    ↓
[User chooses action]
    ├─→ Post Now ──→ postThreadNow()
    ├─→ Queue ────→ enqueueThread() → QStash
    └─→ Schedule ─→ scheduleThread() → QStash
```

## Editing a Thread Flow

```
Queue/List Page → Click Edit
    ↓
Navigate: /studio?edit=true&tweetId=[threadId]
    ↓
ThreadTweetEditor (edit mode)
    ↓
getThreadQuery → GET /api/tweet/getTweet?id=[threadId]
    ↓
Fetch all tweets WHERE threadId = [threadId]
    ↓
Populate editor with:
- content from each tweet
- media array with S3 URLs
    ↓
[User edits and saves]
    ↓
updateThreadMutation → POST /api/tweet/updateThread
    ↓
1. Delete existing tweets (same threadId)
2. Create new tweets (preserve scheduling)
3. Keep same threadId
    ↓
Navigate back to queue
```

## Posting a Thread Flow

```
postThreadNow(threadId)
    ↓
Fetch all tweets ORDER BY position
    ↓
For each tweet:
    ├─→ Has media? → uploadMediaToTwitter()
    │                    ↓
    │                Get media_ids
    │                    ↓
    └─────────────→ Twitter API: POST /2/tweets
                         ↓
                    Get tweet.id
                         ↓
                    Store in DB
                         ↓
                    Wait delayMs
                         ↓
                    Next tweet...
    ↓
Update all tweets:
- isPosted: true
- postedAt: now()
- tweetId: Twitter's ID
```

## Queue System Flow

```
User: "Add to Queue" → enqueueThread()
    ↓
findNextAvailableSlot(userNow, timezone)
    ↓
Check existing scheduled tweets
    ↓
Find next empty slot:
- Today: 10am, 12pm, 2pm
- Tomorrow: 10am, 12pm, 2pm
- Skip weekends if configured
    ↓
Calculate Unix timestamp
    ↓
QStash: Create scheduled job
    ↓
Update tweets in DB:
- isScheduled: true
- scheduledFor: timestamp
- qstashId: message ID
    ↓
Return slot info to user
```

## Media Upload Flow

```
User selects file → ImageTool
    ↓
uploadMutation → POST /api/file/upload
    ↓
file-router.ts:
1. Validate file (type, size)
2. Generate unique S3 key
3. Upload to S3
4. Return { s3Key, url }
    ↓
Store in tweet.media array
    ↓
[When posting]
    ↓
uploadMediaToTwitter(s3Key)
    ↓
1. Fetch from S3
2. Upload to Twitter
3. Get media_id
    ↓
Include in tweet payload:
media: { media_ids: [...] }
```

## Data Structure Examples

### Thread with 3 tweets:
```json
[
  {
    "id": "tweet-1-uuid",
    "threadId": "thread-uuid-123",
    "position": 0,
    "content": "First tweet",
    "isThreadStart": true,
    "media": []
  },
  {
    "id": "tweet-2-uuid",
    "threadId": "thread-uuid-123",
    "position": 1,
    "content": "Second tweet",
    "isThreadStart": false,
    "media": [{
      "s3Key": "uploads/img123.jpg",
      "media_id": "twitter-media-id",
      "url": "https://bucket.s3.../uploads/img123.jpg",
      "type": "image"
    }]
  },
  {
    "id": "tweet-3-uuid",
    "threadId": "thread-uuid-123",
    "position": 2,
    "content": "Third tweet",
    "isThreadStart": false,
    "media": []
  }
]
```

### Single Post (thread with 1 tweet):
```json
{
  "id": "single-tweet-uuid",
  "threadId": "single-tweet-uuid", // Same as id
  "position": 0,
  "content": "Just a single post",
  "isThreadStart": true,
  "media": []
}
```

## Key Files Reference

### Frontend
- `src/components/tweet-editor/thread-tweet-editor.tsx` - Main editor container
- `src/components/tweet-editor/thread-tweet.tsx` - Individual tweet component
- `src/components/tweet-queue.tsx` - Queue display
- `src/components/tweet-list.tsx` - Posted content display

### Backend
- `src/server/routers/tweet-router.ts` - All API endpoints
- `src/db/schema/tweet.ts` - Database schema
- `src/server/routers/file-router.ts` - Media uploads

### Utilities
- `src/lib/s3.ts` - S3 client configuration
- `src/lib/qstash.ts` - QStash client
- `twitter.ts` - Twitter API client
