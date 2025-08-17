import { client } from '@/lib/client'
import { MyUIMessage } from '@/server/routers/chat/chat-router'
import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { DefaultChatTransport } from 'ai'
import { nanoid } from 'nanoid'
import { Options, useQueryState } from 'nuqs'
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'

interface ChatContext extends ReturnType<typeof useChat<MyUIMessage>> {
  startNewChat: (id?: string) => Promise<void>
  setId: (
    value: string | ((old: string) => string | null) | null,
    options?: Options,
  ) => Promise<URLSearchParams>
}

const ChatContext = createContext<ChatContext | null>(null)

// Important: Use a stable SSR-safe default so server and client render the same initial HTML.
// We then generate a real id on the client after hydration.
const defaultValue = ''

export const ChatProvider = ({ children }: PropsWithChildren) => {
  const [id, setId] = useQueryState('chatId', {
    defaultValue,
  })

  // After first client render, if no id exists, generate one and update the URL.
  useEffect(() => {
    if (!id) {
      // Defer to next tick to avoid interfering with hydration
      Promise.resolve().then(() => {
        void setId(nanoid())
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startNewChat = async (id?: string) => {
    setId(nanoid())
  }

  const chat = useChat<MyUIMessage>({
    id,
    transport: new DefaultChatTransport({
      api: '/api/chat/chat',
      prepareSendMessagesRequest({ messages, id }) {
        return { body: { message: messages[messages.length - 1], id } }
      },
    }),
    messages: [],
    onError: ({ message }) => {
      toast.error(message)
    },
  })

  const { data } = useQuery({
    queryKey: ['initial-messages', id],
    queryFn: async () => {
      const res = await client.chat.get_message_history.$get({ chatId: id })
      const data = await res.json()

      return data
    },
    initialData: { messages: [] },
  })

  useEffect(() => {
    chat.setMessages(data.messages)
  }, [data])

  const contextValue = useMemo(() => ({ 
    ...chat, 
    startNewChat, 
    setId 
  }), [chat, startNewChat, setId])

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChatContext() {
  const context = useContext(ChatContext)

  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }

  return context
}
