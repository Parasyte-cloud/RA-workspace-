import { useEffect, useMemo, useState } from 'react'
import {
  AppWindow,
  BriefcaseBusiness,
  Building2,
  Cloud,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Mail,
  Search,
  ShieldCheck,
  Star,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type WorkspaceApp = {
  id?: string
  name: string
  slug: string
  description?: string | null
  url?: string | null
  mode?: string | null
  category?: string | null
  provider?: string | null
  icon_key?: string | null
  allowed_roles?: string[] | null
  allowed_departments?: string[] | null
  is_featured?: boolean
  sort_order?: number
}

function iconFor(key?: string | null) {
  switch (key) {
    case 'folder':
    case 'onedrive':
    case 'sharepoint':
    case 'drive':
      return FolderOpen

    case 'excel':
    case 'sheets':
      return FileSpreadsheet

    case 'mail':
      return Mail

    case 'database':
      return Database

    case 'shield':
      return ShieldCheck

    case 'teams':
    case 'meet':
      return Users

    case 'bank':
    case 'payments':
      return BriefcaseBusiness

    case 'cloud':
    case 'deployment':
    case 'server':
      return Cloud

    case 'microsoft':
    case 'google':
    case 'wps':
      return AppWindow

    default:
      return Building2
  }
}

export default function ApplicationsHub() {
  const [apps, setApps] = useState<WorkspaceApp[]>([])
  const [role, setRole] = useState('')
  const [department, setDepartment] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [favorites, setFavorites] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('ridearrivo-app-favorites')

    if (stored) {
      try {
        setFavorites(JSON.parse(stored))
      } catch {
        setFavorites([])
      }
    }

    load()
  }, [])

  async function load() {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('You must be signed in.')

      const { data: profile } = await supabase
        .from('employee_profiles')
        .select('role,department')
        .eq('id', user.id)
        .single()

      const currentRole = String(profile?.role || '').toLowerCase()
      const currentDepartment = String(profile?.department || '').toLowerCase()

      setRole(currentRole)
      setDepartment(currentDepartment)

      const { data, error: appsError } = await supabase
        .from('workspace_apps')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (appsError) throw appsError

      setApps((data || []) as WorkspaceApp[])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load workspace applications.'
      )
    } finally {
      setLoading(false)
    }
  }

  const visibleApps = useMemo(() => {
    return apps.filter((app) => {
      const roles = app.allowed_roles || []
      const departments = app.allowed_departments || []

      const roleAllowed =
        roles.length === 0 ||
        roles.map((item) => item.toLowerCase()).includes(role)

      const departmentAllowed =
        departments.length === 0 ||
        departments
          .map((item) => item.toLowerCase())
          .includes(department)

      return roleAllowed && departmentAllowed
    })
  }, [apps, role, department])

  const categories = useMemo(() => {
    return [
      'All',
      ...Array.from(
        new Set(
          visibleApps
            .map((app) => app.category)
            .filter(Boolean) as string[]
        )
      ),
    ]
  }, [visibleApps])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    return visibleApps.filter((app) => {
      if (category !== 'All' && app.category !== category) {
        return false
      }

      if (!q) return true

      return [
        app.name,
        app.description,
        app.category,
        app.provider,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [visibleApps, query, category])

  const featured = visibleApps.filter(
    (app) => app.is_featured || favorites.includes(app.slug)
  )

  function toggleFavorite(slug: string) {
    const next = favorites.includes(slug)
      ? favorites.filter((item) => item !== slug)
      : [...favorites, slug]

    setFavorites(next)

    localStorage.setItem(
      'ridearrivo-app-favorites',
      JSON.stringify(next)
    )
  }

  function openApp(app: WorkspaceApp) {
    if (!app.url) return

    window.open(
      app.url,
      '_blank',
      'noopener,noreferrer'
    )
  }

  if (loading) {
    return (
      <section>
        <div className="glassCard appHubState">
          Loading company applications…
        </div>
      </section>
    )
  }

  return (
    <section className="applicationsHub">
      <div className="sectionTitle">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>Applications</h2>
          <p>
            Microsoft 365, Google Workspace, WPS, RideArrivo systems
            and company productivity tools in one place.
          </p>
        </div>
      </div>

      {error && (
        <div className="glassCard appHubError">
          {error}
        </div>
      )}

      {featured.length > 0 && (
        <div className="appFeatured">
          {featured.slice(0, 8).map((app) => {
            const Icon = iconFor(app.icon_key)

            return (
              <button
                key={app.slug}
                className="glassCard appFeaturedCard"
                onClick={() => openApp(app)}
                disabled={!app.url}
              >
                <Icon size={20} />
                <div>
                  <strong>{app.name}</strong>
                  <span>{app.provider}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="glassCard appHubToolbar">
        <label className="appHubSearch">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search applications..."
          />
        </label>

        <div className="appCategories">
          {categories.map((item) => (
            <button
              key={item}
              className={
                category === item
                  ? 'appCategory active'
                  : 'appCategory'
              }
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="appGrid">
        {filtered.map((app) => {
          const Icon = iconFor(app.icon_key)
          const isFavorite = favorites.includes(app.slug)

          return (
            <article
              className="glassCard appCard"
              key={app.slug}
            >
              <div className="appCardTop">
                <div className="appIcon">
                  <Icon size={21} />
                </div>

                <button
                  className={
                    isFavorite
                      ? 'appFavorite active'
                      : 'appFavorite'
                  }
                  onClick={() =>
                    toggleFavorite(app.slug)
                  }
                  title="Favorite"
                >
                  <Star
                    size={16}
                    fill={
                      isFavorite
                        ? 'currentColor'
                        : 'none'
                    }
                  />
                </button>
              </div>

              <div className="appCardBody">
                <span className="eyebrow">
                  {app.category || app.provider}
                </span>

                <h3>{app.name}</h3>

                <p>
                  {app.description ||
                    'RideArrivo workspace application.'}
                </p>
              </div>

              <button
                className="glassButton appLaunch"
                onClick={() => openApp(app)}
                disabled={!app.url}
              >
                {app.url ? (
                  <>
                    Open
                    <ExternalLink size={15} />
                  </>
                ) : (
                  'Setup required'
                )}
              </button>
            </article>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="glassCard appHubState">
          No applications match this filter.
        </div>
      )}
    </section>
  )
}
