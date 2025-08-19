import { firecrawl } from '@/lib/firecrawl'
import { redis } from '@/lib/redis'
import { InferToolOutput, tool } from 'ai'
import { TwitterApi } from 'twitter-api-v2'
import { z } from 'zod'

const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!).readOnly

const isTwitterUrl = (url: string): boolean => {
  return /^https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url)
}

const extractTweetId = (url: string): string | null => {
  const match = url.match(/\/status\/(\d+)/)
  return match?.[1] ? match[1] : null
}

export const create_read_website_content = ({ chatId }: { chatId: string }) =>
  tool({
    description: 'Scrape website content by URL',
    inputSchema: z.object({ website_url: z.string() }),
    execute: async ({ website_url }) => {
      const cacheKey = `website-cache:${encodeURIComponent(website_url)}`

      const cachedContent = await redis.get(cacheKey)
      if (cachedContent) {
        await redis.lpush(`website-contents:${chatId}`, cachedContent)
        return cachedContent as { url: string; title: string; content: string; ogImage?: string }
      }

      if (isTwitterUrl(website_url)) {
        const tweetId = extractTweetId(website_url)

        if (!tweetId) {
          throw new Error('Could not extract tweet ID from URL')
        }

        try {
          const res = await client.v2.tweets(tweetId, {
            'tweet.fields': ['id', 'text', 'created_at', 'author_id', 'note_tweet', 'entities'],
            'media.fields': ['url', 'preview_image_url'],
            'user.fields': ['username', 'profile_image_url', 'name'],
            expansions: ['author_id', 'referenced_tweets.id', 'attachments.media_keys'],
          })

          const [tweet] = res.data
          const includes = res.includes

          const author = includes?.users?.[0]
          // Get first media image if available
          const media = includes?.media?.[0]
          const ogImage = media?.url || media?.preview_image_url

          const tweetContent = {
            url: website_url,
            title: `Tweet by @${author?.username}`,
            content: `**${author?.name || 'Unknown'} (@${author?.username || 'unknown'})**\n\n${tweet?.text}`,
            ...(ogImage && { ogImage }),
          }

          await redis.setex(cacheKey, 86400, tweetContent)
          await redis.lpush(`website-contents:${chatId}`, tweetContent)

          return tweetContent
        } catch (error) {
          return {
            url: website_url,
            title: 'Error reading tweet',
            content: `There was an error reading this tweet.`,
          }
        }
      }

      const response = await firecrawl.scrapeUrl(website_url, {
        formats: ['markdown'],
      })

      if (response.success) {
        // Extract OG image from metadata
        const ogImage = response.metadata?.ogImage || response.metadata?.['og:image'] || response.metadata?.image

        // Filter out boilerplate and template content from markdown
        let cleanedContent = response.markdown || ''
        
        // Remove common boilerplate patterns
        cleanedContent = cleanedContent
          // Remove markdown images with placeholder services
          .replace(/!\[.*?\]\(https:\/\/.*?dicebear\.com.*?\)/g, '')
          .replace(/!\[.*?\]\(https:\/\/.*?placeholder.*?\)/g, '')
          .replace(/!\[.*?\]\(https:\/\/.*?example\.com.*?\)/g, '')
          .replace(/!\[.*?\]\(https:\/\/.*?lorem.*?\)/g, '')
          // Remove generic placeholder text
          .replace(/!\[.*?(placeholder|example|demo|sample|test).*?\]\(.*?\)/gi, '')
          // Remove navigation and boilerplate sections
          .replace(/^#+\s*(Navigation|Menu|Header|Footer|Sidebar).*$/gm, '')
          // Remove empty lines and clean up
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .trim()

        console.log('[READ_WEBSITE] Original content length:', response.markdown?.length || 0)
        console.log('[READ_WEBSITE] Cleaned content length:', cleanedContent.length)
        console.log('[READ_WEBSITE] Content preview:', cleanedContent.substring(0, 200) + '...')

        const websiteContent = {
          url: website_url,
          title: response.metadata?.title,
          content: cleanedContent,
          ...(ogImage && { ogImage }),
        }

        await redis.setex(cacheKey, 86400, websiteContent)
        await redis.lpush(`website-contents:${chatId}`, websiteContent)

        return websiteContent
      } else {
        const errorContent = {
          url: website_url,
          title: 'Error reading website',
          content: 'There was an error reading this website',
        }

        await redis.lpush(`website-contents:${chatId}`, errorContent)

        return errorContent
      }
    },
  })

export type WebsiteContent = InferToolOutput<
  ReturnType<typeof create_read_website_content>
>
