// src/lib/utils.ts

/**
 * Supported video platform patterns for URL detection
 */
const VIDEO_PATTERNS = [
  /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv)\//,
  /(?:tiktok\.com\/@[\w.-]+\/video\/|vm\.tiktok\.com\/)/,
  /(?:twitter\.com|x\.com)\/\w+\/status\//,
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/,
]

/**
 * Determine platform from video URL
 */
export function getPlatformFromUrl(videoUrl: string): string {
  if (videoUrl.includes('instagram')) return 'instagram'
  if (videoUrl.includes('tiktok')) return 'tiktok'
  if (videoUrl.includes('youtube') || videoUrl.includes('youtu.be')) return 'youtube'
  if (videoUrl.includes('twitter') || videoUrl.includes('x.com')) return 'twitter'
  return 'unknown'
}
