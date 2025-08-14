/**
 * Platform detection and keyboard shortcut utilities
 */

export type Platform = 'mac' | 'windows' | 'linux' | 'unknown'

/**
 * Detect the user's operating system platform
 */
export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown'
  
  const userAgent = window.navigator.userAgent.toLowerCase()
  
  if (userAgent.includes('mac')) return 'mac'
  if (userAgent.includes('win')) return 'windows'
  if (userAgent.includes('linux')) return 'linux'
  
  return 'unknown'
}

/**
 * Get the appropriate modifier key for the platform
 */
export function getModifierKey(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'mac':
      return '⌘' // Command symbol
    case 'windows':
    case 'linux':
      return 'Ctrl'
    default:
      return 'Ctrl'
  }
}

/**
 * Get platform-specific key symbols
 */
export function getKeySymbol(key: string, platform: Platform = detectPlatform()): string {
  const keyMap: Record<string, Record<Platform, string>> = {
    enter: {
      mac: '↵',
      windows: 'Enter',
      linux: 'Enter',
      unknown: 'Enter'
    },
    backspace: {
      mac: '⌫',
      windows: 'Backspace',
      linux: 'Backspace', 
      unknown: 'Backspace'
    },
    delete: {
      mac: '⌦',
      windows: 'Del',
      linux: 'Del',
      unknown: 'Del'
    },
    escape: {
      mac: '⎋',
      windows: 'Esc',
      linux: 'Esc',
      unknown: 'Esc'
    }
  }
  
  return keyMap[key]?.[platform] || key.toUpperCase()
}

/**
 * Format a keyboard shortcut string for display
 */
export function formatShortcut(
  keys: string[], 
  platform: Platform = detectPlatform()
): string {
  const modifier = getModifierKey(platform)
  
  return keys.map(key => {
    if (key === 'mod') return modifier
    return getKeySymbol(key, platform)
  }).join(' + ')
}

/**
 * Create tooltip content with action and keyboard shortcut
 */
export function createTooltipContent(
  action: string,
  shortcut: string[],
  platform: Platform = detectPlatform()
): JSX.Element {
  const shortcutText = formatShortcut(shortcut, platform)
  
  return (
    <div className="text-center">
      <div className="font-medium">{action}</div>
      <div className="text-xs text-neutral-400 mt-1">{shortcutText}</div>
    </div>
  )
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string[],
  platform: Platform = detectPlatform()
): boolean {
  const isMac = platform === 'mac'
  const modifierPressed = isMac ? event.metaKey : event.ctrlKey
  
  // Check if modifier is required
  const needsModifier = shortcut.includes('mod')
  if (needsModifier && !modifierPressed) return false
  if (!needsModifier && modifierPressed) return false
  
  // Check the main key
  const mainKey = shortcut.find(key => key !== 'mod')
  if (!mainKey) return false
  
  // Handle special keys
  switch (mainKey) {
    case 'enter':
      return event.key === 'Enter'
    case 'backspace':
      return event.key === 'Backspace'
    case 'delete':
      return event.key === 'Delete'
    case 'escape':
      return event.key === 'Escape'
    default:
      return event.key.toLowerCase() === mainKey.toLowerCase()
  }
}
