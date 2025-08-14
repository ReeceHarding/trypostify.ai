// Homepage video configuration
export const HOMEPAGE_VIDEO = {
  // Replace this with your new Mux playback ID
  playbackId: '01ddBxgG7W53ZCMZ02LLP692sLD4w009XzUtoCd00NcSBO8',
  // Mux automatically generates thumbnails - just replace the playback ID in the URL
  getThumbnailUrl: (playbackId: string, time: number = 10) => 
    `https://image.mux.com/${playbackId}/thumbnail.png?time=${time}`,
}

// Other homepage content
export const HOMEPAGE_CONTENT = {
  title: 'Your content engine for growing on Twitter',
  subtitle: 'Postify helps you create, schedule & manage twitter content at scale. Perfect for busy founders & content managers.',
  ctaText: 'Start Posting More →',
  trustedByCount: '1.140',
}
