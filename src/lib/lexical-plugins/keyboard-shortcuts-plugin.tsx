import { useEffect, useState } from 'react'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
  LexicalEditor,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

interface KeyboardShortcutsPluginProps {
  onPost?: () => void
  onQueue?: () => void
  onActionTriggered?: (action: 'post' | 'queue') => void
  onActionComplete?: () => void
}

export function KeyboardShortcutsPlugin({ 
  onPost, 
  onQueue,
  onActionTriggered,
  onActionComplete
}: KeyboardShortcutsPluginProps) {
  const [editor] = useLexicalComposerContext()
  const [pendingAction, setPendingAction] = useState<'post' | 'queue' | null>(null)

  useEffect(() => {
    console.log('[KeyboardShortcuts] Plugin mounted with handlers:', { 
      hasOnPost: !!onPost, 
      hasOnQueue: !!onQueue,
      hasActionTriggered: !!onActionTriggered,
      hasActionComplete: !!onActionComplete
    })

    const removeCommand = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
        const metaKey = isMac ? event.metaKey : event.ctrlKey

        console.log('[KeyboardShortcuts] Key pressed:', {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          isMac,
          timestamp: new Date().toISOString()
        })

        // Command/Ctrl + Enter to post
        if (metaKey && event.key === 'Enter' && !event.shiftKey) {
          console.log('[KeyboardShortcuts] Post shortcut triggered (Cmd+Enter)')
          event.preventDefault()
          event.stopPropagation()
          
          // Immediate optimistic feedback
          setPendingAction('post')
          onActionTriggered?.('post')
          
          if (onPost) {
            console.log('[KeyboardShortcuts] Calling onPost handler')
            // Use a microtask to ensure immediate UI update
            Promise.resolve().then(() => {
              onPost()
              // Reset pending state after a brief delay to show feedback
              setTimeout(() => {
                setPendingAction(null)
                onActionComplete?.()
              }, 100)
            })
          } else {
            console.warn('[KeyboardShortcuts] No onPost handler provided')
            setPendingAction(null)
          }
          
          return true
        }

        // Command/Ctrl + Shift + P to queue
        if (metaKey && event.shiftKey && event.key.toLowerCase() === 'p') {
          console.log('[KeyboardShortcuts] Queue shortcut triggered (Cmd+Shift+P)')
          event.preventDefault()
          event.stopPropagation()
          
          // Immediate optimistic feedback
          setPendingAction('queue')
          onActionTriggered?.('queue')
          
          if (onQueue) {
            console.log('[KeyboardShortcuts] Calling onQueue handler')
            // Use a microtask to ensure immediate UI update
            Promise.resolve().then(() => {
              onQueue()
              // Reset pending state after a brief delay to show feedback
              setTimeout(() => {
                setPendingAction(null)
                onActionComplete?.()
              }, 100)
            })
          } else {
            console.warn('[KeyboardShortcuts] No onQueue handler provided')
            setPendingAction(null)
          }
          
          return true
        }

        return false
      },
      COMMAND_PRIORITY_NORMAL
    )

    return () => {
      console.log('[KeyboardShortcuts] Plugin unmounting, removing command listener')
      removeCommand()
    }
  }, [editor, onPost, onQueue, onActionTriggered, onActionComplete])

  // Visual feedback is handled by HotkeyFeedbackProvider, no need for duplicate popup
  return null
}
