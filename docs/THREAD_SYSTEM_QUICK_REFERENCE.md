# Thread System Quick Reference

## TL;DR
- **Everything is a thread** - Single posts are threads with one tweet
- **threadId** groups tweets together, **position** orders them
- **Three posting options**: Now, Queue (auto-time), Schedule (manual time)
- **Media**: Upload to S3 first, then to Twitter when posting
- **Edit = Delete + Recreate** with same threadId

## Database Queries Cheat Sheet

```sql
-- Get a thread
SELECT * FROM tweets WHERE threadId = ? ORDER BY position;

-- Get queued posts
SELECT * FROM tweets 
WHERE isScheduled = true AND isPosted = false 
ORDER BY scheduledFor;

-- Get posted content
SELECT * FROM tweets 
WHERE isPosted = true 
ORDER BY postedAt DESC;

-- Delete a thread
DELETE FROM tweets WHERE threadId = ?;
```

## API Endpoints Quick Reference

| Action | Endpoint | Key Parameters |
|--------|----------|----------------|
| Create | `POST /api/tweet/createThread` | `tweets: [{content, media, delayMs}]` |
| Update | `POST /api/tweet/updateThread` | `threadId, tweets: [...]` |
| Delete | `POST /api/tweet/deleteThread` | `threadId` |
| Post Now | `POST /api/tweet/postThreadNow` | `threadId` |
| Queue | `POST /api/tweet/enqueueThread` | `threadId, userNow, timezone` |
| Schedule | `POST /api/tweet/scheduleThread` | `threadId, scheduledUnix` |
| Get Thread | `GET /api/tweet/getTweet` | `id` (actually threadId) |
| Get Queue | `GET /api/tweet/get_queue` | `timezone, userNow` |

## React Query Cache Keys

```typescript
['thread', threadId]                    // Single thread
['threads-queue']                       // Queued posts
['threads-scheduled-published']         // All scheduled/posted
['threads-posted', account.username]    // User's posted content
```

## Common Patterns

### Creating a Thread
```typescript
const { threadId } = await createThread({ 
  tweets: [
    { content: "Tweet 1", media: [], delayMs: 0 },
    { content: "Tweet 2", media: [], delayMs: 1000 }
  ]
})
```

### Editing a Thread
```typescript
// 1. Fetch existing
const thread = await getTweet({ id: threadId })

// 2. Update
await updateThread({
  threadId,
  tweets: modifiedTweets
})
```

### Media Structure
```typescript
// In editor
media: [{
  s3Key: "uploads/image.jpg",
  media_id: "", // Empty until posted
  url: "https://bucket.s3.../uploads/image.jpg",
  type: "image"
}]

// After posting
media: [{
  s3Key: "uploads/image.jpg",
  media_id: "1234567890", // Twitter's ID
  url: "https://bucket.s3.../uploads/image.jpg",
  type: "image"
}]
```

## Environment Variables

### Required for Threads
- `DATABASE_URL` - PostgreSQL connection
- `QSTASH_*` - For scheduling
- `TWITTER_*` - All 9 Twitter keys
- `AWS_*` + `NEXT_PUBLIC_S3_BUCKET_NAME` - For media
- `WEBHOOK_URL` - For QStash callbacks (optional, defaults to site URL)

## Debug Checklist

### Thread Not Showing in Queue?
- Check `isScheduled = true`
- Check `isPosted = false`
- Check `scheduledFor` is set
- Check all tweets have same `threadId`

### Media Not Showing in Edit?
- Check `initialMedia` prop is passed
- Verify S3 URL is accessible
- Check media array structure matches expected format

### Post Failed?
- Check Twitter API keys
- Check rate limits
- Verify media uploaded successfully
- Check for Twitter API errors in logs

### Schedule Not Working?
- Verify QStash credentials
- Check webhook URL is accessible
- Verify Unix timestamp is in seconds (not milliseconds)
- Check QStash dashboard for failed jobs

## Quick SQL Fixes

```sql
-- Fix orphaned tweets
UPDATE tweets SET threadId = id WHERE threadId IS NULL;

-- Cancel scheduled post
UPDATE tweets 
SET isScheduled = false, scheduledFor = NULL, qstashId = NULL 
WHERE threadId = ?;

-- Mark as posted (if QStash succeeded but DB update failed)
UPDATE tweets 
SET isPosted = true, postedAt = NOW() 
WHERE threadId = ?;
```
