import { MediaLibraryItem as DbMediaLibraryItem } from '@/db/schema/media'

// Type extending the database type with computed properties
export interface MediaLibraryItem extends DbMediaLibraryItem {
  url: string // S3 URL for direct access
}

// Type for media selection in components
export interface SelectedMedia {
  id: string
  s3Key: string
  media_id: string
  url: string
  type: 'image' | 'gif' | 'video'
  filename: string
}

// Type for media filters
export interface MediaFilters {
  mediaType?: 'image' | 'gif' | 'video'
  search?: string
  isStarred?: boolean
}

// Type for pagination
export interface MediaPagination {
  limit: number
  offset: number
  total: number
  hasMore: boolean
}

// Type for media library response
export interface MediaLibraryResponse {
  items: MediaLibraryItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}
