# Thread System Architecture Guide

## Core Concept: Thread-First Design

Everything in the system is a "thread" - single posts are just threads with one tweet. This unified approach simplifies the codebase and data model.

## Data Model

### Database Schema (`tweets` table)
```sql
- id: UUID (unique tweet ID)
- threadId: UUID (groups tweets into threads)
- position: integer (0-based order within thread)
- content: text (tweet content)
- media: JSON array [{s3Key, media_id, url, type}]
- isThreadStart: boolean (true for first tweet)
- isScheduled: boolean
- scheduledFor: timestamp (when to post)
- scheduledUnix: bigint (Unix timestamp in ms)
- qstashId: string (QStash message ID)
- isPosted: boolean
- postedAt: timestamp
- tweetId: string (Twitter's ID after posting)
- delayMs: integer (delay between tweets in thread)
```

### Key Relationships
- All tweets with same `threadId` belong to one thread
- `position` determines tweet order (0 = first)
- Single posts have `threadId` = `id` and `position` = 0

## Component Architecture

### Frontend Components

#### `ThreadTweetEditor` (`src/components/tweet-editor/thread-tweet-editor.tsx`)
- **Purpose**: Main container for creating/editing threads
- **State Management**: 
  - `threadTweets`: Array of {id, content, media}
  - Handles both create and edit modes
- **Key Functions**:
  - `handlePostThread()`: Post immediately
  - `handleQueueThread()`: Add to automated queue
  - `handleScheduleThread(date)`: Schedule for specific time
  - `handleUpdateThread()`: Update existing thread
- **Mutations**:
  - `createThreadMutation` → `/api/tweet/createThread`
  - `postThreadMutation` → `/api/tweet/postThreadNow`
  - `enqueueThreadMutation` → `/api/tweet/enqueueThread`
  - `scheduleThreadMutation` → `/api/tweet/scheduleThread`
  - `updateThreadMutation` → `/api/tweet/updateThread`

#### `ThreadTweet` (`src/components/tweet-editor/thread-tweet.tsx`)
- **Purpose**: Individual tweet within a thread
- **Features**:
  - Rich text editor (Lexical)
  - Media upload/management
  - Character count
  - @mention support
- **Props**:
  - `onPostThread`, `onQueueThread`, `onScheduleThread`: Only on first tweet
  - `initialContent`, `initialMedia`: For edit mode
  - `onUpdate(content, media)`: Bubbles changes to parent

#### `TweetQueue` (`src/components/tweet-queue.tsx`)
- **Purpose**: Display scheduled posts
- **Data Source**: `/api/tweet/get_queue` (queued) + `/api/tweet/getScheduledAndPublished` (manual)
- **Actions**:
  - Post now (`postThreadNowMutation`)
  - Delete (`deleteThreadMutation`)
  - Edit (navigates to editor)

#### `TweetList` (`src/components/tweet-list.tsx`)
- **Purpose**: Display posted content
- **Data Source**: `/api/tweet/getScheduledAndPublished?filter=posted`
- **Features**: Analytics, delete, view on X

## API Endpoints (`src/server/routers/tweet-router.ts`)

### Thread CRUD Operations

#### `createThread`
```typescript
POST /api/tweet/createThread
Body: { tweets: [{content, media, delayMs}] }
Returns: { threadId }
```
- Creates all tweets with same `threadId`
- Sets `position` based on array index
- Marks first tweet as `isThreadStart`

#### `updateThread`
```typescript
POST /api/tweet/updateThread
Body: { threadId, tweets: [{content, media}] }
```
- Deletes all existing tweets for threadId
- Recreates with new content
- Preserves scheduling info

#### `deleteThread`
```typescript
POST /api/tweet/deleteThread
Body: { threadId }
```
- Deletes all tweets with matching threadId
- Cancels QStash job if scheduled

### Scheduling Operations

#### `enqueueThread`
```typescript
POST /api/tweet/enqueueThread
Body: { threadId, userNow, timezone }
Returns: { slot: {time, dayName} }
```
- Finds next available slot (10am, 12pm, 2pm)
- Considers user's timezone
- Schedules via QStash

#### `scheduleThread`
```typescript
POST /api/tweet/scheduleThread
Body: { threadId, scheduledUnix }
```
- Manual scheduling for specific time
- Creates QStash job with `notBefore` timestamp

#### `postThreadNow`
```typescript
POST /api/tweet/postThreadNow
Body: { threadId }
Returns: { success, threadUrl }
```
- Posts immediately to Twitter/X
- Handles media uploads
- Posts tweets with delays
- Updates database with Twitter IDs

### Data Fetching

#### `get_queue`
```typescript
GET /api/tweet/get_queue?timezone=X&userNow=Y
Returns: { scheduledItems: [...] }
```
- Fetches all scheduled tweets
- Groups by threadId
- Sorts by scheduledFor time

#### `getScheduledAndPublished`
```typescript
GET /api/tweet/getScheduledAndPublished?filter=posted|scheduled
```
- Unified endpoint for all content
- Always returns thread-grouped data
- Supports filtering by status

## Media Handling

### Upload Flow
1. Frontend: File selected → `POST /api/file/upload`
2. Backend: Upload to S3 → Return `s3Key`
3. Frontend: Store `{s3Key}` in tweet media array
4. On Post: Upload to Twitter → Get `media_id`
5. Database: Store `{s3Key, media_id, url, type}`

### S3 Integration
- Bucket: `process.env.NEXT_PUBLIC_S3_BUCKET_NAME`
- URL Pattern: `https://[bucket].s3.amazonaws.com/[s3Key]`
- Types: image, gif, video (detected by content-type)

### Twitter Media Upload
```typescript
// In postThreadNow
const mediaData = await uploadMediaToTwitter(media, accessToken)
// Returns array of media_ids for Twitter API
```

## Queue System

### Slot Logic
- Slots: 10am, 12pm, 2pm (user's timezone)
- One post per slot maximum
- Skip weekends based on user preference
- Find next available slot algorithm in `findNextAvailableSlot()`

### QStash Integration
```typescript
qstash.publishJSON({
  url: baseUrl + '/api/tweet/postThread',
  body: { threadId, userId, accountId },
  notBefore: scheduledUnix, // Unix timestamp in seconds
})
```
- Webhook URL: `process.env.WEBHOOK_URL || getBaseUrl()`
- Stores `messageId` as `qstashId` in database

## State Management

### React Query Keys
- `['thread', threadId]` - Single thread data
- `['threads-queue']` - Queued posts
- `['threads-scheduled-published']` - All scheduled/posted
- `['threads-posted', username]` - User's posted content

### Cache Invalidation
After mutations, invalidate:
```typescript
queryClient.invalidateQueries({ queryKey: ['thread'] })
queryClient.invalidateQueries({ queryKey: ['threads-queue'] })
```

## Edit Mode Flow

1. User clicks edit on queued/scheduled post
2. Navigate to `/studio?edit=true&tweetId=[threadId]`
3. `ThreadTweetEditor` detects edit mode
4. Fetches thread via `getThreadQuery`
5. Populates editor with content and media
6. On save: `updateThreadMutation` preserves scheduling

## Key Design Decisions

1. **Thread-First**: No separate single tweet logic
2. **Soft Deletes**: Mark as posted, don't delete
3. **Position-Based Ordering**: Not timestamp-based
4. **S3 for Media**: Not stored in database
5. **QStash for Scheduling**: Reliable distributed scheduler
6. **UTC Storage**: Convert to user timezone on display

## Common Gotchas

1. **Media in Edit Mode**: Must map media array correctly with url, s3Key, media_id
2. **Thread vs Tweet ID**: `threadId` groups, `id` is unique per tweet
3. **Position Zero-Based**: First tweet is position 0, not 1
4. **Unix Timestamps**: QStash wants seconds, DB stores milliseconds
5. **Timezone Handling**: Always store UTC, display in user timezone

## Testing Checklist

- [ ] Create single post → Verify threadId = id
- [ ] Create multi-tweet thread → Verify same threadId, incrementing positions
- [ ] Edit thread → Verify all tweets updated
- [ ] Schedule thread → Verify QStash job created
- [ ] Queue thread → Verify slot assignment
- [ ] Post with media → Verify S3 upload and Twitter media_id
- [ ] Delete thread → Verify all tweets removed and QStash cancelled
- [ ] Edit scheduled thread → Verify schedule preserved
