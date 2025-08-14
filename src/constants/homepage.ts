// Homepage video configuration
export const HOMEPAGE_VIDEO = {
  // Updated with new walkthrough video
  playbackId: 'EsbS7MBDCWyn8IPdnYPfKnv2v01500IQOY00YzXrkheM48',
  // Mux automatically generates thumbnails - just replace the playback ID in the URL
  getThumbnailUrl: (playbackId: string, time: number = 10) => 
    `https://image.mux.com/${playbackId}/thumbnail.png?time=${time}`,
}

// Other homepage content
export const HOMEPAGE_CONTENT = {
  title: 'Your content engine for growing on Twitter',
  subtitle: 'Postify helps you create, schedule & manage twitter content at scale. Perfect for busy founders & content managers.',
  ctaText: 'Start Posting More →',
  trustedByCount: '1,140',
}
