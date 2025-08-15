import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  KEY_SPACE_COMMAND,
  $getRoot,
  LexicalNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import { useEffect, useState, useRef, useCallback } from 'react'
import { MentionNode2 } from '../nodes'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'

function $isMentionNode2(node: any): node is MentionNode2 {
  return node instanceof MentionNode2
}

function $processMentionsInText(textNode: LexicalNode) {
  if (!$isTextNode(textNode) || $isMentionNode2(textNode)) return

  const text = textNode.getTextContent()
  const mentionPattern = /@[\w]+/g
  const matches = [...text.matchAll(mentionPattern)]

  if (matches.length === 0) return

  let currentOffset = 0
  const nodesToInsert: LexicalNode[] = []

  for (const match of matches) {
    const matchStart = match.index!
    const matchEnd = matchStart + match[0].length

    if (matchStart > currentOffset) {
      const beforeText = text.slice(currentOffset, matchStart)
      if (beforeText) {
        nodesToInsert.push($createTextNode(beforeText))
      }
    }

    const mentionText = match[0]
    nodesToInsert.push(new MentionNode2(mentionText))

    currentOffset = matchEnd
  }

  if (currentOffset < text.length) {
    const afterText = text.slice(currentOffset)
    if (afterText) {
      nodesToInsert.push($createTextNode(afterText))
    }
  }

  if (nodesToInsert.length > 0) {
    for (const node of nodesToInsert) {
      textNode.insertBefore(node)
    }
    textNode.remove()
  }
}

// Simple autocomplete dropdown component
function AutocompleteDropdown({ 
  query, 
  position, 
  onSelect, 
  onClose,
  selectedIndex,
  onNavigate 
}: {
  query: string
  position: { x: number; y: number } | null
  onSelect: (username: string) => void
  onClose: () => void
  selectedIndex: number
  onNavigate: (direction: 'up' | 'down') => void
}) {
  console.log('🔍 AutocompleteDropdown rendering with query:', query, 'position:', position)
  
  const { data: userResults, isLoading } = useQuery({
    queryKey: ['mention-autocomplete', query],
    queryFn: async () => {
      if (!query || query.length < 1) return null
      console.log('📡 Fetching usernames for query:', query)
      
      try {
        const res = await client.tweet.getHandles.$get({
          query: query.replace('@', ''),
        })
        const { data } = await res.json()
        console.log('✅ Received user data:', data)
        return data
      } catch (error) {
        console.error('❌ Error fetching user handles:', error)
        return null
      }
    },
    enabled: !!query && query.length >= 1,
  })

  if (!position || !query) return null

  // Simple mock results for now if API fails
  const results = userResults ? [userResults] : []
  
  if (results.length === 0 && !isLoading) return null

  return (
    <div
      className="fixed z-[9999] bg-white border border-neutral-200 rounded-lg shadow-lg min-w-64 max-h-48 overflow-y-auto"
      style={{
        left: position.x,
        top: position.y + 20,
      }}
    >
      {isLoading ? (
        <div className="p-3 text-sm text-neutral-600">Loading...</div>
      ) : (
        results.map((user, index) => (
          <div
            key={user.username}
            className={`p-3 cursor-pointer hover:bg-neutral-100 flex items-center gap-3 ${
              index === selectedIndex ? 'bg-neutral-100' : ''
            }`}
            onClick={() => {
              console.log('👆 Selected user:', user.username)
              onSelect(user.username)
            }}
          >
            {user.profile_image_url && (
              <img 
                src={user.profile_image_url} 
                alt="" 
                className="w-8 h-8 rounded-full"
              />
            )}
            <div>
              <div className="font-medium text-sm">{user.name}</div>
              <div className="text-xs text-neutral-600">@{user.username}</div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default function MentionsPlugin() {
  const [editor] = useLexicalComposerContext()
  const [autocomplete, setAutocomplete] = useState<{
    query: string
    position: { x: number; y: number } | null
    selectedIndex: number
  }>({
    query: '',
    position: null,
    selectedIndex: 0,
  })

  console.log('🎯 MentionsPlugin current autocomplete state:', autocomplete)

  // Handle autocomplete selection
  const handleAutocompleteSelect = useCallback((username: string) => {
    console.log('🎉 Handling autocomplete selection:', username)
    
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()
      
      // If we're in a mention node, replace it
      if ($isMentionNode2(anchorNode)) {
        const newMentionNode = new MentionNode2(`@${username}`)
        anchorNode.replace(newMentionNode)
        
        // Move cursor after the mention
        const spaceNode = $createTextNode(' ')
        newMentionNode.insertAfter(spaceNode)
        selection.setTextNodeRange(spaceNode, 1, spaceNode, 1)
      }
      // If we're in a text node with partial mention
      else if ($isTextNode(anchorNode)) {
        const text = anchorNode.getTextContent()
        const offset = selection.anchor.offset
        const beforeCursor = text.slice(0, offset)
        const afterCursor = text.slice(offset)
        
        // Find the @ and replace everything after it
        const mentionMatch = beforeCursor.match(/@\w*$/)
        if (mentionMatch) {
          const mentionStart = beforeCursor.lastIndexOf('@')
          const beforeMention = beforeCursor.slice(0, mentionStart)
          
          // Split the text
          anchorNode.setTextContent(beforeMention)
          
          const mentionNode = new MentionNode2(`@${username}`)
          anchorNode.insertAfter(mentionNode)
          
          if (afterCursor) {
            const afterTextNode = $createTextNode(' ' + afterCursor)
            mentionNode.insertAfter(afterTextNode)
          } else {
            const spaceNode = $createTextNode(' ')
            mentionNode.insertAfter(spaceNode)
            selection.setTextNodeRange(spaceNode, 1, spaceNode, 1)
          }
        }
      }
    })

    // Hide autocomplete
    setAutocomplete({
      query: '',
      position: null,
      selectedIndex: 0,
    })
  }, [editor])

  // Handle keyboard navigation in autocomplete
  const handleKeyboardNavigation = useCallback((direction: 'up' | 'down') => {
    // For simplicity, just select the first result for now
    setAutocomplete(prev => ({
      ...prev,
      selectedIndex: 0,
    }))
  }, [])

  useEffect(() => {
    const removeTextContentListener = editor.registerTextContentListener(() => {
      editor.update(() => {
        const selection = $getSelection()

        if ($isRangeSelection(selection)) {
          const anchorNode = selection.anchor.getNode()
          
          // Check for partial mentions in regular text nodes
          if ($isTextNode(anchorNode) && !$isMentionNode2(anchorNode)) {
            const text = anchorNode.getTextContent()
            const offset = selection.anchor.offset
            const beforeCursor = text.slice(0, offset)
            
            console.log('📝 Text before cursor:', beforeCursor, 'offset:', offset)

            // Check for partial mention pattern @username
            const mentionMatch = beforeCursor.match(/@(\w*)$/)
            if (mentionMatch) {
              const query = mentionMatch[0] // includes the @
              const username = mentionMatch[1] // just the username part
              
              console.log('🎯 Found partial mention:', query, 'username:', username)
              
              // Get cursor position for dropdown
              const domSelection = window.getSelection()
              if (domSelection && domSelection.rangeCount > 0) {
                const range = domSelection.getRangeAt(0)
                const rect = range.getBoundingClientRect()
                
                console.log('📍 Cursor position:', rect.x, rect.y)
                
                setAutocomplete({
                  query: username, // Send just the username part to API
                  position: { x: rect.x, y: rect.y },
                  selectedIndex: 0,
                })
              }
              return
            }

            // If typing @ with nothing after, create mention node
            if (beforeCursor.endsWith('@') && !beforeCursor.match(/@\w/)) {
              const afterCursor = text.slice(offset)
              anchorNode.setTextContent(beforeCursor.slice(0, -1))
              const mentionNode = new MentionNode2('@')
              anchorNode.insertAfter(mentionNode)
              
              if (afterCursor) {
                const afterTextNode = $createTextNode(afterCursor)
                mentionNode.insertAfter(afterTextNode)
              }
              
              selection.setTextNodeRange(mentionNode, 1, mentionNode, 1)
              return
            }
          }
          
          // Check if we're typing in a mention node
          if ($isMentionNode2(anchorNode)) {
            const text = anchorNode.getTextContent()
            const offset = selection.anchor.offset
            
            console.log('✏️ Typing in mention node:', text, 'offset:', offset)
            
            if (text.startsWith('@')) {
              const username = text.slice(1) // Remove @ prefix
              
              // Get cursor position for dropdown
              const domSelection = window.getSelection()
              if (domSelection && domSelection.rangeCount > 0) {
                const range = domSelection.getRangeAt(0)
                const rect = range.getBoundingClientRect()
                
                setAutocomplete({
                  query: username,
                  position: { x: rect.x, y: rect.y },
                  selectedIndex: 0,
                })
              }
              return
            }
          }
        }
        
        // Hide autocomplete if no mention pattern found
        setAutocomplete(prev => ({
          ...prev,
          query: '',
          position: null,
        }))

        const root = $getRoot()
        const allNodes = root.getAllTextNodes()

        for (const node of allNodes) {
          $processMentionsInText(node)
        }
      })
    })

    const removeSpaceListener = editor.registerCommand(
      KEY_SPACE_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        const anchorNode = selection.anchor.getNode()

        if ($isMentionNode2(anchorNode)) {
          const offset = selection.anchor.offset
          const text = anchorNode.getTextContent()

          if (offset === text.length) {
            const spaceNode = $createTextNode(' ')
            anchorNode.insertAfter(spaceNode)
            selection.setTextNodeRange(spaceNode, 0, spaceNode, 1)
            return true
          } else {
            const beforeCursor = text.slice(0, offset)
            const afterCursor = text.slice(offset)

            anchorNode.setTextContent(beforeCursor)
            const textNode = $createTextNode(' ' + afterCursor)
            anchorNode.insertAfter(textNode)
            selection.setTextNodeRange(textNode, 0, textNode, 1)
            return true
          }
        }

        return false
      },
      3,
    )



    // Keyboard command handlers
    const removeEscapeListener = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (autocomplete.position) {
          console.log('❌ Escape pressed, hiding autocomplete')
          setAutocomplete({
            query: '',
            position: null,
            selectedIndex: 0,
          })
          return true
        }
        return false
      },
      1
    )

    const removeEnterListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        if (autocomplete.position && autocomplete.query) {
          console.log('⏎ Enter pressed in autocomplete')
          // For simplicity, just close for now - user can click
          setAutocomplete({
            query: '',
            position: null,
            selectedIndex: 0,
          })
          return true
        }
        return false
      },
      1
    )

    return () => {
      removeTextContentListener()
      removeSpaceListener()
      removeEscapeListener()
      removeEnterListener()
    }
  }, [editor, handleAutocompleteSelect, handleKeyboardNavigation])

  return (
    <>
      <AutocompleteDropdown
        query={autocomplete.query}
        position={autocomplete.position}
        selectedIndex={autocomplete.selectedIndex}
        onSelect={handleAutocompleteSelect}
        onClose={() => setAutocomplete({ query: '', position: null, selectedIndex: 0 })}
        onNavigate={handleKeyboardNavigation}
      />
    </>
  )
}
