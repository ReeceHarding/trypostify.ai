'use client'

import React, { createContext, useContext, useRef, PropsWithChildren, useState, useCallback, useEffect } from 'react'
import confetti from 'canvas-confetti'
import dynamic from 'next/dynamic'

// Use dynamic import but handle it properly for SSR
const Confetti = dynamic(() => import('@/frontend/studio/components/confetti'), {
  ssr: false,
})

interface ConfettiContextType {
  fire: (options?: confetti.Options) => void
  isReady: boolean
}

const ConfettiContext = createContext<ConfettiContextType | null>(null)

export const ConfettiProvider = ({ children }: PropsWithChildren) => {
  const confettiRef = useRef<any>(null)
  const [isReady, setIsReady] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const pendingFiresRef = useRef<confetti.Options[]>([])

  // Handle SSR by only mounting confetti on client side
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const fire = useCallback((options?: confetti.Options) => {
    if (!confettiRef.current || !isMounted) {
      pendingFiresRef.current.push(options || {})
      return
    }

    confettiRef.current?.fire(options)
  }, [isMounted])

  const handleConfettiRef = useCallback((ref: any) => {
    confettiRef.current = ref
    if (ref && isMounted) {
      setIsReady(true)
      pendingFiresRef.current.forEach(options => ref.fire(options))
      pendingFiresRef.current = []
    }
  }, [isMounted])

  return (
    <ConfettiContext.Provider value={{ fire, isReady }}>
      {children}
      {isMounted && <Confetti ref={handleConfettiRef} />}
    </ConfettiContext.Provider>
  )
}

export const useConfetti = () => {
  const context = useContext(ConfettiContext)
  if (!context) {
    throw new Error('useConfetti must be used within a ConfettiProvider')
  }
  return context
}
