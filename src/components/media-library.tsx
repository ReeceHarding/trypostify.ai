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
import DuolingoButton from './ui/duolingo-button'
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
  const [selected, setSelected] = useState<Set<string>>(
    new Set(selectedMedia.map(m => m.id))
  )
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

  // Calculate if we can select more items
  const canSelectMore = selected.size < maxSelection

  // Toggle selection
  const handleToggleSelect = useCallback((item: MediaLibraryItem) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else if (canSelectMore) {
        next.add(item.id)
      }
      return next
    })
  }, [canSelectMore])

  // Handle selection confirmation
  const handleConfirmSelection = useCallback(() => {
    if (!data?.items) return

    const selectedItems = data.items
      .filter(item => selected.has(item.id))
      .map(item => ({
        id: item.id,
        s3Key: item.s3Key,
        media_id: item.media_id,
        url: item.url,
        type: item.mediaType as 'image' | 'gif' | 'video',
        filename: item.filename,
      }))

    onSelect(selectedItems)
    onClose?.()
  }, [data?.items, selected, onSelect, onClose])

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
              className="pl-9"
            />
          </div>
          <DuolingoButton
            size="icon"
            variant={showStarredOnly ? 'primary' : 'secondary'}
            onClick={() => {
              setShowStarredOnly(!showStarredOnly)
              setPage(0)
            }}
          >
            <Star className={cn('size-4', showStarredOnly && 'fill-current')} />
          </DuolingoButton>
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
      <div className="flex-1 overflow-y-auto">
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
            {data.items.map((item) => {
              const isSelected = selected.has(item.id)
              const isStarred = item.isStarred

              return (
                <div
                  key={item.id}
                  className={cn(
                    'relative group rounded-lg overflow-hidden border-2 cursor-pointer transition-all',
                    isSelected
                      ? 'border-primary-600 shadow-lg'
                      : 'border-neutral-200 hover:border-neutral-300'
                  )}
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

                  {/* Selection indicator */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 bg-primary-600 text-white rounded-full p-1">
                      <Check className="size-4" />
                    </div>
                  )}

                  {/* Media type badge */}
                  <div className="absolute top-2 left-2">
                    <Badge variant="secondary" className="gap-1">
                      {getMediaIcon(item.mediaType)}
                      {item.mediaType}
                    </Badge>
                  </div>

                  {/* Actions overlay */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-end p-2 opacity-0 group-hover:opacity-100">
                    <div className="flex gap-1 w-full">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStarMutation.mutate(item.id)
                        }}
                        className="p-2 bg-white rounded hover:bg-neutral-100 transition-colors"
                      >
                        <Star className={cn('size-4', isStarred && 'fill-current text-yellow-500')} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteId(item.id)
                        }}
                        className="p-2 bg-white rounded hover:bg-neutral-100 transition-colors ml-auto"
                      >
                        <Trash2 className="size-4 text-error-500" />
                      </button>
                    </div>
                  </div>

                  {/* File info */}
                  <div className="p-2">
                    <p className="text-xs text-neutral-600 truncate">{item.filename}</p>
                    <p className="text-xs text-neutral-400">
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </p>
                  </div>
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
            <DuolingoButton
              size="sm"
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </DuolingoButton>
            <DuolingoButton
              size="sm"
              variant="secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="size-4" />
            </DuolingoButton>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t p-4 flex items-center justify-between">
        <p className="text-sm text-neutral-600">
          {selected.size} of {maxSelection} selected
        </p>
        <div className="flex gap-2">
          <DuolingoButton
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </DuolingoButton>
          <DuolingoButton
            onClick={handleConfirmSelection}
            disabled={selected.size === 0}
          >
            Add Selected
          </DuolingoButton>
        </div>
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
            <DuolingoButton
              variant="secondary"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </DuolingoButton>
            <DuolingoButton
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Delete'
              )}
            </DuolingoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
