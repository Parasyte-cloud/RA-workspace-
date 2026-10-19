/* Where a menu opens relative to the button that opened it. */

export type Placement = { top: number; left: number; width: number }

const GAP = 10
const EDGE = 12

/** Where the sheet goes: under the button, right edges lined up, never off screen. */
export function placeBelow(anchor: { top: number; bottom: number; left: number; right: number }, view: { width: number; height: number }, wanted = 300): Placement {
  const width = Math.max(180, Math.min(wanted, view.width - EDGE * 2))
  const left = Math.min(Math.max(EDGE, anchor.right - width), view.width - EDGE - width)
  const top = Math.min(anchor.bottom + GAP, Math.max(EDGE, view.height - 120))
  return { top, left, width }
}
