import { useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Menu as MenuIcon, X as CloseIcon } from 'lucide-react'

type NavItem = readonly [id: string, label: string, Icon: LucideIcon, ...rest: unknown[]]
type Groups = {
  pinned: NavItem[]
  favourites: NavItem[]
  mine: NavItem[]
  groups: { id: string; label: string; items: NavItem[] }[]
  system: NavItem[]
}

const TAB_IDS = ['overview', 'tasks', 'chat', 'mail']

// Phone navigation: four daily tabs along the bottom and a "More" sheet that
// lists every section the person can open, grouped like the desktop sidebar.
// It only changes how the existing list is shown. Who may open a section is
// still decided by the filtered list passed in from App.
export default function PhoneNav({
  nav,
  groups,
  section,
  open,
  onOpenChange,
  onPick,
}: {
  nav: readonly NavItem[]
  groups: Groups
  section: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (id: string) => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const byId = new Map(nav.map(item => [item[0], item] as const))
  const tabs = TAB_IDS.map(id => byId.get(id)).filter(Boolean) as NavItem[]
  const inTabs = TAB_IDS.includes(section)

  const row = ([id, label, Icon]: NavItem) => (
    <button
      key={id}
      type="button"
      className={`phoneMoreItem${section === id ? ' active' : ''}`}
      aria-current={section === id ? 'page' : undefined}
      onClick={() => onPick(id)}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  )

  const blocks: { key: string; label: string; items: NavItem[] }[] = [
    { key: 'pinned', label: 'Daily', items: groups.pinned.filter(item => !TAB_IDS.includes(item[0])) },
    { key: 'fav', label: 'Favourites', items: groups.favourites },
    { key: 'mine', label: 'My workstation', items: groups.mine },
    ...groups.groups.map(group => ({ key: group.id, label: group.label, items: group.items })),
    { key: 'system', label: 'Administration', items: groups.system },
  ].filter(block => block.items.length > 0)

  return (
    <>
      <nav className="phoneTabs" aria-label="Main navigation">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={section === id ? 'active' : ''}
            aria-current={section === id ? 'page' : undefined}
            onClick={() => onPick(id)}
          >
            <Icon size={21} />
            <span>{label === 'Dashboard' ? 'Home' : label}</span>
          </button>
        ))}
        <button
          type="button"
          className={open || !inTabs ? 'active' : ''}
          aria-expanded={open}
          aria-controls="phone-more-sheet"
          onClick={() => onOpenChange(!open)}
        >
          <MenuIcon size={21} />
          <span>More</span>
        </button>
      </nav>

      {open && (
        <div className="phoneMoreLayer">
          <button type="button" className="phoneMoreScrim" aria-label="Close menu" onClick={() => onOpenChange(false)} />
          <div id="phone-more-sheet" className="phoneMoreSheet" role="dialog" aria-modal="true" aria-label="All sections">
            <header>
              <strong>All sections</strong>
              <button type="button" aria-label="Close" onClick={() => onOpenChange(false)}>
                <CloseIcon size={20} />
              </button>
            </header>
            <div className="phoneMoreBody">
              {blocks.map(block => (
                <section key={block.key}>
                  <h3>{block.label}</h3>
                  <div className="phoneMoreGrid">{block.items.map(row)}</div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
