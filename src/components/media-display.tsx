import { useState } from 'react'
import DuolingoButton from '@/components/ui/duolingo-button'
import { AlertCircle, CheckCircle, Loader2, X } from 'lucide-react'
import { Loader } from './ui/loader'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

interface MediaFile {
  url: string
  type: 'image' | 'gif' | 'video'
  uploading: boolean
  error?: string
}

interface MediaDisplayProps {
  mediaFiles: MediaFile[]
  selectionMode?: boolean
  removeMediaFile: (url: string) => void
}

export default function MediaDisplay({
  mediaFiles,
  selectionMode = false,
  removeMediaFile,
}: MediaDisplayProps) {
  const [openImageUrl, setOpenImageUrl] = useState<string | null>(null)

  // Helper function to detect video files from URL even if type is wrong
  const isVideoFile = (mediaFile: MediaFile): boolean => {
    if (mediaFile.type === 'video') return true
    
    // Check file extension as fallback
    const url = mediaFile.url.toLowerCase()
    return url.includes('.mp4') || url.includes('.mov') || url.includes('.avi') || 
           url.includes('.webm') || url.includes('.mkv') || url.includes('.m4v')
  }

  const renderMediaOverlays = (mediaFile: MediaFile) => (
    <>
      {(mediaFile.uploading || mediaFile.error) && (
        <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
          {mediaFile.uploading && (
            <div className="flex flex-col gap-2 items-center text-white text-center">
              <Loader2 className="animate-spin text-white" />
              <p className="text-sm">Uploading</p>
            </div>
          )}
          {mediaFile.error && (
            <div className="text-white text-center">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">{mediaFile.error}</p>
            </div>
          )}
        </div>
      )}
    </>
  )

  const renderImage = (mediaFile: MediaFile, className: string) => (
    <Dialog open={openImageUrl === mediaFile.url} onOpenChange={(open) => setOpenImageUrl(open ? mediaFile.url : null)}>
      <DialogTrigger asChild>
        <img
          src={mediaFile.url}
          alt="Upload preview"
          className={`${className} cursor-pointer rounded-lg hover:opacity-90 transition-opacity`}
        />
      </DialogTrigger>
      <DialogContent
        className="max-w-4xl w-full h-fit max-h-[90vh] p-0 bg-transparent border-none shadow-none"
        noClose
      >
        <DialogTitle className="sr-only">Image Zoom View</DialogTitle>
        <div className="relative w-full h-full flex items-center justify-center">
          <div className="relative">
            <img
              src={mediaFile.url}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
            <DialogClose className="absolute top-2 right-2" asChild>
              <button
                onClick={() => setOpenImageUrl(null)}
                className="bg-black bg-opacity-50 hover:bg-opacity-75 text-white rounded-full p-2 transition-all"
              >
                <X className="size-5" />
              </button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  const renderVideo = (mediaFile: MediaFile, className: string) => (
    <div className="relative">
      <video
        src={mediaFile.url}
        className={`${className} rounded-lg`}
        controls={false}
        preload="metadata"
        muted
        onLoadedMetadata={(e) => {
          // Set video to first frame to show as thumbnail
          const video = e.target as HTMLVideoElement
          video.currentTime = 0.1
        }}
      />
      {/* Play button overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded-lg hover:bg-opacity-40 transition-colors cursor-pointer group"
           onClick={(e) => {
             e.preventDefault()
             const video = e.currentTarget.previousElementSibling as HTMLVideoElement
             if (video.paused) {
               video.play()
               video.setAttribute('controls', 'true')
               e.currentTarget.style.display = 'none'
             }
           }}>
        <div className="bg-white bg-opacity-90 rounded-full p-4 group-hover:bg-opacity-100 transition-colors">
          <svg className="w-8 h-8 text-neutral-800" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
    </div>
  )

  return (
    <div className="mt-3 max-w-full">
      {mediaFiles.length === 1 && mediaFiles[0] && (
        <div className="relative group">
          <div className="relative overflow-hidden">
            {isVideoFile(mediaFiles[0]) ? (
              renderVideo(mediaFiles[0], "w-full max-h-[510px] object-cover")
            ) : (
              renderImage(mediaFiles[0], "w-full max-h-[510px] object-cover")
            )}
            {renderMediaOverlays(mediaFiles[0])}
          </div>
        </div>
      )}

      {mediaFiles.length === 2 && (
        <div className="grid grid-cols-2 gap-0.5 overflow-hidden">
          {mediaFiles.map((mediaFile, index) => (
            <div key={mediaFile.url} className="relative group">
              <div className="relative overflow-hidden h-[254px]">
                {isVideoFile(mediaFile) ? (
                  renderVideo(mediaFile, "w-full h-full object-cover")
                ) : (
                  renderImage(mediaFile, "w-full h-full object-cover")
                )}
                {renderMediaOverlays(mediaFile)}
              </div>
            </div>
          ))}
        </div>
      )}

      {mediaFiles.length === 3 && mediaFiles[0] && (
        <div className="grid grid-cols-2 gap-0.5 overflow-hidden h-[254px]">
          <div className="relative group">
            <div className="relative overflow-hidden h-full">
              {isVideoFile(mediaFiles[0]) ? (
                renderVideo(mediaFiles[0], "w-full h-full object-cover")
              ) : (
                renderImage(mediaFiles[0], "w-full h-full object-cover")
              )}
              {renderMediaOverlays(mediaFiles[0])}
            </div>
          </div>
          <div className="grid grid-rows-2 gap-0.5">
            {mediaFiles.slice(1).map((mediaFile, index) => (
              <div key={mediaFile.url} className="relative group">
                <div className="relative overflow-hidden h-full">
                  {isVideoFile(mediaFile) ? (
                    renderVideo(mediaFile, "w-full h-full object-cover")
                  ) : (
                    renderImage(mediaFile, "w-full h-full object-cover")
                  )}
                  {renderMediaOverlays(mediaFile)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mediaFiles.length === 4 && (
        <div className="grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden h-[254px]">
          {mediaFiles.map((mediaFile, index) => (
            <div key={mediaFile.url} className="relative group">
              <div className="relative overflow-hidden h-full">
                {isVideoFile(mediaFile) ? (
                  renderVideo(mediaFile, "w-full h-full object-cover")
                ) : (
                  renderImage(mediaFile, "w-full h-full object-cover")
                )}
                {renderMediaOverlays(mediaFile)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
