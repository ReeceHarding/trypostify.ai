import { useUser } from '@/hooks/use-tweets'

interface ContentLengthIndicatorProps {
  length: number // Now required since we removed the hook
}

const ContentLengthIndicator = ({ length }: ContentLengthIndicatorProps) => {
  const { getCharacterLimit } = useUser()
  const charCount = length
  // Posting limit can be higher for premium users, but visually we want to
  // reflect Twitter's "Show more" threshold at 280 characters. Keep server
  // validation unchanged elsewhere; this only affects the ring UI.
  const postingLimit = getCharacterLimit()
  const characterLimit = 280

  const getProgressColor = () => {
    const percentage = (charCount / characterLimit) * 100
    if (percentage >= 100) return 'text-error-500'
    return 'text-primary-500'
  }

  const progress = Math.min((charCount / characterLimit) * 100, 100)
  const circumference = 2 * Math.PI * 10
  const strokeDashoffset = circumference - (progress / 100) * circumference

  return (
    <div className="relative flex items-center justify-center">
      <div className="h-8 w-8">
        <svg className="-ml-[5px] -rotate-90 w-full h-full">
          <circle
            className="text-neutral-200"
            strokeWidth="2"
            stroke="currentColor"
            fill="transparent"
            r="10"
            cx="16"
            cy="16"
          />
          <circle
            className={`${getProgressColor()} transition-all duration-200`}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="10"
            cx="16"
            cy="16"
          />
        </svg>
      </div>
      {charCount > (characterLimit - 20) && charCount < characterLimit && (
        <div
          className={`text-sm/6 ${characterLimit - charCount < 1 ? 'text-error-500' : 'text-neutral-800'} mr-3.5`}
        >
          <p>{characterLimit - charCount < 20 ? characterLimit - charCount : charCount.toLocaleString()}</p>
        </div>
      )}
    </div>
  )
}

export default ContentLengthIndicator
