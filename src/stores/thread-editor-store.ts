import { create } from 'zustand'
import { produce } from 'immer'

// MediaFile type definition (moved from use-tweets.tsx)
export interface MediaFile {
  file: File | null
  url: string
  type: 'image' | 'gif' | 'video'
  uploading: boolean
  uploaded: boolean
  media_id?: string
  media_key?: string
  s3Key?: string
  error?: string
  
  // Video processing fields
  isPending?: boolean
  pendingJobId?: string
  videoUrl?: string
  platform?: string
}

export interface ThreadTweetData {
  id: string
  content: string
  media: MediaFile[]
  charCount: number
}

interface ThreadEditorState {
  tweets: ThreadTweetData[]
  setTweets: (tweets: ThreadTweetData[]) => void
  addTweet: () => void
  removeTweet: (id: string) => void
  updateTweet: (id: string, content: string, media: MediaFile[]) => void
  updateTweetContent: (id: string, content: string) => void
  updateTweetMedia: (id: string, media: MediaFile[]) => void
  reset: () => void
  getTweetById: (id: string) => ThreadTweetData | undefined
  getTweetIndex: (id: string) => number
}

const createInitialTweet = (): ThreadTweetData => ({
  id: crypto.randomUUID(),
  content: '',
  media: [],
  charCount: 0,
})

// Initialize with empty array to prevent SSR hydration mismatch
// The component will initialize with a proper tweet on mount
export const useThreadEditorStore = create<ThreadEditorState>((set, get) => ({
  tweets: [],
  
  setTweets: (tweets) => {
    console.log('[ThreadEditorStore] setTweets called with:', tweets.length, 'tweets')
    set({ tweets })
  },
  
  addTweet: () => {
    console.log('[ThreadEditorStore] addTweet called')
    set(produce((state: ThreadEditorState) => {
      const newTweet = createInitialTweet()
      state.tweets.push(newTweet)
      console.log('[ThreadEditorStore] Added new tweet:', newTweet.id, 'Total tweets:', state.tweets.length)
    }))
  },
  
  removeTweet: (id) => {
    console.log('[ThreadEditorStore] removeTweet called for id:', id)
    set(produce((state: ThreadEditorState) => {
      const initialLength = state.tweets.length
      state.tweets = state.tweets.filter(tweet => tweet.id !== id)
      console.log('[ThreadEditorStore] Removed tweet:', id, 'Tweets before:', initialLength, 'after:', state.tweets.length)
    }))
  },
  
  updateTweet: (id, content, media) => {
    console.log('[ThreadEditorStore] updateTweet called for id:', id, 'content length:', content.length, 'media count:', media.length)
    set(produce((state: ThreadEditorState) => {
      const tweet = state.tweets.find(t => t.id === id)
      if (tweet) {
        tweet.content = content
        tweet.media = media
        tweet.charCount = content.length
        console.log('[ThreadEditorStore] Updated tweet:', id, 'new charCount:', tweet.charCount)
      } else {
        console.warn('[ThreadEditorStore] Tweet not found for update:', id)
      }
    }))
  },
  
  updateTweetContent: (id, content) => {
    console.log('[ThreadEditorStore] updateTweetContent called for id:', id, 'content length:', content.length)
    set(produce((state: ThreadEditorState) => {
      const tweet = state.tweets.find(t => t.id === id)
      if (tweet) {
        tweet.content = content
        tweet.charCount = content.length
        console.log('[ThreadEditorStore] Updated tweet content:', id, 'new charCount:', tweet.charCount)
      } else {
        console.warn('[ThreadEditorStore] Tweet not found for content update:', id)
      }
    }))
  },
  
  updateTweetMedia: (id, media) => {
    console.log('[ThreadEditorStore] updateTweetMedia called for id:', id, 'media count:', media.length)
    set(produce((state: ThreadEditorState) => {
      const tweet = state.tweets.find(t => t.id === id)
      if (tweet) {
        tweet.media = media
        console.log('[ThreadEditorStore] Updated tweet media:', id, 'media items:', media.length)
      } else {
        console.warn('[ThreadEditorStore] Tweet not found for media update:', id)
      }
    }))
  },
  
  reset: () => {
    console.log('[ThreadEditorStore] reset called')
    const initialTweet = createInitialTweet()
    set({ tweets: [initialTweet] })
    console.log('[ThreadEditorStore] Reset to single tweet:', initialTweet.id)
  },
  
  getTweetById: (id) => {
    const tweet = get().tweets.find(t => t.id === id)
    console.log('[ThreadEditorStore] getTweetById called for:', id, 'found:', !!tweet)
    return tweet
  },
  
  getTweetIndex: (id) => {
    const index = get().tweets.findIndex(t => t.id === id)
    console.log('[ThreadEditorStore] getTweetIndex called for:', id, 'index:', index)
    return index
  },
}))
