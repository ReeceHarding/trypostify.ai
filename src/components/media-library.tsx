'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { cn } from '@/lib/utils'
import { MediaLibraryItem, SelectedMedia, MediaFilters } from '@/types/media'
import { formatDistanceToNow } from 'date-fns'
import { 
  Search, 
  X, 
  Check, 
  Star, 
  Trash2, 
  ImageIcon, 
  VideoIcon, 
  FileIcon,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { Loader } from './ui/loader'
// Removed ScrollArea import - will use div with overflow
import { Badge } from './ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

interface MediaLibraryProps {
  onSelect: (media: SelectedMedia[]) => void
  maxSelection?: number
  selectedMedia?: SelectedMedia[]
  onClose?: () => void
}

const ITEMS_PER_PAGE = 20

export default function MediaLibrary({
  onSelect,
  maxSelection = 4,
  selectedMedia = [],
  onClose,
}: MediaLibraryProps) {
  const queryClient = useQueryClient()
  // No longer tracking selection since it's one-click
  const [search, setSearch] = useState('')
  const [mediaType, setMediaType] = useState<MediaFilters['mediaType']>()
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const offset = page * ITEMS_PER_PAGE

  // Fetch media library
  const { data, isLoading, isError } = useQuery({
    queryKey: ['media-library', { 
      limit: ITEMS_PER_PAGE, 
      offset, 
      mediaType, 
      search, 
      isStarred: showStarredOnly || undefined 
    }],
    queryFn: async () => {
      const res = await client.media.getMediaLibrary.$post({
        limit: ITEMS_PER_PAGE,
        offset,
        mediaType,
        search: search || undefined,
        isStarred: showStarredOnly || undefined,
      })
      if (!res.ok) throw new Error('Failed to load media library')
      return res.json()
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await client.media.deleteMedia.$post({ id })
      if (!res.ok) throw new Error('Failed to delete media')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
      setDeleteId(null)
    },
  })

  // Toggle star mutation
  const toggleStarMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await client.media.toggleStar.$post({ id })
      if (!res.ok) throw new Error('Failed to toggle star')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })

  // One-click selection - no need to track selection limits

  // Handle direct selection (one-click)
  const handleToggleSelect = useCallback((item: MediaLibraryItem) => {
    // Convert item to SelectedMedia format
    const selectedItem: SelectedMedia = {
      id: item.id,
      s3Key: item.s3Key,
      media_id: item.media_id,
      url: item.url,
      type: item.mediaType as 'image' | 'gif' | 'video',
      filename: item.filename,
    }

    // Immediately select this item and close
    onSelect([selectedItem])
    onClose?.()
  }, [onSelect, onClose])

  // No longer needed - using one-click selection

  // Media type icon
  const getMediaIcon = (type: string) => {
    switch (type) {
      case 'video':
        return <VideoIcon className="size-4" />
      case 'gif':
        return <FileIcon className="size-4" />
      default:
        return <ImageIcon className="size-4" />
    }
  }

  const totalPages = data ? Math.ceil(data.total / ITEMS_PER_PAGE) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Search media..."
              className="pl-10 rounded-full h-11"
            />
          </div>
          <Button
            size="duolingo-icon"
            variant={showStarredOnly ? 'primary' : 'secondary'}
            onClick={() => {
              setShowStarredOnly(!showStarredOnly)
              setPage(0)
            }}
          >
            <Star className={cn('size-4', showStarredOnly && 'fill-current')} />
          </Button>
        </div>

        {/* Filters */}
        <Tabs
          value={mediaType || 'all'}
          onValueChange={(value) => {
            setMediaType(value === 'all' ? undefined : value as MediaFilters['mediaType'])
            setPage(0)
          }}
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="image">Images</TabsTrigger>
            <TabsTrigger value="gif">GIFs</TabsTrigger>
            <TabsTrigger value="video">Videos</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader className="size-8" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-64 text-neutral-500">
            <AlertCircle className="size-12 mb-2" />
            <p>Failed to load media library</p>
          </div>
        ) : !data?.items.length ? (
          <div className="flex flex-col items-center justify-center h-64 text-neutral-500">
            <ImageIcon className="size-12 mb-2" />
            <p>No media found</p>
            {search && <p className="text-sm">Try adjusting your search</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
            {data.items.map((item) => {
              const isStarred = item.isStarred

              return (
                <div
                  key={item.id}
                  className="relative group rounded-lg overflow-hidden border cursor-pointer transition-colors border-neutral-200 hover:border-primary hover:shadow-sm"
                  onClick={() => handleToggleSelect(item)}
                >
                  {/* Media preview */}
                  <div className="aspect-square bg-neutral-100">
                    {item.mediaType === 'video' ? (
                      <video
                        src={item.url}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : (
                      <img
                        src={item.url}
                        alt={item.filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>

                  {/* Media type badge */}
                  {/* Hidden labels to reduce noise in compact mode */}

                  {/* Actions overlay */}
                  <div className="absolute inset-0 bg-neutral-950/0 group-hover:bg-neutral-950/40 transition-all flex items-end p-2 opacity-0 group-hover:opacity-100">
                    <div className="flex gap-1 w-full">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStarMutation.mutate(item.id)
                        }}
                        className="p-2 bg-card text-card-foreground rounded-md hover:bg-neutral-100 transition-colors border"
                      >
                        <Star className={cn('size-4', isStarred && 'fill-current text-yellow-500')} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteId(item.id)
                        }}
                        className="p-2 bg-card text-card-foreground rounded-md hover:bg-neutral-100 transition-colors ml-auto border"
                      >
                        <Trash2 className="size-4 text-error-500" />
                      </button>
                    </div>
                  </div>

                  {/* Intentionally omit filename to keep the overlay icon-only UI */}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="border-t p-4 flex items-center justify-between">
          <p className="text-sm text-neutral-600">
            Showing {offset + 1}-{Math.min(offset + ITEMS_PER_PAGE, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <Button
              size="duolingo-sm"
              variant="duolingo-secondary"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="duolingo-sm"
              variant="duolingo-secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t p-4 flex items-center justify-between">
        <p className="text-sm text-neutral-600">
          Click any item to add it to your post
        </p>
        <Button
          variant="duolingo-secondary"
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete media?</DialogTitle>
            <DialogDescription>
              This will permanently delete this media from your library. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="duolingo-secondary"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="duolingo-destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
