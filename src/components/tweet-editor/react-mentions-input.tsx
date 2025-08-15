'use client'

import React, { useCallback, useState, useEffect } from 'react'
import { MentionsInput, Mention } from 'react-mentions'
import { client } from '@/lib/client'
import { cn } from '@/lib/utils'

interface ReactMentionsInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  onPaste?: (event: React.ClipboardEvent<Element>) => void
}

const ReactMentionsInput = React.forwardRef<any, ReactMentionsInputProps>(({
  value,
  onChange,
  placeholder = "What's happening?",
  className,
  disabled = false,
  onPaste,
}, ref) => {
  // Ensure value is always a string to prevent react-mentions from calling .replace() on undefined
  const safeValue = value ?? ''
  console.log('🎯 ReactMentionsInput rendering with value:', value, 'safeValue:', safeValue)

  // Fetch users for mentions
  const fetchUsers = useCallback(async (query: string, callback: (data: any[]) => void) => {
    console.log('📡 Fetching users for query:', query)
    
    // Ensure callback is a function
    if (typeof callback !== 'function') {
      console.warn('⚠️ Invalid callback provided to fetchUsers')
      return
    }
    
    // Ensure query is a string
    if (!query || typeof query !== 'string' || query.length < 1) {
      callback([])
      return
    }

    try {
      const res = await client.tweet.getHandles.$get({
        query: query.trim(),
      })
      const { data } = await res.json()
      
      console.log('✅ Received user data:', data)
      
      if (data && data.username) {
        // Format data for react-mentions with validation
        const formattedUsers = [{
          id: String(data.username || ''),
          display: `${data.name || ''} (@${data.username || ''})`,
          username: String(data.username || ''),
          name: String(data.name || ''),
          profile_image_url: data.profile_image_url || '',
        }]
        
        console.log('📋 Formatted users:', formattedUsers)
        callback(formattedUsers)
      } else {
        callback([])
      }
    } catch (error) {
      console.error('❌ Error fetching user handles:', error)
      callback([])
    }
  }, [])

  // Custom styles for react-mentions
  const mentionsInputStyle = {
    control: {
      backgroundColor: 'transparent',
      fontSize: '16px',
      fontWeight: 'normal',
      border: 'none',
      outline: 'none',
      minHeight: '64px',
      lineHeight: '1.75',
      color: '#1a1a1a',
      fontFamily: 'inherit',
    },
    '&multiLine': {
      control: {
        border: 'none',
        outline: 'none',
        minHeight: '64px',
        fontFamily: 'inherit',
      },
      highlighter: {
        padding: 0,
        border: 'none',
        outline: 'none',
      },
      input: {
        padding: 0,
        border: 'none',
        outline: 'none',
        fontFamily: 'inherit',
        fontSize: '16px',
        lineHeight: '1.75',
        color: '#1a1a1a',
        backgroundColor: 'transparent',
        resize: 'none',
      },
    },
    suggestions: {
      list: {
        backgroundColor: 'white',
        border: '1px solid #e5e5e5',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        maxHeight: '200px',
        overflow: 'auto',
        zIndex: 9999,
      },
      item: {
        padding: '12px 16px',
        borderBottom: '1px solid #f5f5f5',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        '&focused': {
          backgroundColor: '#f5f5f5',
        },
      },
    },
  }

  const mentionStyle = {
    backgroundColor: 'rgba(29, 161, 242, 0.2)',
    color: '#1da1f2',
    fontWeight: '500',
    borderRadius: '2px',
    padding: '0 2px',
  }

  // Custom suggestion renderer with profile images
  const renderSuggestion = (suggestion: any, search: string, highlightedDisplay: React.ReactNode, index: number, focused: boolean) => {
    console.log('🎨 Rendering suggestion:', suggestion, 'focused:', focused)
    
    // Ensure suggestion object is valid
    if (!suggestion || typeof suggestion !== 'object') {
      console.warn('⚠️ Invalid suggestion object:', suggestion)
      return null
    }
    
    return (
      <div 
        className={cn(
          'flex items-center gap-3 p-3 cursor-pointer border-b border-neutral-100 last:border-b-0',
          focused && 'bg-neutral-50'
        )}
      >
        {suggestion.profile_image_url && (
          <img 
            src={suggestion.profile_image_url} 
            alt="" 
            className="w-8 h-8 rounded-full flex-shrink-0"
            onError={(e) => {
              // Hide image if it fails to load
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
        <div className="flex-1">
          <div className="font-medium text-sm text-neutral-900">{suggestion.name || ''}</div>
          <div className="text-xs text-neutral-600">@{suggestion.username || ''}</div>
        </div>
      </div>
    )
  }

  const handleChange = (event: { target: { value: string } }) => {
    // Ensure the event and value are valid
    if (!event || !event.target || typeof event.target.value !== 'string') {
      console.warn('⚠️ Invalid change event:', event)
      return
    }
    
    const newValue = event.target.value
    console.log('📝 Value changed:', newValue)
    onChange(newValue)
  }

  try {
    return (
      <div className={cn('w-full', className)}>
        <MentionsInput
          ref={ref}
          value={safeValue}
          onChange={handleChange}
          style={mentionsInputStyle}
          placeholder={placeholder}
          disabled={disabled}
          allowSpaceInQuery
          allowSuggestionsAboveCursor
          forceSuggestionsAboveCursor={false}
          onPaste={onPaste}
          className="w-full min-h-16 resize-none text-base leading-relaxed text-neutral-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
        >
          <Mention
            trigger="@"
            data={fetchUsers}
            style={mentionStyle}
            renderSuggestion={renderSuggestion}
            displayTransform={(id: string, display: string) => {
              try {
                // Ensure id is a string to prevent errors
                const safeId = typeof id === 'string' ? id : String(id || '')
                return `@${safeId}`
              } catch (error) {
                console.error('❌ Error in displayTransform:', error)
                return '@'
              }
            }}
          />
        </MentionsInput>
      </div>
    )
  } catch (error) {
    console.error('❌ Critical error in ReactMentionsInput:', error)
    // Fallback to a simple textarea
    return (
      <div className={cn('w-full', className)}>
        <textarea
          ref={ref}
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onPaste={onPaste}
          className="w-full min-h-16 resize-none text-base leading-relaxed text-neutral-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
        />
      </div>
    )
  }
})

ReactMentionsInput.displayName = 'ReactMentionsInput'

export default ReactMentionsInput
