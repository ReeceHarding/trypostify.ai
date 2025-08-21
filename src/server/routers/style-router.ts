import { redis } from '@/lib/redis'
import { HTTPException } from 'hono/http-exception'
import { TwitterApi } from 'twitter-api-v2'
import { z } from 'zod'
import { j, privateProcedure } from '../jstack'
import { getAccount } from './utils/get-account'

type Author = {
  profile_image_url: string
  username: string
  name: string
}

export type Tweet = {
  author: Author
  author_id: string
  created_at: string
  edit_history_tweet_ids: string[]
  id: string
  text: string
}

export type Style = {
  tweets: Tweet[]
  prompt: string | null
  connectedAccount?: {
    username: string
    name: string
    profile_image_url: string
    id: string
    verified: boolean
  }
}

const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!).readOnly

export const styleRouter = j.router({
  get: privateProcedure.query(async ({ c, input, ctx }) => {
    const { user } = ctx

    const account = await getAccount({
      email: user.email,
    })

    if (!account?.id) {
      throw new HTTPException(400, {
        message: 'Please connect your Twitter account',
      })
    }

    let style: Style | null = null
    const styleKey = `style:${user.email}:${account?.id}`

    console.log('[STYLE_ROUTER] ===== STYLE GET DEBUG =====')
    console.log('[STYLE_ROUTER] Style key:', styleKey)
    console.log('[STYLE_ROUTER] User email:', user.email)
    console.log('[STYLE_ROUTER] Account ID:', account?.id)

    style = await redis.json.get<Style>(styleKey)

    console.log('[STYLE_ROUTER] Style retrieved:', !!style)
    console.log('[STYLE_ROUTER] Style tweets count:', style?.tweets?.length || 0)
    console.log('[STYLE_ROUTER] Style prompt exists:', !!style?.prompt)
    console.log('[STYLE_ROUTER] ===== END STYLE GET DEBUG =====')

    if (!style) {
      console.log('[STYLE_ROUTER] No style found, returning empty style')
      return c.json({
        tweets: [] as Tweet[],
        prompt: null,
      })
    }

    return c.json({ ...style, tweets: (style.tweets ?? []).reverse() })
  }),
  import: privateProcedure
    .input(
      z.object({
        link: z.string().min(1).max(200),
        prompt: z.string().optional(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { link, prompt } = input

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your Twitter account',
        })
      }

      // Extract tweet ID from Twitter link
      const tweetIdMatch =
        link.match(/twitter\.com\/\w+\/status\/(\d+)/i) ||
        link.match(/x\.com\/\w+\/status\/(\d+)/i)

      if (!tweetIdMatch || !tweetIdMatch[1]) {
        throw new HTTPException(400, {
          message:
            'Invalid Twitter link format. Please provide a direct link to a tweet.',
        })
      }

      const tweetId = tweetIdMatch[1]

      // Fetch the specific tweet
      const res = await client.v2.tweets(tweetId, {
        'tweet.fields': ['id', 'text', 'created_at', 'author_id', 'note_tweet'],
        'user.fields': ['username', 'profile_image_url', 'name'],
        expansions: ['author_id', 'referenced_tweets.id'],
      })

      const [tweet] = res.data
      const includes = res.includes

      if (!tweet) {
        throw new HTTPException(404, {
          message: 'Tweet not found',
        })
      }

      // const author = includes?.users?.[0]
      const author = includes?.users?.find((user) => user.id === tweet.author_id)

      const tweetText = tweet.note_tweet?.text ?? tweet.text

      // Clean up tweet text by removing image links
      const cleanedTweet = {
        ...tweet,
        text: tweetText.replace(/https:\/\/t\.co\/\w+/g, '').trim(),
        author: author
          ? {
              username: author.username,
              profile_image_url: author.profile_image_url,
              name: author.name,
            }
          : null,
      }

      const styleKey = `style:${user.email}:${account?.id}`
      const currentStyle = await redis.json.get<Style>(styleKey)

      if (!currentStyle) {
        await redis.json.set(styleKey, '$', {
          tweets: [cleanedTweet],
          prompt: prompt || null,
        })
      } else {
        const currentTweets = currentStyle?.tweets || []

        const updatedTweets = [...currentTweets, cleanedTweet]

        await redis.json.set(styleKey, '$.tweets', updatedTweets)

        if (prompt) {
          await redis.json.set(styleKey, '$.prompt', prompt)
        }
      }

      const updatedStyle = await redis.json.get<Style>(styleKey)

      return c.json({
        tweets: updatedStyle?.tweets || [],
      })
    }),
  delete: privateProcedure
    .input(
      z.object({
        tweetId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { tweetId } = input

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your Twitter account',
        })
      }

      const styleKey = `style:${user.email}:${account?.id}`
      const styleExists = await redis.exists(styleKey)

      if (!styleExists) {
        throw new HTTPException(404, {
          message: 'No style found for this user',
        })
      }

      const currentStyle = await redis.json.get<Style>(styleKey)
      const currentTweets = currentStyle?.tweets || []

      const updatedTweets = currentTweets.filter((tweet) => tweet.id !== tweetId)

      await redis.json.set(styleKey, '$.tweets', updatedTweets)

      return c.json({
        tweets: updatedTweets,
      })
    }),
  save: privateProcedure
    .input(
      z.object({
        prompt: z.string().optional(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { prompt } = input

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your Twitter account',
        })
      }
      const styleKey = `style:${user.email}:${account.id}`

      console.log('[STYLE_ROUTER] ===== STYLE SAVE DEBUG =====')
      console.log('[STYLE_ROUTER] Saving prompt to key:', styleKey)
      console.log('[STYLE_ROUTER] Prompt content:', JSON.stringify(prompt))
      console.log('[STYLE_ROUTER] Prompt length:', prompt?.length || 0)

      if (typeof prompt !== 'undefined') {
        const exists = await redis.exists(styleKey)
        console.log('[STYLE_ROUTER] Style key exists:', exists)
        
        if (!exists) {
          await redis.json.set(styleKey, '$', { tweets: [], prompt })
          console.log('[STYLE_ROUTER] Created new style with prompt')
        } else {
          await redis.json.merge(styleKey, '$', { prompt })
          console.log('[STYLE_ROUTER] Updated existing style prompt')
        }
        
        // Verify the save
        const verifyStyle = await redis.json.get<any>(styleKey)
        console.log('[STYLE_ROUTER] Verification - prompt saved:', verifyStyle?.prompt === prompt)
        console.log('[STYLE_ROUTER] Verification - tweets count:', verifyStyle?.tweets?.length || 0)
      }
      
      console.log('[STYLE_ROUTER] ===== END STYLE SAVE DEBUG =====')
      
      return c.json({
        success: true,
      })
    }),
})
