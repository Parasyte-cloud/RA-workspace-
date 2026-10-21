/*
 * Keeps a call usable while the person is in another app.
 *
 * Browser/PWA limits still apply: iOS/Android may suspend a web page after a
 * manual phone lock or long background period. This helper makes the web path
 * as resilient as the platform allows and restores media/reconnects on return.
 */
type SearchRoot = Document | ShadowRoot | Element

type SafariVideo = HTMLVideoElement & {
  webkitPresentationMode?: string
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  requestPictureInPicture?: () => Promise<unknown>
  disablePictureInPicture?: boolean
}

type WakeSentinel = {
  release: () => Promise<void>
  addEventListener?: (type: 'release', cb: () => void) => void
}

type Options = {
  name: string
  video: boolean
  onHangUp: () => void
  findVideo: () => HTMLVideoElement | null
}

const NOTIFY_TAG = 'ra-call-live'

function collectMedia(root: SearchRoot, out: HTMLMediaElement[]) {
  root.querySelectorAll('audio,video').forEach(node => {
    if (node instanceof HTMLMediaElement && !out.includes(node)) out.push(node)
  })
  root.querySelectorAll('*').forEach(node => {
    const shadow = (node as HTMLElement).shadowRoot
    if (shadow) collectMedia(shadow, out)
  })
}

function mediaElements(root: SearchRoot = document): HTMLMediaElement[] {
  const out: HTMLMediaElement[] = []
  collectMedia(root, out)
  return out
}

export function findCallVideo(root: SearchRoot = document): HTMLVideoElement | null {
  const videos = mediaElements(root).filter(
    (item): item is HTMLVideoElement => item instanceof HTMLVideoElement,
  )
  if (!videos.length) return null
  return videos
    .slice()
    .sort((a, b) => {
      const aReady = a.readyState >= 2 ? 1 : 0
      const bReady = b.readyState >= 2 ? 1 : 0
      if (aReady !== bReady) return bReady - aReady
      return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
    })[0]
}

export function resumeCallMedia(root: SearchRoot = document) {
  for (const media of mediaElements(root)) {
    if (media instanceof HTMLVideoElement) media.playsInline = true
    const source = media as HTMLMediaElement & { srcObject?: MediaProvider | null }
    if (!media.paused || (!source.srcObject && !media.currentSrc)) continue
    void media.play().catch(() => undefined)
  }
}

export function canFloatVideo(): boolean {
  if (typeof document === 'undefined' || typeof HTMLVideoElement === 'undefined') return false
  if (Boolean((document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled)) {
    return true
  }
  const proto = HTMLVideoElement.prototype as SafariVideo
  return typeof proto.webkitSetPresentationMode === 'function'
}

export async function floatVideo(el: HTMLVideoElement | null): Promise<boolean> {
  if (!el) return false
  const video = el as SafariVideo
  video.playsInline = true
  video.disablePictureInPicture = false

  try {
    const doc = document as Document & {
      pictureInPictureElement?: Element | null
      exitPictureInPicture?: () => Promise<void>
    }
    if (doc.pictureInPictureElement) {
      if (doc.pictureInPictureElement === el) {
        await doc.exitPictureInPicture?.()
        return false
      }
      await doc.exitPictureInPicture?.()
    }
    if (typeof video.requestPictureInPicture === 'function') {
      await video.requestPictureInPicture()
      return true
    }
  } catch {
    // Safari's presentation-mode API below may still work.
  }

  try {
    if (typeof video.webkitSetPresentationMode === 'function') {
      if (video.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode('inline')
        return false
      }
      if (
        !video.webkitSupportsPresentationMode ||
        video.webkitSupportsPresentationMode('picture-in-picture')
      ) {
        video.webkitSetPresentationMode('picture-in-picture')
        return true
      }
    }
  } catch {
    // PiP is optional. The in-app mini call remains available.
  }
  return false
}

async function showLiveNotice(name: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker?.getRegistration()
    if (!reg) return
    await reg.showNotification('Call in progress', {
      body: `${name}. Tap to return to the call.`,
      tag: NOTIFY_TAG,
      silent: true,
      data: { url: `${location.pathname}${location.search}${location.hash}` },
    } as NotificationOptions)
  } catch {
    // The notice is a convenience only.
  }
}

async function clearLiveNotice() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const list = (await reg?.getNotifications({ tag: NOTIFY_TAG })) || []
    for (const item of list) item.close()
  } catch {
    // Nothing to clear.
  }
}

export function startCallKeepAlive(options: Options): () => void {
  let stopped = false
  let lock: WakeSentinel | null = null
  let acquiring = false

  const holdScreen = async () => {
    if (stopped || acquiring || lock || document.visibilityState !== 'visible') return
    try {
      const wake = (navigator as Navigator & {
        wakeLock?: { request: (kind: 'screen') => Promise<WakeSentinel> }
      }).wakeLock
      if (!wake) return
      acquiring = true
      const next = await wake.request('screen')
      if (stopped) {
        void next.release().catch(() => undefined)
        return
      }
      lock = next
      next.addEventListener?.('release', () => {
        if (lock === next) lock = null
        if (!stopped && document.visibilityState === 'visible') {
          window.setTimeout(() => void holdScreen(), 0)
        }
      })
    } catch {
      lock = null
    } finally {
      acquiring = false
    }
  }

  const session = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession
  const setHandler = (action: string, handler: (() => void) | null) => {
    try {
      session?.setActionHandler(action as MediaSessionAction, handler)
    } catch {
      // Action not supported here.
    }
  }

  try {
    if (session && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({
        title: options.name,
        artist: 'RideArrivo Workspace',
      })
      session.playbackState = 'playing'
    }
  } catch {
    // Metadata is optional.
  }

  setHandler('hangup', options.onHangUp)
  if (options.video) {
    setHandler('enterpictureinpicture', () => {
      void floatVideo(options.findVideo())
    })
  }

  const onLifecycle = () => {
    if (document.visibilityState === 'hidden') {
      void showLiveNotice(options.name)
      return
    }
    void clearLiveNotice()
    void holdScreen()
    resumeCallMedia()
  }

  document.addEventListener('visibilitychange', onLifecycle)
  window.addEventListener('pageshow', onLifecycle)
  window.addEventListener('focus', onLifecycle)
  window.addEventListener('online', onLifecycle)
  void holdScreen()
  resumeCallMedia()

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onLifecycle)
    window.removeEventListener('pageshow', onLifecycle)
    window.removeEventListener('focus', onLifecycle)
    window.removeEventListener('online', onLifecycle)
    const held = lock
    lock = null
    if (held) void held.release().catch(() => undefined)
    setHandler('hangup', null)
    setHandler('enterpictureinpicture', null)
    try {
      if (session) {
        session.metadata = null
        session.playbackState = 'none'
      }
    } catch {
      // Ignore cleanup failures.
    }
    void clearLiveNotice()
  }
}
