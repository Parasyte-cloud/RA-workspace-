import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'ridearrivo:room7:install-dismissed'

function installed() {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

function dismissedRecently() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < 14 * 24 * 3600 * 1000
  } catch {
    return false
  }
}

export function registerRoom7Worker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/room7-sw.js').catch(() => {})
  }
}

// Offers "Install ROOM 7".
// Android and desktop Chrome give us a real install prompt. iPhone has none,
// so there we show the two-step "Add to Home Screen" hint instead.
export default function Room7Install() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(() => installed() || dismissedRecently())
  const [iosHint, setIosHint] = useState(false)

  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    const before = (e: Event) => {
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    const done = () => setHidden(true)
    window.addEventListener('beforeinstallprompt', before)
    window.addEventListener('appinstalled', done)
    return () => {
      window.removeEventListener('beforeinstallprompt', before)
      window.removeEventListener('appinstalled', done)
    }
  }, [])

  if (hidden || (!event && !ios)) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* private mode: the button simply comes back next visit */
    }
    setHidden(true)
  }

  const install = async () => {
    if (!event) return
    await event.prompt()
    const choice = await event.userChoice.catch(() => null)
    setEvent(null)
    if (choice?.outcome !== 'accepted') dismiss()
  }

  return (
    <div className="room7InstallBar responsiveActionBar" role="region" aria-label="Install ROOM 7">
      {event ? (
        <button type="button" className="room7InstallButton" onClick={() => void install()}>
          <Download size={16} /> Install ROOM 7
        </button>
      ) : (
        <button type="button" className="room7InstallButton" onClick={() => setIosHint(open => !open)}>
          <Share size={16} /> Install ROOM 7
        </button>
      )}
      <button type="button" className="room7InstallLater" onClick={dismiss}>
        Not now
      </button>
      {!event && iosHint && (
        <p className="room7InstallHint">
          Tap the Share button in Safari, then choose Add to Home Screen.
        </p>
      )}
    </div>
  )
}
