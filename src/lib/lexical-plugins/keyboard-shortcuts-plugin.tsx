import { useEffect } from 'react'
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
}

export function KeyboardShortcutsPlugin({ 
  onPost, 
  onQueue 
}: KeyboardShortcutsPluginProps) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    console.log('[KeyboardShortcuts] Plugin mounted with handlers:', { 
      hasOnPost: !!onPost, 
      hasOnQueue: !!onQueue 
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
          
          if (onPost) {
            console.log('[KeyboardShortcuts] Calling onPost handler')
            onPost()
          } else {
            console.warn('[KeyboardShortcuts] No onPost handler provided')
          }
          
          return true
        }

        // Command/Ctrl + Shift + P to queue
        if (metaKey && event.shiftKey && event.key.toLowerCase() === 'p') {
          console.log('[KeyboardShortcuts] Queue shortcut triggered (Cmd+Shift+P)')
          event.preventDefault()
          event.stopPropagation()
          
          if (onQueue) {
            console.log('[KeyboardShortcuts] Calling onQueue handler')
            onQueue()
          } else {
            console.warn('[KeyboardShortcuts] No onQueue handler provided')
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
  }, [editor, onPost, onQueue])

  return null
}
