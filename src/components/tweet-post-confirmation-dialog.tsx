'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import DuolingoCheckbox from './ui/duolingo-checkbox'
import { Icons } from './icons'

interface TweetPostConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel?: () => void
  isPosting?: boolean
}

export default function TweetPostConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  isPosting = false,
}: TweetPostConfirmationDialogProps) {
  const [skipPostConfirmation, setSkipPostConfirmation] = useState(false)

  useEffect(() => {
    setSkipPostConfirmation(localStorage.getItem('skipPostConfirmation') === 'true')
  }, [])

  const toggleSkipConfirmation = (checked: boolean) => {
    setSkipPostConfirmation(checked)
    if (checked) {
      localStorage.setItem('skipPostConfirmation', 'true')
    } else {
      localStorage.removeItem('skipPostConfirmation')
    }
  }

  const handleConfirm = () => {
    onOpenChange(false)
    onConfirm()
  }

  const handleCancel = () => {
    onOpenChange(false)
    onCancel?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-[425px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault()
            if (!isPosting) {
              handleConfirm()
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            handleCancel()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Post to Twitter</DialogTitle>
        </DialogHeader>
        <div className="">
          <p className="text-base text-muted-foreground mb-4">
            This will post to Twitter. Continue?
          </p>
          <DuolingoCheckbox
            id="skip-post-confirmation"
            label="Don't show this again"
            checked={skipPostConfirmation}
            onChange={(e) => toggleSkipConfirmation(e.target.checked)}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button
            variant="duolingo-secondary"
            size="duolingo-sm"
            onClick={handleCancel}
          >
            Cancel <span className="ml-1 text-xs opacity-60">Esc</span>
          </Button>
          <Button variant="duolingo-primary" size="duolingo-sm" onClick={handleConfirm} disabled={isPosting}>
            <Icons.twitter className="size-4 mr-2" />
            {isPosting ? 'Posting...' : 'Post'} <span className="ml-1 text-xs opacity-60">Enter</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
