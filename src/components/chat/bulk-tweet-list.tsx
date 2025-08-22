import { PropsWithChildren, memo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import { Check, Copy, ChevronsLeft, ListPlus, Edit2, Trash2 } from 'lucide-react'
import DuolingoButton from '../ui/duolingo-button'
import { useTweets } from '@/hooks/use-tweets'
import { usePathname, useRouter } from 'next/navigation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import DuolingoCheckbox from '../ui/duolingo-checkbox'

interface Tweet {
  id: string
  text: string
  index: number
  isOriginal?: boolean
}

interface BulkTweetListProps {
  tweets: Tweet[]
  isLoading?: boolean
  onQueueAll?: (tweetIds?: string[]) => void
  onEditAll?: (tweetIds?: string[]) => void
  onDeleteSelected?: (tweetIds: string[]) => void
  title?: string
}

export const BulkTweetList = memo(
  ({ tweets, isLoading = false, onQueueAll, onEditAll, onDeleteSelected, title }: BulkTweetListProps) => {
    const { setTweetContent } = useTweets()
    const router = useRouter()
    const pathname = usePathname()
    const isMobile = useIsMobile()
    const { setOpenMobile } = useSidebar()
    const [selectedTweets, setSelectedTweets] = useState<Set<string>>(new Set())
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // Clear selection when tweets change
    useEffect(() => {
      setSelectedTweets(new Set())
    }, [tweets])

    const handleSelectAll = () => {
      if (selectedTweets.size === tweets.filter(t => !t.isOriginal).length) {
        setSelectedTweets(new Set())
      } else {
        setSelectedTweets(new Set(tweets.filter(t => !t.isOriginal).map(t => t.id)))
      }
    }

    const handleSelectTweet = (tweetId: string) => {
      const newSelected = new Set(selectedTweets)
      if (newSelected.has(tweetId)) {
        newSelected.delete(tweetId)
      } else {
        newSelected.add(tweetId)
      }
      setSelectedTweets(newSelected)
    }

    const handleApplyTweet = (text: string) => {
      if (!text) return
      setTweetContent(text)
      if (isMobile) {
        try { setOpenMobile(false) } catch {}
      }
      if (pathname !== '/studio') {
        router.push('/studio')
      }
    }

    const handleCopyTweet = async (id: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      } catch (err) {
        console.error('Failed to copy tweet:', err)
      }
    }

    const handleQueueSelected = () => {
      const ids = selectedTweets.size > 0 ? Array.from(selectedTweets) : undefined
      onQueueAll?.(ids)
    }

    const handleEditSelected = () => {
      const ids = selectedTweets.size > 0 ? Array.from(selectedTweets) : undefined
      onEditAll?.(ids)
    }

    const handleDeleteSelected = () => {
      if (selectedTweets.size > 0) {
        onDeleteSelected?.(Array.from(selectedTweets))
      }
    }

    const filteredTweets = tweets.filter(t => !t.isOriginal)
    const hasSelection = selectedTweets.size > 0

    return (
      <div className="w-full space-y-3">
        {/* Header with bulk actions */}
        <div className="flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-700">
              {title || `${filteredTweets.length} Tweets Generated`}
            </h3>
            {filteredTweets.length > 0 && (
              <DuolingoCheckbox
                checked={selectedTweets.size === filteredTweets.length}
                onCheckedChange={handleSelectAll}
                className="ml-2"
              />
            )}
          </div>
          
          {!isLoading && filteredTweets.length > 0 && (
            <div className="flex items-center gap-2">
              {hasSelection && (
                <>
                  <span className="text-xs text-neutral-500">
                    {selectedTweets.size} selected
                  </span>
                  {onDeleteSelected && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DuolingoButton
                            onClick={handleDeleteSelected}
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-xs"
                          >
                            <Trash2 className="size-3" />
                          </DuolingoButton>
                        </TooltipTrigger>
                        <TooltipContent>Delete selected</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </>
              )}
              {onEditAll && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DuolingoButton
                        onClick={handleEditSelected}
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs"
                      >
                        <Edit2 className="size-3 mr-1" />
                        Edit {hasSelection ? 'Selected' : 'All'}
                      </DuolingoButton>
                    </TooltipTrigger>
                    <TooltipContent>Edit {hasSelection ? 'selected tweets' : 'all tweets'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {onQueueAll && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DuolingoButton
                        onClick={handleQueueSelected}
                        variant="primary"
                        size="sm"
                        className="h-7 px-2 text-xs"
                      >
                        <ListPlus className="size-3 mr-1" />
                        Queue {hasSelection ? 'Selected' : 'All'}
                      </DuolingoButton>
                    </TooltipTrigger>
                    <TooltipContent>Queue {hasSelection ? 'selected tweets' : 'all tweets'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </div>

        {/* Scrollable tweet list */}
        <div className="max-h-[60vh] overflow-y-auto space-y-2 px-2">
          <AnimatePresence mode="popLayout">
            {tweets.map((tweet, index) => (
              <motion.div
                key={tweet.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15, delay: index * 0.02 }}
                className={cn(
                  "relative rounded-xl border bg-white p-3 shadow-sm transition-all",
                  tweet.isOriginal ? "border-primary/30 bg-primary/5" : "border-neutral-200",
                  selectedTweets.has(tweet.id) && "ring-2 ring-primary/50"
                )}
              >
                {/* Original tweet badge */}
                {tweet.isOriginal && (
                  <div className="absolute top-2 right-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      Original
                    </span>
                  </div>
                )}

                {/* Selection checkbox */}
                {!tweet.isOriginal && (
                  <div className="absolute top-3 left-3">
                    <DuolingoCheckbox
                      checked={selectedTweets.has(tweet.id)}
                      onCheckedChange={() => handleSelectTweet(tweet.id)}
                      className="size-4"
                    />
                  </div>
                )}

                {/* Tweet content */}
                <div className={cn("space-y-2", !tweet.isOriginal && "pl-7")}>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed">
                    {tweet.text}
                  </p>
                  
                  {/* Actions */}
                  {!tweet.isOriginal && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DuolingoButton
                              onClick={() => handleApplyTweet(tweet.text)}
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                            >
                              <ChevronsLeft className="size-3 mr-0.5" />
                              Apply
                            </DuolingoButton>
                          </TooltipTrigger>
                          <TooltipContent>Use this tweet in the editor</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DuolingoButton
                              onClick={() => handleCopyTweet(tweet.id, tweet.text)}
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                            >
                              {copiedId === tweet.id ? (
                                <>
                                  <Check className="size-3 mr-0.5" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3 mr-0.5" />
                                  Copy
                                </>
                              )}
                            </DuolingoButton>
                          </TooltipTrigger>
                          <TooltipContent>Copy to clipboard</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    )
  }
)

BulkTweetList.displayName = 'BulkTweetList'
