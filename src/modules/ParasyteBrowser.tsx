import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Home,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  PARASYTE_HOME,
  classifyParasyteTarget,
  parseEmbedOrigins,
  parseStorageTrustedOrigins,
  resolveParasyteInput,
  safeWebUrl
} from '../lib/parasytePolicy'
import '../parasyte.css'
import '../parasyte-browser-v2.css'

type ManagedLink = {
  id: string
  title: string
  url: string
  category: string
}

type Bookmark = {
  id: string
  title: string
  url: string
}

type ParasyteLayout = 'comfortable' | 'compact' | 'focus'
type FrameStatus = 'idle' | 'loading' | 'ready' | 'slow' | 'failed'

const MAX_HISTORY = 80
const FRAME_SLOW_MS = 7000
const FRAME_HARD_FAIL_MS = 20000

function displayAddress(value: string): string {
  return value === PARASYTE_HOME ? '' : value
}

function safeMessage(action: 'load' | 'save' | 'remove'): string {
  if (action === 'save') {
    return 'Unable to save this bookmark. Please try again.'
  }
  if (action === 'remove') {
    return 'Unable to remove this bookmark. Please try again.'
  }
  return 'Unable to load PArAsYtE browser links. Please refresh or sign in again.'
}

export default function ParasyteBrowser({
  initialUrl
}: {
  initialUrl?: string
}) {
  const [current, setCurrent] = useState(PARASYTE_HOME)
  const [address, setAddress] = useState('')
  const [layout, setLayout] = useState<ParasyteLayout>(() => {
    if (typeof window === 'undefined') {
      return 'comfortable'
    }
    const saved = window.localStorage.getItem('ridearrivo-parasyte-layout')
    return saved === 'compact' || saved === 'focus' || saved === 'comfortable'
      ? saved
      : 'comfortable'
  })
  const [history, setHistory] = useState<string[]>([PARASYTE_HOME])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [managed, setManaged] = useState<ManagedLink[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [userId, setUserId] = useState('')
  const [message, setMessage] = useState('')
  const [frameStatus, setFrameStatus] = useState<FrameStatus>('idle')
  const addressRef = useRef<HTMLInputElement>(null)
  const initialUrlRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const allowPrivateNetwork = import.meta.env.DEV
  const allowHttp = import.meta.env.DEV
  const searchTemplate = import.meta.env.VITE_PARASYTE_SEARCH_URL
  const embedOrigins = useMemo(
    () => parseEmbedOrigins(
      import.meta.env.VITE_PARASYTE_EMBED_ORIGINS,
      typeof window === 'undefined' ? undefined : window.location.origin
    ),
    []
  )
  const storageTrustedOrigins = useMemo(
    () => parseStorageTrustedOrigins(import.meta.env.VITE_PARASYTE_STORAGE_TRUSTED_ORIGINS),
    []
  )

  const currentPolicy = useMemo(
    () => classifyParasyteTarget(current, {
      embedOrigins,
      storageTrustedOrigins,
      allowPrivateNetwork,
      allowHttp
    }),
    [current, embedOrigins, storageTrustedOrigins, allowPrivateNetwork, allowHttp]
  )

  const changeLayout = (next: ParasyteLayout) => {
    setLayout(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ridearrivo-parasyte-layout', next)
    }
  }

  const loadLinks = useCallback(async () => {
    const client = supabase
    if (!client) {
      return
    }

    try {
      const {
        data: { user },
        error: userError
      } = await client.auth.getUser()

      if (userError) {
        throw userError
      }
      if (!mountedRef.current) {
        return
      }
      if (!user) {
        setUserId('')
        setManaged([])
        setBookmarks([])
        return
      }

      setUserId(user.id)

      const [managedResult, bookmarkResult] = await Promise.all([
        client
          .from('parasyte_managed_links')
          .select('id,title,url,category')
          .eq('active', true)
          .order('sort_order'),
        client
          .from('parasyte_bookmarks')
          .select('id,title,url')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
      ])

      if (managedResult.error) {
        throw managedResult.error
      }
      if (bookmarkResult.error) {
        throw bookmarkResult.error
      }
      if (!mountedRef.current) {
        return
      }

      setManaged((managedResult.data || []) as ManagedLink[])
      setBookmarks((bookmarkResult.data || []) as Bookmark[])
    } catch (error) {
      console.error('PArAsYtE link load failed:', error)
      if (mountedRef.current) {
        setMessage(safeMessage('load'))
      }
    }
  }, [])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  const navigate = useCallback((value: string, push = true) => {
    const resolved = value === PARASYTE_HOME
      ? PARASYTE_HOME
      : resolveParasyteInput(value, searchTemplate)

    setCurrent(resolved)
    setAddress(displayAddress(resolved))
    setMessage('')

    if (!push) {
      return
    }

    setHistory(previous => {
      if (previous[historyIndex] === resolved) {
        return previous
      }

      const base = previous.slice(0, historyIndex + 1)
      const appended = [...base, resolved]
      const next = appended.slice(-MAX_HISTORY)
      setHistoryIndex(next.length - 1)
      return next
    })
  }, [historyIndex, searchTemplate])

  useEffect(() => {
    const value = initialUrl?.trim()
    if (!value || initialUrlRef.current === value) {
      return
    }
    initialUrlRef.current = value
    navigate(value)
  }, [initialUrl, navigate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        addressRef.current?.focus()
        addressRef.current?.select()
        return
      }

      if (event.altKey && event.key === 'ArrowLeft' && historyIndex > 0) {
        event.preventDefault()
        const nextIndex = historyIndex - 1
        setHistoryIndex(nextIndex)
        navigate(history[nextIndex], false)
        return
      }

      if (
        event.altKey &&
        event.key === 'ArrowRight' &&
        historyIndex < history.length - 1
      ) {
        event.preventDefault()
        const nextIndex = historyIndex + 1
        setHistoryIndex(nextIndex)
        navigate(history[nextIndex], false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [history, historyIndex, navigate])

  useEffect(() => {
    if (currentPolicy.kind !== 'embed') {
      setFrameStatus('idle')
      return
    }

    setFrameStatus('loading')
    const slowTimeout = window.setTimeout(() => {
      setFrameStatus(status => status === 'loading' ? 'slow' : status)
    }, FRAME_SLOW_MS)
    // A destination that refuses framing (X-Frame-Options / CSP frame-ancestors)
    // fires neither `load` nor `error` in most browsers, so without this the
    // status would sit on "taking longer than expected" forever. Escalate to a
    // definite failure state instead of leaving the employee looking at a
    // vague, permanently-pending message.
    const hardFailTimeout = window.setTimeout(() => {
      setFrameStatus(status => (status === 'loading' || status === 'slow') ? 'failed' : status)
    }, FRAME_HARD_FAIL_MS)

    return () => {
      window.clearTimeout(slowTimeout)
      window.clearTimeout(hardFailTimeout)
    }
  }, [currentPolicy.kind, current, reloadKey])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    navigate(address)
  }

  const goBack = () => {
    if (historyIndex <= 0) {
      return
    }
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    navigate(history[nextIndex], false)
  }

  const goForward = () => {
    if (historyIndex >= history.length - 1) {
      return
    }
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    navigate(history[nextIndex], false)
  }

  const goHome = () => navigate(PARASYTE_HOME)

  const openCurrentExternal = () => {
    if (current === PARASYTE_HOME) {
      return
    }
    const parsed = safeWebUrl(current)
    if (!parsed) {
      return
    }
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
  }

  const saveBookmark = async () => {
    const client = supabase
    if (!client || !userId || current === PARASYTE_HOME) {
      return
    }

    const parsed = safeWebUrl(current)
    if (!parsed) {
      return
    }

    try {
      const { error } = await client
        .from('parasyte_bookmarks')
        .upsert(
          {
            user_id: userId,
            title: parsed.hostname,
            url: parsed.toString()
          },
          { onConflict: 'user_id,url' }
        )

      if (error) {
        throw error
      }

      if (mountedRef.current) {
        setMessage('Bookmark saved.')
      }
      await loadLinks()
    } catch (error) {
      console.error('PArAsYtE bookmark save failed:', error)
      if (mountedRef.current) {
        setMessage(safeMessage('save'))
      }
    }
  }

  const removeBookmark = async (bookmarkId: string) => {
    const client = supabase
    if (!client || !userId) {
      return
    }

    try {
      const { error } = await client
        .from('parasyte_bookmarks')
        .delete()
        .eq('id', bookmarkId)
        .eq('user_id', userId)

      if (error) {
        throw error
      }

      await loadLinks()
    } catch (error) {
      console.error('PArAsYtE bookmark remove failed:', error)
      if (mountedRef.current) {
        setMessage(safeMessage('remove'))
      }
    }
  }

  const categories = useMemo(() => {
    const grouped = new Map<string, ManagedLink[]>()
    for (const link of managed) {
      const list = grouped.get(link.category) || []
      list.push(link)
      grouped.set(link.category, list)
    }
    return [...grouped.entries()]
  }, [managed])

  const securityTitle = currentPolicy.kind === 'home'
    ? 'PArAsYtE home'
    : currentPolicy.kind === 'embed'
      ? 'Approved embedded origin'
      : currentPolicy.kind === 'blocked'
        ? 'Blocked destination'
        : currentPolicy.secure
          ? 'HTTPS site opens in a separate secure tab'
          : 'Insecure HTTP site is not embedded'

  return (
    <section
      className="parasyteBrowser parasyteBrowserV2"
      data-layout={layout}
      data-policy={currentPolicy.kind}
    >
      <div className="parasyteChrome">
        <div className="parasyteBrand">
          <img src="/parasyte-logo.png" alt="PArAsYtE" />
          <span>
            <strong>PArAsYtE</strong>
            <small>RideArrivo secure web</small>
          </span>
        </div>

        <div className="parasyteNavButtons">
          <button
            type="button"
            disabled={historyIndex <= 0}
            onClick={goBack}
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            disabled={historyIndex >= history.length - 1}
            onClick={goForward}
            title="Forward"
            aria-label="Forward"
          >
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            disabled={currentPolicy.kind !== 'embed'}
            onClick={() => setReloadKey(value => value + 1)}
            title="Reload embedded page"
            aria-label="Reload embedded page"
          >
            <RefreshCw size={16} />
          </button>
          <button type="button" onClick={goHome} title="Home" aria-label="Home">
            <Home size={16} />
          </button>
        </div>

        <form className="parasyteOmnibox" onSubmit={submit}>
          <span className={`parasyteSecurityIcon ${currentPolicy.kind}`} title={securityTitle}>
            {currentPolicy.kind === 'blocked' || !currentPolicy.secure
              ? <ShieldAlert size={15} />
              : <ShieldCheck size={15} />}
          </span>
          <input
            ref={addressRef}
            value={address}
            placeholder="Search the web or enter a web address"
            aria-label="Search or enter a web address"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)}
          />
          <button type="submit" title="Go" aria-label="Go">
            <Search size={16} />
          </button>
        </form>

        <div className="parasyteActions">
          <select
            className="parasyteLayoutSelect"
            value={layout}
            aria-label="PArAsYtE browser layout"
            title="PArAsYtE browser layout"
            onChange={(event: ChangeEvent<HTMLSelectElement>) => changeLayout(event.target.value as ParasyteLayout)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
            <option value="focus">Focus</option>
          </select>
          <button
            type="button"
            disabled={current === PARASYTE_HOME || currentPolicy.kind === 'blocked'}
            onClick={() => void saveBookmark()}
            title="Bookmark"
            aria-label="Bookmark current address"
          >
            <Star size={16} />
          </button>
          <button
            type="button"
            disabled={current === PARASYTE_HOME || currentPolicy.kind === 'blocked'}
            onClick={openCurrentExternal}
            title="Open in external browser"
            aria-label="Open current address in external browser"
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>

      <div className="parasyteTrustBar" aria-live="polite">
        <span className={`parasyteTrustDot ${currentPolicy.kind}`} />
        <strong>
          {currentPolicy.kind === 'home'
            ? 'RideArrivo secure web workspace'
            : currentPolicy.hostname || 'Blocked address'}
        </strong>
        <span>{currentPolicy.reason}</span>
      </div>

      {message && <div className="moduleNotice" role="status">{message}</div>}

      <div className="parasyteBody">
        <aside className="parasyteSidebar">
          <div className="parasyteSidebarTitle">Managed</div>

          {categories.map(([category, links]) => (
            <div className="parasyteLinkGroup" key={category}>
              <small>{category}</small>
              {links.map(link => (
                <button
                  type="button"
                  key={link.id}
                  title={link.title}
                  aria-label={link.title}
                  onClick={() => navigate(link.url)}
                >
                  <Globe2 size={14} />
                  <span>{link.title}</span>
                </button>
              ))}
            </div>
          ))}

          <div className="parasyteSidebarTitle personal">My bookmarks</div>

          {bookmarks.map(bookmark => (
            <div className="parasyteBookmark" key={bookmark.id}>
              <button type="button" onClick={() => navigate(bookmark.url)}>
                <Star size={13} />
                <span>{bookmark.title}</span>
              </button>
              <button
                type="button"
                className="remove"
                onClick={() => void removeBookmark(bookmark.id)}
                title="Remove bookmark"
                aria-label={`Remove ${bookmark.title} bookmark`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {bookmarks.length === 0 && (
            <span className="parasyteNoBookmarks">No bookmarks yet.</span>
          )}
        </aside>

        <main className="parasyteViewport">
          {currentPolicy.kind === 'home' ? (
            <div className="parasyteHome parasyteHomeV2">
              <img src="/parasyte-logo.png" alt="" />
              <span className="eyebrow">RIDEARRIVO SECURE WEB WORKSPACE</span>
              <h2>PArAsYtE</h2>
              <p>
                Launch approved RideArrivo tools or search the web. Third-party sites open
                in a separate secure tab unless their origin is explicitly approved for embedding.
              </p>

              <form className="parasyteHomeSearch" onSubmit={submit}>
                <Search size={20} />
                <input
                  value={address}
                  placeholder="Search the web"
                  aria-label="Search the web"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)}
                />
                <button type="submit">Search</button>
              </form>

              <div className="parasyteHomeLinks">
                {managed.slice(0, 8).map(link => (
                  <button type="button" key={link.id} onClick={() => navigate(link.url)}>
                    <Globe2 size={17} />
                    <span>{link.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : currentPolicy.kind === 'blocked' ? (
            <div className="parasyteExternalNotice parasyteBlockedNotice">
              <img src="/parasyte-logo.png" alt="" />
              <ShieldAlert size={30} />
              <h3>Navigation blocked</h3>
              <p>{currentPolicy.reason}</p>
              <code>{current}</code>
              <button type="button" onClick={goHome}>
                <Home size={16} />
                Return home
              </button>
            </div>
          ) : currentPolicy.kind === 'external' ? (
            <div className="parasyteExternalNotice">
              <img src="/parasyte-logo.png" alt="" />
              {currentPolicy.secure
                ? <ShieldCheck size={30} />
                : <ShieldAlert size={30} />}
              <h3>Open in a secure browser tab</h3>
              <p>
                PArAsYtE does not weaken another website's frame protections. This destination
                is not on RideArrivo's explicit embedded-origin allowlist, so it opens outside
                the intranet frame.
              </p>
              <code>{current}</code>
              <div className="parasyteExternalActions">
                <button type="button" onClick={openCurrentExternal}>
                  <ExternalLink size={16} />
                  Open secure tab
                </button>
                <button type="button" className="secondary" onClick={goHome}>
                  <Home size={16} />
                  Home
                </button>
              </div>
            </div>
          ) : (
            <div className="parasyteFrameShell">
              <div className="parasyteFrameStatus" aria-live="polite">
                <span className={`parasyteFrameDot ${frameStatus}`} />
                <span>
                  {frameStatus === 'loading' && 'Loading approved site...'}
                  {frameStatus === 'ready' && 'Approved embedded site loaded'}
                  {frameStatus === 'slow' && 'This site is taking longer than expected'}
                  {frameStatus === 'failed' && 'The embedded site could not be loaded'}
                  {frameStatus === 'idle' && 'Ready'}
                </span>
                {(frameStatus === 'slow' || frameStatus === 'failed') && (
                  <button type="button" onClick={() => setReloadKey(value => value + 1)}>
                    <RefreshCw size={13} />
                    Retry
                  </button>
                )}
                <button type="button" onClick={openCurrentExternal}>
                  <ExternalLink size={13} />
                  Open outside
                </button>
              </div>
              <iframe
                key={`${current}-${reloadKey}`}
                title="PArAsYtE browser view"
                src={current}
                referrerPolicy="no-referrer"
                sandbox={
                  currentPolicy.allowSameOrigin
                    ? 'allow-forms allow-scripts allow-popups allow-same-origin'
                    : 'allow-forms allow-scripts allow-popups'
                }
                allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'; clipboard-read 'none'; clipboard-write 'none'"
                onLoad={() => setFrameStatus('ready')}
                onError={() => setFrameStatus('failed')}
              />
              {(frameStatus === 'slow' || frameStatus === 'failed') && (
                <div className="parasyteFrameFallback">
                  If the page is blank, its server may block framing. Open it outside PArAsYtE
                  rather than weakening the site's security policy.
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </section>
  )
}
