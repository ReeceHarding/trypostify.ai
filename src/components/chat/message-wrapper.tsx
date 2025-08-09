import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { PropsWithChildren } from 'react'
import { memo, useState } from 'react'
import { ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react'
import { AttachmentItem } from '../attachment-item'
import { AnimatedLogo } from './animated-logo'
import { Metadata } from '@/server/routers/chat/chat-router'
import { useChatContext } from '@/hooks/use-chat'

interface MessageWrapperProps extends PropsWithChildren {
  id: string
  metadata?: Metadata
  isUser: boolean
  className?: string
  disableAnimation?: boolean
  animateLogo?: boolean
  showOptions?: boolean
}

export const MessageWrapper = memo(
  ({
    id,
    metadata,
    children,
    isUser,
    className,
    disableAnimation = false,
    animateLogo = false,
    showOptions = false
  }: MessageWrapperProps) => {
    const { regenerate } = useChatContext()
    const [vote, setVote] = useState<'up' | 'down' | null>(null)

    return (
      <motion.div
        initial={disableAnimation ? false : { opacity: 0, y: 10 }}
        animate={disableAnimation ? false : { opacity: 1, y: 0 }}
        className={cn(
          'w-full flex flex-col gap-2',
          isUser
            ? 'justify-self-end items-end'
            : 'justify-self-start items-start',
        )}
      >
        {metadata?.attachments.map((attachment) => {
          return <AttachmentItem key={attachment.id} attachment={attachment} />
        })}

        <div
          className={cn(
            'w-full grid grid-cols-[40px,1fr] gap-3.5',
            isUser ? 'justify-self-end' : 'justify-self-start',
            className,
          )}
        >
          {!isUser && (
            <div className="flex-shrink-0 col-start-1 mt-1.5 size-10 bg-neutral-100 rounded-full flex items-center justify-center">
              <AnimatedLogo isAnimating={animateLogo} className="size-7 text-neutral-500" />
            </div>
          )}
          <div className="w-full col-start-2 flex-1 space-y-2">
            <div
              className={cn(
                'space-y-4 rounded-2xl',
                isUser
                  ? 'bg-neutral-800 p-3.5  w-fit justify-self-end text-white rounded-br-sm'
                  : 'text-neutral-800 pt-3.5 rounded-bl-sm',
              )}
            >
              {children}
              {!isUser && (
                <div className={cn("invisible flex justify-end items-center gap-1", {
                  "visible": Boolean(showOptions)
                })}>
                  <button
                    onClick={() => setVote(vote === 'up' ? null : 'up')}
                    className={cn(
                      'flex items-center justify-center size-7 rounded-lg transition-all duration-200 group',
                      vote === 'up'
                        ? 'text-success-600 bg-success-100'
                        : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100',
                    )}
                  >
                    <ThumbsUp className="size-3.5 transition-transform duration-200" />
                  </button>
                  <button
                    onClick={() => setVote(vote === 'down' ? null : 'down')}
                    className={cn(
                      'flex items-center justify-center size-7 rounded-lg transition-all duration-200 group',
                      vote === 'down'
                        ? 'text-error-600 bg-error-100'
                        : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100',
                    )}
                  >
                    <ThumbsDown className="size-3.5 transition-transform duration-200" />
                  </button>
                  <button className="flex items-center justify-center size-7 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-all duration-200 group">
                    <RotateCcw
                      onClick={() => {
                        regenerate({ messageId: id })
                      }}
                      className="size-3.5 transition-transform duration-200"
                    />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    )
  },
)

MessageWrapper.displayName = 'MessageWrapper'
