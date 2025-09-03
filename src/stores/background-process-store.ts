import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface BackgroundProcess {
  id: string
  type: 'posting' | 'queueing'
  description: string
  startedAt: number
}

interface BackgroundProcessStore {
  processes: BackgroundProcess[]
  addProcess: (process: Omit<BackgroundProcess, 'id' | 'startedAt'>) => string
  removeProcess: (id: string) => void
  clearAllProcesses: () => void
  getActiveProcesses: () => BackgroundProcess[]
  cleanupOldProcesses: () => void
}

export const useBackgroundProcessStore = create<BackgroundProcessStore>()(
  persist(
    (set, get) => ({
      processes: [],
  
  addProcess: (process) => {
    const id = crypto.randomUUID()
    const newProcess: BackgroundProcess = {
      ...process,
      id,
      startedAt: Date.now()
    }
    
    console.log('[BackgroundProcessStore] Adding process:', newProcess)
    
    set((state) => ({
      processes: [...state.processes, newProcess]
    }))
    
    // Auto-remove after 30 seconds to prevent memory leaks
    setTimeout(() => {
      get().removeProcess(id)
    }, 30000)
    
    return id
  },
  
  removeProcess: (id) => {
    console.log('[BackgroundProcessStore] Removing process:', id)
    set((state) => ({
      processes: state.processes.filter(p => p.id !== id)
    }))
  },
  
  clearAllProcesses: () => {
    console.log('[BackgroundProcessStore] Clearing all processes')
    set({ processes: [] })
  },
  
  getActiveProcesses: () => {
    const now = Date.now()
    // Consider processes active if they're less than 2 minutes old
    return get().processes.filter(p => now - p.startedAt < 120000)
  },

  cleanupOldProcesses: () => {
    const now = Date.now()
    set((state) => ({
      processes: state.processes.filter(p => now - p.startedAt < 120000)
    }))
  }
}),
{
  name: 'background-processes',
  // Only persist posting/queueing jobs, not video processing (handled by React Query)
  partialize: (state) => ({
    processes: state.processes.filter(p => p.type !== 'video-processing')
  })
}
))
