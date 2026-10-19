/*
 * Can this device share its screen in a call?
 *
 * Capturing a screen needs navigator.mediaDevices.getDisplayMedia. Desktop
 * Chrome, Edge, Firefox and Safari have it. iPhone and Android phone browsers
 * do not, and no setting or app update on our side changes that. Viewing
 * someone else's shared screen works everywhere, so a phone can still watch.
 */

type MediaNav = { mediaDevices?: { getDisplayMedia?: unknown } } | undefined

export function canCaptureScreen(nav: MediaNav = typeof navigator === 'undefined' ? undefined : (navigator as MediaNav)): boolean {
  return typeof nav?.mediaDevices?.getDisplayMedia === 'function'
}

/** Words for the sheet shown when someone taps Share on a device that cannot. */
export function screenShareHelp(): { title: string; body: string } {
  return {
    title: 'Sharing is not available on this device',
    body: 'Phone browsers, on both iPhone and Android, do not let a web page capture the screen. You can still see anyone else’s shared screen on this call. To share yours, join the call from a computer, or from an iPad where the browser allows it.'
  }
}

/** A screen is only worth showing when the other person is sharing and the video has arrived. */
export function sharedScreenTrack(p: { screenShareEnabled?: boolean; screenShareTracks?: { video?: MediaStreamTrack } } | undefined): MediaStreamTrack | undefined {
  return p?.screenShareEnabled ? p.screenShareTracks?.video : undefined
}
