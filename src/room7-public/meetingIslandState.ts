// Pure rules for the meeting bar, kept free of imports so tests can load them.
export const ISLAND_IDLE_MS = 7000

// Whether the bar may shrink because nothing has touched the screen for a
// while. Never while a menu is open or the pointer or focus is on the bar.
export function shouldIdleCompact(input: { idleMs: number; overBar: boolean; menuOpen: boolean }): boolean {
  return input.idleMs >= ISLAND_IDLE_MS && !input.overBar && !input.menuOpen
}

