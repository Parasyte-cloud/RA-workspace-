/*
 * Keeps a call usable while the person is in another app.
 *
 *  - The screen stays awake during the call (Wake Lock), and is asked for again
 *    when the app comes back to the front, because the browser drops it when
 *    the page is hidden.
 *  - The phone shows "Call with ..." in its media controls with a hang up
 *    button (Media Session), so the call can be ended without opening the app.
 *  - While the app is in the background a quiet "Call in progress" notification
 *    sits in the shade; tapping it returns to the app.
 *  - Video calls can float over other apps in a small window (Picture in
 *    Picture) where the phone allows it.
 *  - Sound is nudged to carry on when the app returns.
 *
 * Every part is optional: a browser without one of these simply skips it.
 */

type Options = {
  name: string
  video: boolean
  onHangUp: () => void
  findVideo: () => HTMLVideoElement | null
}

const NOTIFY_TAG = 'ra-call-live'

export function canFloatVideo(): boolean {
  return typeof document !== 'undefined' && Boolean((document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled)
}

export async function floatVideo(el: HTMLVideoElement | null): Promise<boolean> {
  if (!el || !canFloatVideo()) return false
  try {
    if ((document as Document & { pictureInPictureElement?: Element | null }).pictureInPictureElement) {
      await (document as Document & { exitPictureInPicture: () => Promise<void> }).exitPictureInPicture()
      return false
    }
    await (el as HTMLVideoElement & { requestPictureInPicture: () => Promise<unknown> }).requestPictureInPicture()
    return true
  } catch {
    return false
  }
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
      data: { url: `${location.pathname}${location.search}` }
    } as NotificationOptions)
  } catch { /* the notice is a convenience only */ }
}

async function clearLiveNotice() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const list = (await reg?.getNotifications({ tag: NOTIFY_TAG })) || []
    for (const item of list) item.close()
  } catch { /* nothing to clear */ }
}

export function startCallKeepAlive(options: Options): () => void {
  let stopped = false
  let lock: { release: () => Promise<void> } | null = null

  const holdScreen = async () => {
    try {
      const wake = (navigator as Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      if (!wake || stopped || document.visibilityState !== 'visible') return
      lock = await wake.request('screen')
    } catch { lock = null }
  }

  const session = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession
  const setHandler = (action: string, handler: (() => void) | null) => {
    try { session?.setActionHandler(action as MediaSessionAction, handler) } catch { /* action not supported here */ }
  }
  try {
    if (session && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({ title: `Call with ${options.name}`, artist: 'RideArrivo Workspace' })
      session.playbackState = 'playing'
    }
  } catch { /* metadata is optional */ }
  setHandler('hangup', options.onHangUp)
  if (options.video) {
    setHandler('enterpictureinpicture', () => { void floatVideo(options.findVideo()) })
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      void showLiveNotice(options.name)
    } else {
      void clearLiveNotice()
      void holdScreen()
      // Bring sound back if the phone paused it while the app was away.
      document.querySelectorAll('audio').forEach(audio => { if (audio.paused) void audio.play().catch(() => {}) })
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  void holdScreen()

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisibility)
    void lock?.release().catch(() => {})
    setHandler('hangup', null)
    setHandler('enterpictureinpicture', null)
    try { if (session) { session.metadata = null; session.playbackState = 'none' } } catch { /* ignore */ }
    void clearLiveNotice()
  }
}
