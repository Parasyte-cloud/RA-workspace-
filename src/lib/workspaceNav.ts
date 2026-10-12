/*
 * Sidebar layout, favourites, recent pages and "go to" matching.
 *
 * Pure functions on purpose: no React, no storage except the two small
 * helpers at the bottom, so the rules can be tested without a browser.
 *
 * What this file never does is decide who may open a section. Access still
 * comes from canAccess() in App.tsx and from row-level security in the
 * database. The list passed in is already filtered; this only decides where
 * each visible item is shown. Hiding an item here is a layout choice, not a
 * permission.
 */

export type NavItemLike = readonly [id: string, label: string, ...rest: unknown[]]

// The things people open every day. Always visible. My Profile stands alone
// here like Chat and Mail, and is also still reachable from the avatar menu.
export const PINNED_IDS = ['overview', 'tasks', 'chat', 'mail', 'calendar', 'profile'] as const

// Shared company services. One collapsed group.
export const COMPANY_IDS = [
  'projects',
  'announcements',
  'social',
  'room',
  'knowledge',
  'files',
  'brand',
  'letterhead',
  'crm',
  'parasyte',
  'apps',
] as const

// Department workstations. Only the person's primary one is shown up front.
export const WORKSTATION_IDS = [
  'executive',
  'support',
  'operations',
  'people',
  'engineering',
  'linux',
  'finance',
  'vendors',
  'marketing',
  'partnerships',
  'legal',
  'deptadmin',
] as const

// Reached from the avatar menu instead of the sidebar.
export const MENU_IDS = ['profile', 'gallery', 'settings'] as const

export const DEFAULT_FAVOURITES = ['projects'] as const
export const MAX_FAVOURITES = 8
export const MAX_RECENT = 5

export type SidebarGroup<T> = { id: string; label: string; items: T[] }

export type Sidebar<T> = {
  pinned: T[]
  favourites: T[]
  mine: T[]
  groups: SidebarGroup<T>[]
  system: T[]
  menu: T[]
}

export function buildSidebar<T extends NavItemLike>(
  items: readonly T[],
  options: { primarySection?: string | null; favourites?: readonly string[] } = {},
): Sidebar<T> {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(item[0], item)

  const placed = new Set<string>()
  const take = (ids: readonly string[]) => {
    const out: T[] = []
    for (const id of ids) {
      const item = byId.get(id)
      if (item && !placed.has(id)) {
        placed.add(id)
        out.push(item)
      }
    }
    return out
  }

  const pinned = take(PINNED_IDS)
  const mine = options.primarySection ? take([options.primarySection]) : []
  const system = take(['admin'])
  const menu = take(MENU_IDS)
  const company = take(COMPANY_IDS)
  const workstations = take(WORKSTATION_IDS)

  // Anything the lists above do not know about still gets a home, so a new
  // section can never become unreachable.
  const leftover = take(items.map(item => item[0]))
  company.push(...leftover)

  const groups: SidebarGroup<T>[] = []
  if (company.length) groups.push({ id: 'company', label: 'Company', items: company })
  if (workstations.length) {
    groups.push({
      id: 'workstations',
      label: mine.length ? 'More workstations' : 'Workstations',
      items: workstations,
    })
  }

  const favourites: T[] = []
  for (const id of options.favourites ?? []) {
    const item = byId.get(id)
    if (item && !favourites.includes(item)) favourites.push(item)
  }

  return { pinned, favourites, mine, groups, system, menu }
}

export function sanitizeIds(raw: unknown, valid: ReadonlySet<string>, max: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const value of raw) {
    if (typeof value === 'string' && valid.has(value) && !out.includes(value)) out.push(value)
    if (out.length >= max) break
  }
  return out
}

export function toggleFavourite(
  current: readonly string[],
  id: string,
  valid: ReadonlySet<string>,
): string[] {
  if (!valid.has(id)) return [...current]
  if (current.includes(id)) return current.filter(value => value !== id)
  return [...current, id].slice(-MAX_FAVOURITES)
}

export function pushRecent(current: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...current.filter(value => value !== id)].slice(0, max)
}

// Old and informal names, so people who search for what they used to call
// something still land on the right place after labels change.
export const SECTION_ALIASES: Record<string, string[]> = {
  overview: ['home', 'today', 'dashboard'],
  profile: ['my profile', 'account', 'me'],
  gallery: ['headshots', 'photos', 'my headshots'],
  social: ['pulse', 'feed'],
  announcements: ['news', 'updates', 'notices'],
  files: ['documents', 'company files', 'drive'],
  brand: ['logo', 'logos', 'brand library'],
  letterhead: ['letter', 'stationery'],
  knowledge: ['policy', 'policies', 'wiki', 'docs', 'help'],
  people: ['hr', 'leave', 'people and hr', 'holiday'],
  support: ['customer', 'cases', 'help desk'],
  operations: ['ops', 'dispatch', 'fleet'],
  finance: ['payments', 'invoices', 'accounting', 'money'],
  admin: ['administration', 'backups', 'backup', 'access', 'security'],
  room: ['room 7', 'meeting', 'video', 'call'],
  settings: ['preferences', 'appearance', 'theme'],
  executive: ['ceo', 'management'],
  deptadmin: ['department admin'],
}

export type GoToSection = { id: string; label: string }

export function matchSections(
  query: string,
  sections: readonly GoToSection[],
  max = 6,
): GoToSection[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const scored: { section: GoToSection; score: number }[] = []
  for (const section of sections) {
    const label = section.label.toLowerCase()
    const names = [label, section.id.toLowerCase(), ...(SECTION_ALIASES[section.id] ?? [])]
    let score = 0
    if (names.some(name => name === needle)) score = 4
    else if (names.some(name => name.startsWith(needle))) score = 3
    else if (names.some(name => name.split(/\s+/).some(word => word.startsWith(needle)))) score = 2
    else if (needle.length >= 3 && names.some(name => name.includes(needle))) score = 1
    if (score > 0) scored.push({ section, score })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(entry => entry.section)
}

/* ---- storage -------------------------------------------------------- */
/*
 * Favourites and recent pages live in this browser only. That is enough for
 * a convenience, and the app works with storage blocked. A person who signs
 * in on another device starts with the defaults.
 */

export const favouritesKey = (userId: string) => `ridearrivo-nav-favourites:${userId}`
export const recentKey = (userId: string) => `ridearrivo-nav-recent:${userId}`

export function readList(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null
  } catch {
    return null
  }
}

export function writeList(key: string, value: readonly string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage blocked or full: the feature simply does not persist */
  }
}
