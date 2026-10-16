// Phones: how tall the mail area can be. The page itself should not scroll, so
// the mail area gets whatever is left between where it starts and the fixed
// bottom menu. Measured on the device because the menu height varies.

export function mailAreaHeight(input: { top: number; scrollY: number; viewportHeight: number; bottomReserve: number }): number {
  const absoluteTop = input.top + input.scrollY
  const room = input.viewportHeight - absoluteTop - input.bottomReserve
  // Never smaller than a usable list, never larger than the screen.
  return Math.round(Math.min(Math.max(room, 320), input.viewportHeight))
}

// Height of whatever fixed bar sits at the bottom of the screen (0 if none).
export function bottomBarReserve(doc: Document, viewportWidth: number, viewportHeight: number): number {
  try {
    const stack = doc.elementsFromPoint(viewportWidth / 2, viewportHeight - 6)
    for (const element of stack) {
      let node: Element | null = element
      while (node && node !== doc.body) {
        if (getComputedStyle(node).position === 'fixed') {
          const rect = node.getBoundingClientRect()
          if (rect.bottom >= viewportHeight - 40 && rect.height < viewportHeight / 2) {
            return Math.round(viewportHeight - rect.top + 8)
          }
        }
        node = node.parentElement
      }
    }
  } catch {
    /* fall through */
  }
  return 0
}
