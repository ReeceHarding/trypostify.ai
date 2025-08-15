'use client'

import React, { createContext, useContext, useState, ReactNode } from 'react'

interface HotkeyFeedbackState {
  navigation: string | null
  action: 'post' | 'queue' | 'schedule' | null
}

interface HotkeyFeedbackContextType {
  state: HotkeyFeedbackState
  showNavigation: (destination: string) => void
  showAction: (action: 'post' | 'queue' | 'schedule') => void
  clearNavigation: () => void
  clearAction: () => void
  clearAll: () => void
}

const HotkeyFeedbackContext = createContext<HotkeyFeedbackContextType | null>(null)

export function useHotkeyFeedback() {
  const context = useContext(HotkeyFeedbackContext)
  if (!context) {
    throw new Error('useHotkeyFeedback must be used within a HotkeyFeedbackProvider')
  }
  return context
}

interface HotkeyFeedbackProviderProps {
  children: ReactNode
}

export function HotkeyFeedbackProvider({ children }: HotkeyFeedbackProviderProps) {
  const [state, setState] = useState<HotkeyFeedbackState>({
    navigation: null,
    action: null,
  })

  const showNavigation = (destination: string) => {
    console.log(`[HotkeyFeedback] Showing navigation feedback: ${destination} at ${new Date().toISOString()}`)
    setState(prev => ({ ...prev, navigation: destination }))
    // Auto-clear after 1 second
    setTimeout(() => {
      setState(prev => ({ ...prev, navigation: null }))
    }, 1000)
  }

  const showAction = (action: 'post' | 'queue' | 'schedule') => {
    console.log(`[HotkeyFeedback] Showing action feedback: ${action} at ${new Date().toISOString()}`)
    setState(prev => ({ ...prev, action }))
    // Auto-clear after 0.5 seconds
    setTimeout(() => {
      setState(prev => ({ ...prev, action: null }))
    }, 500)
  }

  const clearNavigation = () => {
    setState(prev => ({ ...prev, navigation: null }))
  }

  const clearAction = () => {
    setState(prev => ({ ...prev, action: null }))
  }

  const clearAll = () => {
    setState({ navigation: null, action: null })
  }

  const contextValue: HotkeyFeedbackContextType = {
    state,
    showNavigation,
    showAction,
    clearNavigation,
    clearAction,
    clearAll,
  }

  return (
    <HotkeyFeedbackContext.Provider value={contextValue}>
      {children}
      {/* Global feedback overlays */}
      {state.navigation && (
        <div className="fixed top-4 left-4 z-50 bg-primary text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-left duration-200">
          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
          <span className="text-sm font-medium">
            Opening {state.navigation}...
          </span>
        </div>
      )}
      {state.action && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-right duration-200">
          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
          <span className="text-sm font-medium">
            {state.action === 'post' ? 'Posting...' : 
             state.action === 'queue' ? 'Adding to Queue...' : 
             'Scheduling...'}
          </span>
        </div>
      )}
    </HotkeyFeedbackContext.Provider>
  )
}
