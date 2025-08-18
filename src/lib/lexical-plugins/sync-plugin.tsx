import useTweetMetadata from '@/hooks/use-tweet-metdata'
import { useTweets } from '@/hooks/use-tweet-composer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { useEffect, useRef } from 'react'

export function ShadowEditorSyncPlugin() {
  const [composerEditor] = useLexicalComposerContext()
  const { shadowEditor } = useTweetComposer()
  const { setCharCount, setContent } = useTweetMetadata()
  const isInitialized = useRef(false)
  const instanceId = useRef(Math.random().toString(36).substring(7))

  console.log('[SYNC_PLUGIN] Instance created', {
    instanceId: instanceId.current,
    hasComposerEditor: !!composerEditor,
    hasShadowEditor: !!shadowEditor,
    timestamp: new Date().toISOString(),
  })

  useEffect(() => {
    console.log('[SYNC_PLUGIN] useEffect running', {
      instanceId: instanceId.current,
      hasShadowEditor: !!shadowEditor,
      hasComposerEditor: !!composerEditor,
      shadowEditorKey: shadowEditor?._key,
      timestamp: new Date().toISOString(),
    })
    
    if (!shadowEditor || !composerEditor) return

    if (!isInitialized.current) {
      const shadowEditorState = shadowEditor.getEditorState()
      if (!shadowEditorState.isEmpty()) {
        const serializedState = shadowEditorState.toJSON()
        const parsedState = shadowEditor.parseEditorState(serializedState)
        composerEditor.setEditorState(parsedState)
      }

      isInitialized.current = true
    }

    const unregisterComposer = composerEditor.registerUpdateListener(
      ({ editorState, tags }) => {
        console.log('[SYNC_PLUGIN] composerEditor update listener triggered', {
          instanceId: instanceId.current,
          tags: Array.from(tags || []),
          hasSyncFromPersistent: tags?.has('sync-from-persistent'),
          timestamp: new Date().toISOString(),
        })

        if (!tags?.has('sync-from-persistent')) {
          const content = editorState.read(() => $getRoot().getTextContent())
          console.log('[SYNC_PLUGIN] Syncing from composer to shadow', {
            content,
            contentLength: content.length,
          })
          
          setContent(content)
          setCharCount(editorState.read(() => $getRoot().getTextContent()).length)

          // setCurrentTweet((prev) => ({
          //   ...prev,
          //   content: editorState.read(() => $getRoot().getTextContent()),
          // }))

          shadowEditor.setEditorState(editorState)
        } else {
          console.log('[SYNC_PLUGIN] Skipping sync from composer (has sync-from-persistent tag)')
        }
      },
    )

    console.log('[SYNC_PLUGIN] Registering shadowEditor update listener', {
      instanceId: instanceId.current,
      shadowEditorKey: shadowEditor._key,
      timestamp: new Date().toISOString(),
    })
    
    const unregisterPersistent = shadowEditor.registerUpdateListener(
      ({ editorState, tags }) => {
        console.log('[SYNC_PLUGIN] shadowEditor update listener triggered', {
          instanceId: instanceId.current,
          tags: Array.from(tags || []),
          hasForceSync: tags?.has('force-sync'),
          timestamp: new Date().toISOString(),
        })

        if (tags?.has('force-sync')) {
          const content = editorState.read(() => $getRoot().getTextContent())
          console.log('[SYNC_PLUGIN] Processing force-sync', {
            content,
            contentLength: content.length,
          })

          const serializedState = editorState.toJSON()
          const parsedState = shadowEditor.parseEditorState(serializedState)

          console.log('[SYNC_PLUGIN] About to update composerEditor')
          composerEditor.update(
            () => {
              console.log('[SYNC_PLUGIN] Inside composerEditor.update', {
                serializedState,
                tags: Array.from(tags || []),
              })
              composerEditor.setEditorState(parsedState)
              console.log('[SYNC_PLUGIN] composerEditor state set successfully')
            },
            { tag: 'sync-from-persistent' },
          )
          console.log('[SYNC_PLUGIN] composerEditor.update completed')
        }
      },
    )

    return () => {
      unregisterComposer()
      unregisterPersistent()
    }
  }, [shadowEditor, composerEditor])

  return null
}
