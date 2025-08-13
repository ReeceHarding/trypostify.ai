'use client'

import DuolingoBadge from '@/components/ui/duolingo-badge'
import DuolingoButton from '@/components/ui/duolingo-button'
import DuolingoInput from '@/components/ui/duolingo-input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, FolderOpen, Link, Upload, X, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'

interface UploadState {
  file: File
  localUrl?: string
  uploadProgress: number
  isUploadDone: boolean
  xhr?: XMLHttpRequest
}

interface MultiFile {
  file: File
  title: string
  localUrl?: string
}

export default function NewKnowledgePage() {
  const searchParams = useSearchParams()
  const type = searchParams.get('type') || 'manual'

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState | null>(null)
  const [multiFiles, setMultiFiles] = useState<MultiFile[]>([])

  // Helper function to extract clean title from filename
  const extractTitleFromFilename = (filename: string): string => {
    console.log('[BULK_UPLOAD] Extracting title from filename:', filename)
    // Remove file extension and clean up common patterns
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
    // Replace underscores, hyphens, and dots with spaces
    const cleaned = nameWithoutExt.replace(/[_\-\.]/g, ' ')
    // Capitalize first letter of each word
    const titleCased = cleaned.replace(/\b\w/g, l => l.toUpperCase())
    console.log('[BULK_UPLOAD] Extracted title:', titleCased)
    return titleCased
  }

  // Initialize multiple files
  const initializeMultiFiles = (files: File[]) => {
    console.log('[MULTI_UPLOAD] Setting up', files.length, 'files')
    
    const multiFiles = files.map(file => ({
      file,
      title: extractTitleFromFilename(file.name),
      localUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    }))

    setMultiFiles(multiFiles)
    setUploadState(null)
    setTitle('')
  }

  // Navigation functions for multi-file upload
  const navigateToFile = (index: number) => {
    if (!multiFileState) return
    console.log('[BULK_UPLOAD] Navigating to file index:', index)
    setMultiFileState(prev => prev ? { ...prev, currentFileIndex: index } : null)
  }

  const goToPreviousFile = () => {
    if (!multiFileState) return
    const newIndex = Math.max(0, multiFileState.currentFileIndex - 1)
    navigateToFile(newIndex)
  }

  const goToNextFile = () => {
    if (!multiFileState) return
    const newIndex = Math.min(multiFileState.files.length - 1, multiFileState.currentFileIndex + 1)
    navigateToFile(newIndex)
  }

  // Update title for current file in multi-file upload
  const updateCurrentFileTitle = (newTitle: string) => {
    if (!multiFileState) return
    console.log('[BULK_UPLOAD] Updating title for file at index', multiFileState.currentFileIndex, 'to:', newTitle)
    
    setMultiFileState(prev => {
      if (!prev) return null
      const updatedFiles = [...prev.files]
      updatedFiles[prev.currentFileIndex] = {
        ...updatedFiles[prev.currentFileIndex],
        title: newTitle
      }
      return { ...prev, files: updatedFiles }
    })
  }

  // Remove a file from bulk upload
  const removeFileFromBulkUpload = (fileId: string) => {
    if (!multiFileState) return
    
    console.log('[BULK_UPLOAD] Removing file with ID:', fileId)
    
    const fileIndex = multiFileState.files.findIndex(f => f.id === fileId)
    if (fileIndex === -1) return
    
    const fileToRemove = multiFileState.files[fileIndex]
    
    // Clean up object URL if it exists
    if (fileToRemove.localUrl) {
      URL.revokeObjectURL(fileToRemove.localUrl)
    }
    
    // Abort upload if in progress
    if (fileToRemove.xhr && !fileToRemove.isUploadDone) {
      fileToRemove.xhr.abort()
    }
    
    const updatedFiles = multiFileState.files.filter(f => f.id !== fileId)
    
    if (updatedFiles.length === 0) {
      // No files left, clear multi-file state
      setMultiFileState(null)
      console.log('[BULK_UPLOAD] All files removed, clearing bulk upload state')
      return
    }
    
    // Adjust current index if necessary
    let newCurrentIndex = multiFileState.currentFileIndex
    if (fileIndex <= multiFileState.currentFileIndex && multiFileState.currentFileIndex > 0) {
      newCurrentIndex = multiFileState.currentFileIndex - 1
    } else if (multiFileState.currentFileIndex >= updatedFiles.length) {
      newCurrentIndex = updatedFiles.length - 1
    }
    
    setMultiFileState({
      ...multiFileState,
      files: updatedFiles,
      currentFileIndex: newCurrentIndex
    })
    
    console.log('[BULK_UPLOAD] File removed, remaining files:', updatedFiles.length)
  }

  // Normalize a user-entered URL so that host-only inputs like "example.com"
  // become valid absolute URLs by adding an implicit https:// scheme.
  const normalizeUrlInput = (raw: string): string => {
    const value = (raw || '').trim()
    if (!value) return ''
    // If the user already provided a scheme, leave it as-is.
    if (/^https?:\/\//i.test(value)) return value
    // Prepend https:// to host-only or schemeless inputs.
    try {
      const normalized = `https://${value}`
      // Validate via URL constructor; if it throws, fall back to original with https://
      // This guards against obviously invalid inputs without breaking UX.
      // eslint-disable-next-line no-new
      new URL(normalized)
      return normalized
    } catch {
      return `https://${value}`
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (getDisabled()) return

    if (type === 'upload') {
      if (multiFileState) {
        // Handle bulk upload
        console.log('[BULK_UPLOAD] Starting bulk upload process for', multiFileState.files.length, 'files')
        startBulkUpload()
      } else if (data) {
        // Handle single file upload
        processFile({ ...data, title })
      }
    }
    if (type === 'url') {
      if (url) {
        const cleaned = normalizeUrlInput(url)
        setUrl(cleaned)
        importUrl(cleaned)
      }
    }
  }

  const { mutate: importUrl, isPending: isImporting } = useMutation({
    mutationFn: async (url: string) => {
      const res = await client.knowledge.importUrl.$post({ url })
      return res.json()
    },
    onSuccess: (data) => {
      posthog.capture('knowledge_imported', {
        source: 'url',
        url: data.url,
        title: data.title,
      })

      queryClient.refetchQueries({ queryKey: ['knowledge-documents'] })
      toast.success(`Successfully imported content from ${data.url}`)
      setTitle('')
      setUrl('')
      
      // Redirect to knowledge base after successful import
      router.push('/studio/knowledge')
    },
    onError: (error) => {
      console.error('Error importing URL:', error)
      toast.error('Failed to import URL. Please try again.')
    },
  })

  const queryClient = useQueryClient()

  const {
    mutate: upload,
    isPending: isUploading,
    data,
    reset,
  } = useMutation({
    mutationFn: async ({ file, title }: { file: File; title: string }) => {
      let localUrl: string | undefined = undefined

      if (file.type.startsWith('image/')) {
        localUrl = URL.createObjectURL(file)
      }

      const xhr = new XMLHttpRequest()

      setUploadState({
        file,
        localUrl,
        uploadProgress: 0,
        isUploadDone: false,
        xhr,
      })

      const res = await client.file.upload.$post({
        fileName: file.name,
        fileType: file.type,
        source: 'knowledge',
      })

      const { url, fields, fileKey, type } = await res.json()

      const formData = new FormData()

      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string)
      })

      formData.append('file', file)

      await new Promise<void>((resolve, reject) => {
        xhr.open('POST', url, true)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const uploadProgress = (event.loaded / event.total) * 100

            setUploadState((prev) => (prev ? { ...prev, uploadProgress } : null))
          }
        }
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 204) {
            setUploadState((prev) => (prev ? { ...prev, isUploadDone: true } : null))
            resolve()
          } else {
            toast.error(`Upload failed with status ${xhr.status}`)
            reject(new Error(`Upload failed with status ${xhr.status}`))
          }
        }
        xhr.onerror = () => {
          toast.error('Network error, please try again.')
          reject(new Error('Network error occurred during upload'))
        }
        xhr.onabort = () => {
          toast.success('Upload cancelled')
          reject(new Error('Upload aborted'))
        }
        xhr.send(formData)
      })

      return { fileKey, fileName: file.name, type }
    },
    onError: () => {
      setUploadState(null)
    },
  })

  interface ProcessFileArgs {
    fileKey: string
    fileName: string
    title: string
  }

  const {
    mutate: processFile,
    isPending: isProcessing,
    reset: resetProcessing,
  } = useMutation({
    mutationFn: async ({ fileKey, fileName, title }: ProcessFileArgs) => {
      const res = await client.file.promoteToKnowledgeDocument.$post({
        fileKey,
        fileName,
        title,
      })

      return await res.json()
    },
    onSuccess: (data, variables) => {
      posthog.capture('knowledge_imported', {
        source: 'upload',
        title: variables.title,
        fileKey: variables.fileKey,
      })

      toast.success('Knowledge added!')
      setUploadState(null)
      setTitle('')
      queryClient.refetchQueries({ queryKey: ['knowledge-documents'] })
      
      // Redirect to knowledge base after successful upload
      router.push('/studio/knowledge')
    },
  })

  // Bulk upload mutations
  const {
    mutate: uploadFileBulk,
    isPending: isBulkUploading,
  } = useMutation({
    mutationFn: async ({ file, fileId }: { file: File; fileId: string }) => {
      console.log('[BULK_UPLOAD] Starting upload for file:', file.name, 'ID:', fileId)
      
      let localUrl: string | undefined = undefined
      if (file.type.startsWith('image/')) {
        localUrl = URL.createObjectURL(file)
      }

      const xhr = new XMLHttpRequest()

      // Update the specific file's state
      setMultiFileState(prev => {
        if (!prev) return null
        const updatedFiles = prev.files.map(f => 
          f.id === fileId 
            ? { ...f, xhr, uploadProgress: 0, isUploadDone: false, localUrl }
            : f
        )
        return { ...prev, files: updatedFiles }
      })

      const res = await client.file.upload.$post({
        fileName: file.name,
        fileType: file.type,
        source: 'knowledge',
      })

      const { url, fields, fileKey, type } = await res.json()

      const formData = new FormData()
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string)
      })
      formData.append('file', file)

      await new Promise<void>((resolve, reject) => {
        xhr.open('POST', url, true)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const uploadProgress = (event.loaded / event.total) * 100
            console.log(`[BULK_UPLOAD] Upload progress for ${file.name}:`, uploadProgress)
            
            setMultiFileState(prev => {
              if (!prev) return null
              const updatedFiles = prev.files.map(f => 
                f.id === fileId ? { ...f, uploadProgress } : f
              )
              return { ...prev, files: updatedFiles }
            })
          }
        }
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 204) {
            console.log(`[BULK_UPLOAD] Upload completed for ${file.name}`)
            setMultiFileState(prev => {
              if (!prev) return null
              const updatedFiles = prev.files.map(f => 
                f.id === fileId 
                  ? { ...f, isUploadDone: true, fileKey, type }
                  : f
              )
              return { ...prev, files: updatedFiles }
            })
            resolve()
          } else {
            toast.error(`Upload failed for ${file.name}: status ${xhr.status}`)
            reject(new Error(`Upload failed with status ${xhr.status}`))
          }
        }
        xhr.onerror = () => {
          toast.error(`Network error uploading ${file.name}`)
          reject(new Error('Network error occurred during upload'))
        }
        xhr.onabort = () => {
          console.log(`[BULK_UPLOAD] Upload cancelled for ${file.name}`)
          reject(new Error('Upload aborted'))
        }
        xhr.send(formData)
      })

      return { fileKey, fileName: file.name, type, fileId }
    },
  })

  const {
    mutate: processBulkFiles,
    isPending: isBulkProcessing,
  } = useMutation({
    mutationFn: async (files: Array<{ fileKey: string; fileName: string; title: string }>) => {
      console.log('[BULK_UPLOAD] Processing', files.length, 'files')
      
      const results = []
      for (const file of files) {
        console.log('[BULK_UPLOAD] Processing file:', file.fileName, 'with title:', file.title)
        try {
          const res = await client.file.promoteToKnowledgeDocument.$post({
            fileKey: file.fileKey,
            fileName: file.fileName,
            title: file.title,
          })
          const result = await res.json()
          results.push({ ...result, originalFile: file })
          console.log('[BULK_UPLOAD] Successfully processed:', file.fileName)
        } catch (error) {
          console.error('[BULK_UPLOAD] Failed to process:', file.fileName, error)
          throw error
        }
      }
      
      return results
    },
    onSuccess: (results) => {
      console.log('[BULK_UPLOAD] All files processed successfully:', results.length)
      
      // Track analytics for bulk upload
      posthog.capture('knowledge_bulk_imported', {
        source: 'bulk_upload',
        fileCount: results.length,
        files: results.map(r => r.originalFile.fileName),
      })

      toast.success(`Successfully added ${results.length} documents to knowledge base!`)
      
      // Clear all state
      setMultiFileState(null)
      setUploadState(null)
      setTitle('')
      
      // Refresh knowledge documents
      queryClient.refetchQueries({ queryKey: ['knowledge-documents'] })
      
      // Redirect to knowledge base
      router.push('/studio/knowledge')
    },
    onError: (error) => {
      console.error('[BULK_UPLOAD] Bulk processing failed:', error)
      toast.error('Failed to process some files. Please try again.')
    },
  })

  // Start uploading files to S3 (called automatically when files are selected)
  const startBulkFileUploads = async (uploadFiles: any[]) => {
    console.log('[BULK_UPLOAD] Starting automatic file uploads for', uploadFiles.length, 'files')
    
    // Upload all files in parallel
    uploadFiles.forEach(file => {
      uploadFileBulk({ file: file.file, fileId: file.id })
    })
  }

  // Start the bulk processing (called when user clicks submit)
  const startBulkUpload = async () => {
    if (!multiFileState) return
    
    console.log('[BULK_UPLOAD] Starting bulk processing for', multiFileState.files.length, 'files')
    
    // Process all uploaded files (files should already be uploaded to S3)
    const filesToProcess = multiFileState.files.map(file => ({
      fileKey: file.fileKey!,
      fileName: file.file.name,
      title: file.title,
    }))
    
    console.log('[BULK_UPLOAD] Processing files with titles:', filesToProcess.map(f => ({ name: f.fileName, title: f.title })))
    
    processBulkFiles(filesToProcess)
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    console.log('[BULK_UPLOAD] Files dropped:', files.length, files.map(f => f.name))
    
    if (files.length === 0) return

    if (files.length === 1) {
      // Single file - use existing flow
      console.log('[BULK_UPLOAD] Single file detected, using existing upload flow')
      const file = files[0]
      upload({ file, title })
    } else {
      // Multiple files - use new bulk upload flow
      console.log('[BULK_UPLOAD] Multiple files detected, initializing bulk upload')
      initializeBulkUpload(files)
    }
  }, [title])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    console.log('[BULK_UPLOAD] Files selected:', files.length, files.map(f => f.name))
    
    if (files.length === 0) return

    if (files.length === 1) {
      // Single file - use existing flow
      console.log('[BULK_UPLOAD] Single file selected, using existing upload flow')
      const file = files[0]
      upload({ file, title })
    } else {
      // Multiple files - use new bulk upload flow
      console.log('[BULK_UPLOAD] Multiple files selected, initializing bulk upload')
      initializeBulkUpload(files)
    }
  }

  const renderFilePreview = () => {
    if (!uploadState) return null

    const { file, localUrl, uploadProgress, isUploadDone } = uploadState

    const isImage = file.type.startsWith('image/')

    return (
      <div className="relative border-2 border-neutral-200 shadow-[0_2px_0_hsl(var(--neutral-200))] rounded-2xl p-6 bg-white">
        <div className="flex items-center gap-4">
          {isImage && localUrl ? (
            <div className="relative size-16 rounded-lg overflow-hidden bg-neutral-100 flex-shrink-0">
              <img
                src={localUrl}
                alt={file.name}
                className="w-full h-full object-cover"
              />
              {!isUploadDone && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="relative size-8">
                    <svg className="size-8 transform" viewBox="0 0 36 36">
                      <path
                        className="text-neutral-300"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-white"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${uploadProgress}, 100`}
                        strokeLinecap="round"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative size-16 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
              <FileText className="size-8 text-neutral-400" />
              {!isUploadDone && (
                <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                  <div className="relative size-8">
                    <svg className="size-8 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-neutral-300"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-primary-600"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${uploadProgress}, 100`}
                        strokeLinecap="round"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-neutral-900 truncate">
                {file.name}
              </h3>
              {isUploadDone && (
                <DuolingoBadge variant="green" className="px-2 text-xs flex items-center gap-1">
                  <Check className="size-3" />
                  Uploaded
                </DuolingoBadge>
              )}
            </div>
            <p className="text-sm text-neutral-600">
              {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type}
            </p>
            {!isUploadDone && (
              <p className="text-sm text-primary-600 mt-1">
                Uploading... {Math.round(uploadProgress)}%
              </p>
            )}
          </div>
        </div>

        <DuolingoButton
          variant="destructive"
          size="icon"
          className="absolute size-8 top-2 right-2"
          onClick={() => {
            if (uploadState?.xhr && !uploadState.isUploadDone) {
              uploadState.xhr.abort()
            }
            if (uploadState?.localUrl) {
              URL.revokeObjectURL(uploadState.localUrl)
            }
            setUploadState(null)
            reset()
            resetProcessing()
            setTitle('')
          }}
        >
          <X className="size-4" />
        </DuolingoButton>
      </div>
    )
  }

  const renderMultiFilePreview = () => {
    if (!multiFileState || multiFileState.files.length === 0) return null

    const currentFile = multiFileState.files[multiFileState.currentFileIndex]
    const { file, localUrl, uploadProgress, isUploadDone, title } = currentFile
    const { currentFileIndex, files } = multiFileState

    const isImage = file.type.startsWith('image/')

    return (
      <div className="space-y-4">
        {/* File counter and navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-700">
              File {currentFileIndex + 1} of {files.length}
            </span>
            <div className="flex items-center gap-1">
              {files.map((_, index) => (
                <button
                  key={index}
                  onClick={() => navigateToFile(index)}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    index === currentFileIndex 
                      ? "bg-primary" 
                      : files[index].isUploadDone 
                        ? "bg-success-500" 
                        : "bg-neutral-300"
                  )}
                />
              ))}
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <DuolingoButton
              variant="secondary"
              size="icon"
              className="size-8"
              onClick={goToPreviousFile}
              disabled={currentFileIndex === 0}
            >
              <ChevronLeft className="size-4" />
            </DuolingoButton>
            <DuolingoButton
              variant="secondary"
              size="icon"
              className="size-8"
              onClick={goToNextFile}
              disabled={currentFileIndex === files.length - 1}
            >
              <ChevronRight className="size-4" />
            </DuolingoButton>
          </div>
        </div>

        {/* File preview card */}
        <div className="relative border-2 border-neutral-200 shadow-[0_2px_0_hsl(var(--neutral-200))] rounded-2xl p-6 bg-white">
          <div className="flex items-center gap-4">
            {isImage && localUrl ? (
              <div className="relative size-16 rounded-lg overflow-hidden bg-neutral-100 flex-shrink-0">
                <img
                  src={localUrl}
                  alt={file.name}
                  className="w-full h-full object-cover"
                />
                {!isUploadDone && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <div className="relative size-8">
                      <svg className="size-8 transform" viewBox="0 0 36 36">
                        <path
                          className="text-neutral-300"
                          stroke="currentColor"
                          strokeWidth="3"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-white"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeDasharray={`${uploadProgress}, 100`}
                          strokeLinecap="round"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative size-16 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                <FileText className="size-8 text-neutral-400" />
                {!isUploadDone && (
                  <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                    <div className="relative size-8">
                      <svg className="size-8 transform -rotate-90" viewBox="0 0 36 36">
                        <path
                          className="text-neutral-300"
                          stroke="currentColor"
                          strokeWidth="3"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-primary-600"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeDasharray={`${uploadProgress}, 100`}
                          strokeLinecap="round"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-semibold text-neutral-900 truncate">
                  {file.name}
                </h3>
                {isUploadDone && (
                  <DuolingoBadge variant="green" className="px-2 text-xs flex items-center gap-1">
                    <Check className="size-3" />
                    Uploaded
                  </DuolingoBadge>
                )}
              </div>
              <p className="text-sm text-neutral-600">
                {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type}
              </p>
              {!isUploadDone && uploadProgress > 0 && (
                <p className="text-sm text-primary-600 mt-1">
                  Uploading... {Math.round(uploadProgress)}%
                </p>
              )}
            </div>
          </div>

          {/* Remove individual file button */}
          <DuolingoButton
            variant="destructive"
            size="icon"
            className="absolute size-8 top-2 right-2"
            onClick={() => removeFileFromBulkUpload(currentFile.id)}
          >
            <X className="size-4" />
          </DuolingoButton>
        </div>

        {/* Title input for current file */}
        <div className="space-y-1">
          <Label>Title for {file.name}</Label>
          <DuolingoInput
            value={title}
            onChange={(e) => updateCurrentFileTitle(e.target.value)}
            fullWidth
            placeholder="Document title"
          />
        </div>
      </div>
    )
  }

  const renderUploadView = () => (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        {multiFileState ? (
          renderMultiFilePreview()
        ) : uploadState ? (
          renderFilePreview()
        ) : (
          <div
            className={cn(
              'relative border-2 border-neutral-200 shadow-[0_2px_0_hsl(var(--neutral-200))] rounded-2xl p-12 text-center transition-all duration-200',
              { 'border-primary bg-primary/5 scale-[1.01]': isDragging },
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <FolderOpen className="mx-auto size-16 text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">
              Drag n' drop or browse
            </h3>
            <p className="text-sm text-neutral-600 mb-4">
              pdf, docx, txt and images up to 10MB
            </p>
            <div className="w-full flex justify-center">
              <label htmlFor="file-upload" className="cursor-pointer">
                <DuolingoButton
                  variant="secondary"
                  size="sm"
                  className="w-auto pointer-events-none"
                >
                  <Upload className="size-4 mr-2" />
                  Browse Files
                </DuolingoButton>
              </label>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,.gif,.webp,.svg"
                onChange={handleFileSelect}
                disabled={isUploading || isProcessing}
                multiple
              />
            </div>
          </div>
        )}
      </div>

      {/* Only show title input for single file upload */}
      {!multiFileState && (
        <div className="space-y-1">
          <Label>Title</Label>
          <DuolingoInput
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit(e)
              }
            }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            placeholder="My document title"
          />
        </div>
      )}
    </form>
  )

  const renderUrlView = () => (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <Label>Link to website</Label>
        <DuolingoInput
          autoFocus
          fullWidth
          icon={<Link className="size-5 text-neutral-400" />}
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => setUrl(normalizeUrlInput(e.target.value))}
          className="flex-1 w-full"
        />
      </div>

      <div className="space-y-1">
        <Label>Title</Label>
        <DuolingoInput
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSubmit(e)
            }
          }}
          disabled={isImporting}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          fullWidth
          placeholder="My document title"
        />
      </div>
    </form>
  )

  const getDisabled = () => {
    if (type === 'upload') {
      if (multiFileState) {
        // For bulk upload, ensure all files have titles and all uploads are complete
        const allHaveTitles = multiFileState.files.every(f => f.title.trim().length > 0)
        const allUploadsComplete = multiFileState.files.every(f => f.isUploadDone)
        return !allHaveTitles || !allUploadsComplete
      }
      return !Boolean(title) || !Boolean(uploadState?.isUploadDone)
    }
    if (type === 'url') {
      return !Boolean(title) || !Boolean(url)
    }
    return false
  }

  const router = useRouter()

  return (
    <div className="relative z-10 min-h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <DuolingoButton
          variant="secondary"
          className="w-fit mb-8"
          size="sm"
          onClick={() => router.push('/studio/knowledge')}
        >
          <ArrowLeft className="size-8 shrink-0 mr-2" />
          Back to Knowledge Base
        </DuolingoButton>

        <div className="bg-white p-6 space-y-4 rounded-3xl border-2 border-neutral-200 shadow-xl">
          <div>
            {type === 'upload' && renderUploadView()}
            {type === 'url' && renderUrlView()}
          </div>

          <DuolingoButton
            loading={isProcessing || isImporting || isBulkUploading || isBulkProcessing}
            onClick={handleSubmit}
            disabled={getDisabled()}
          >
            {multiFileState 
              ? `Add ${multiFileState.files.length} Documents` 
              : 'Add Knowledge'
            }
          </DuolingoButton>
        </div>
      </div>
    </div>
  )
}
