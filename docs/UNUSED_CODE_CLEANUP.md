# Unused Code Cleanup Report

## 1. Unused Components & Files

### Complete Files to Remove
- `src/app/testimonials.tsx` - Testimonials component never imported
- `src/components/tweet-editor/test.tsx` - Test component never used
- `src/components/_context-document-editor.tsx` - Entire file is commented out

### Unused API Endpoints
- `recents` in `tweet-router.ts` - Not called from frontend

## 2. Unused Imports to Clean Up

### High Priority (UI Components)
- `src/app/invite/invite-client.tsx`: `Loader2`, `Twitter`
- `src/app/invite/success/page.tsx`: `CheckCircle`, `Users`
- `src/app/studio/settings/page.tsx`: `Avatar`, `AvatarFallback`, `AvatarImage`, `Button`, `Progress`, `Separator`
- `src/components/app-sidebar.tsx`: `RotateCcw`, `useQueryClient`
- `src/components/context-sidebar.tsx`: `Icons`
- `src/components/chat/loading-message.tsx`: `AnimatePresence`, `Bot`
- `src/components/chat/streaming-message.tsx`: `ReactMarkdown`, `Components`
- `src/components/chat/tweet-mockup.tsx`: `Icons`, `RotateCcw`
- `src/components/chat/website-mockup.tsx`: `Copy`

### Date/Time Utilities
- `src/app/studio/settings/page.tsx`: `format`, `isToday`, `isTomorrow`
- `src/server/routers/tweet-router.ts`: `addHours`, `isBefore`, `setDay`
- `src/components/tweet-list.tsx`: `isAfter`, `isPast`, `differenceInDays`
- `src/components/knowledge-selector.tsx`: `formatDistanceToNow`
- `src/components/media-library.tsx`: `formatDistanceToNow`

### Other Unused Imports
- `src/app/layout.tsx`: `track`
- `src/app/studio/knowledge/new/page.tsx`: `title` variable
- `src/app/studio/knowledge/page.tsx`: `FilePlus`
- `src/components/attachment-item.tsx`: `useAttachments`
- `src/components/tweet-editor/thread-tweet.tsx`: Multiple unused imports including `CalendarCog`, `Pen`, `Icons`, etc.
- `src/components/tweet-list.tsx`: Multiple UI components like `Calendar`, `Trash2`, `AlertCircle`, etc.

## 3. Large Blocks of Commented Code

### In `src/server/routers/tweet-router.ts`
- Lines 189-217: Old single tweet creation endpoint
- Lines 318-320: Deleted endpoint placeholder
- Multiple console.log statements commented throughout (1000+ lines)

### In `src/components/tweet-editor/image-tool.tsx`
- Lines 1185-1191: Commented theme display code

### In `src/lib/lexical-plugins/mention-tooltip-plugin.tsx`
- Lines 13-27: Commented query for fetching handles
- Lines 92-106: Commented loading/error states

### In `src/frontend/studio/knowledge/page.tsx`
- Lines 239-257: Large commented badge display section

### In `src/components/upgrade-drawer.tsx`
- Lines 142-148: Commented pricing display

## 4. Unused Variables

- `src/components/tweet-list.tsx`: `isDeleting`, `variables`, `handleDeleteScheduled`, `totalTweets`
- `src/components/tweet-queue.tsx`: `shadowEditor`, `setMediaFiles`, `chatId`, `isLoadingScheduled`, `scheduledData`
- `src/hooks/use-tweets.tsx`: `prevSave`, `searchParams`, `pathname`, `processPendingSaves`
- `src/lib/code-action-menu-plugin.tsx`: `isShown`, `normalizedLang`

## 5. Unused Type Definitions

- Various `@typescript-eslint/no-unused-vars` warnings for type imports that should be cleaned

## 6. Recommended Actions

### Phase 1: Safe Deletions (No dependencies)
1. Delete `src/app/testimonials.tsx`
2. Delete `src/components/tweet-editor/test.tsx`
3. Delete `src/components/_context-document-editor.tsx`
4. Remove `recents` endpoint from `tweet-router.ts`

### Phase 2: Import Cleanup
Run the following to auto-fix most unused imports:
```bash
npm run lint -- --fix
```

### Phase 3: Manual Code Cleanup
1. Remove large commented code blocks
2. Remove unused variables from components
3. Clean up console.log statements in production code

### Phase 4: Dependency Check
After cleanup, check if any npm packages can be removed from `package.json`

## Estimated Impact
- **Code reduction**: ~1000+ lines
- **Bundle size**: Potentially 5-10% smaller
- **Maintainability**: Significantly improved
- **Build time**: Marginally faster
