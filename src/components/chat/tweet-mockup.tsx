import { PropsWithChildren, memo, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Icons } from '../icons'
import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import { ChevronsLeft, RotateCcw } from 'lucide-react'
import DuolingoButton from '../ui/duolingo-button'
import { useTweets } from '@/hooks/use-tweets'
import { usePathname, useRouter } from 'next/navigation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

export const TweetMockup = memo(
  ({
    children,
    text,
    isLoading = false,
  }: PropsWithChildren<{ isLoading?: boolean; text?: string }>) => {
    const { setTweetContent } = useTweets()
    const router = useRouter()
    const pathname = usePathname()
    
    const containerVariants = {
      hidden: { opacity: 0, y: 20, scale: 0.95 },
      visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
          duration: 0.6,
          staggerChildren: 0.1,
          delayChildren: 0.2,
        },
      },
    }

    const apply = () => {
      if (!text) return
      // Simply set the content directly - no need for complex editor synchronization
      setTweetContent(text)
      try {
        console.log(
          `[${new Date().toISOString()}] [TweetMockup] Apply clicked`,
          { pathname, textLen: text.length },
        )
      } catch {}

      // If we're not on the create page, navigate there so the editor can pick up the content
      if (pathname !== '/studio') {
        router.push('/studio')
      }
    }

    const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const metaKey = isMac ? 'Cmd' : 'Ctrl'

    // Keyboard shortcut for Apply
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const actualMetaKey = isMac ? e.metaKey : e.ctrlKey

        // Apply: Cmd/Ctrl + Shift + E (for "Execute/Apply")
        if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 'e' && text && !isLoading) {
          e.preventDefault()
          apply()
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [text, isLoading, isMac])

    return (
      <motion.div
        variants={isLoading ? containerVariants : undefined}
        initial={isLoading ? 'hidden' : false}
        animate={isLoading ? 'visible' : false}
        className="w-full min-w-0 py-3 px-4 rounded-2xl border border-black border-opacity-[0.01] bg-clip-padding group isolate bg-white shadow-[var(--shadow-twitter)]"
      >
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <AccountAvatar className="size-8" />
            <div className="flex flex-col">
              <AccountName animate className="leading-[1.2] text-sm" />
              <AccountHandle className="text-sm leading-[1.2]" />
            </div>
          </div>

          {!isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
              }}
              className="flex items-center gap-2"
            >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DuolingoButton
                    onClick={apply}
                    variant="secondary"
                    size="sm"
                    className="text-sm w-fit h-8 px-2"
                  >
                    <ChevronsLeft className="size-4 mr-1" /> Apply
                  </DuolingoButton>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1">
                    <p>Apply AI-generated content</p>
                    <p className="text-xs text-neutral-400">
                      {metaKey} + Shift + E
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            </motion.div>
          )}
        </div>

        <div className="w-full flex flex-col items-start">
          <div className="w-full flex-1 py-2.5">
            <div className="mt-1 text-slate-800 text-[15px] space-y-3 whitespace-pre-wrap">
              {isLoading ? (
                <div className="space-y-2">
                  <motion.div
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="h-4 bg-neutral-200 rounded animate-pulse"
                    style={{ width: '85%' }}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                    className="h-4 bg-neutral-200 rounded animate-pulse"
                    style={{ width: '92%' }}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.3 }}
                    className="h-4 bg-neutral-200 rounded animate-pulse"
                    style={{ width: '78%' }}
                  />
                </div>
              ) : (
                children
              )}
            </div>
          </div>
        </div>
      </motion.div>
    )
  },
)

TweetMockup.displayName = 'TweetMockup'
