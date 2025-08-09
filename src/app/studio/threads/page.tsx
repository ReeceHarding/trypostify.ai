'use client'

import ThreadEditor from '@/components/thread-editor/thread-editor'
import { Icons } from '@/components/icons'

export default function ThreadsPage() {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-indigo-100">
          <Icons.thread className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Create Thread</h1>
          <p className="text-sm text-stone-600">
            Create a thread of connected tweets
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ThreadEditor />
      </div>
    </div>
  )
}
