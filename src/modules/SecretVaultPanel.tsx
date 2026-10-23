import {
  AlertTriangle,
  Clock3,
  Eye,
  EyeOff,
  FileLock2,
  FileText,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  authorizeReveal,
  createDocumentSecret,
  MAX_VAULT_FILE_BYTES,
  createTextSecret,
  decodeBase64,
  deleteVaultItem,
  hideReveal,
  listVault,
  readReveal,
  vaultPreview,
  type VaultItem,
} from '../lib/secretVault'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SecretVaultSharing from './SecretVaultSharing'
import { currentViewer } from '../lib/secretVaultSharing'
import './secret-vault.css'

type SecretKind = 'text' | 'number' | 'document'
type Classification = 'restricted' | 'highly_restricted'

type RevealedState = {
  item: VaultItem
  token: string
  expiresAt: string
  value?: string
  documentUrl?: string
  preview?: 'pdf' | 'image' | 'none'
}

const friendlyVaultError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || '')
  const normalized = raw.toLowerCase()

  if (normalized.includes('authentication') || normalized.includes('sign in')) {
    return 'Your secure session has expired. Sign in again to access the vault.'
  }

  if (normalized.includes('permission') || normalized.includes('403')) {
    return 'You do not have permission to perform this vault action.'
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('non-2xx') ||
    normalized.includes('vault operation failed')
  ) {
    return 'Secure storage could not be reached. Please retry.'
  }

  return raw || 'The vault could not complete that request.'
}

const formatBytes = (bytes: number | null) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

const maskValue = (item: VaultItem) => {
  if (item.kind === 'document') return item.original_filename || 'Protected document'
  if (item.last_four) return `•••• •••• ${item.last_four}`
  return '••••••••••••'
}

export default function SecretVaultPanel() {
  const [items, setItems] = useState<VaultItem[]>([])
  const [viewer, setViewer] = useState<{ id: string; isAdmin: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | SecretKind>('all')

  const [showCreate, setShowCreate] = useState(false)
  const [kind, setKind] = useState<SecretKind>('text')
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [classification, setClassification] =
    useState<Classification>('highly_restricted')
  const [revealSeconds, setRevealSeconds] = useState(30)
  const [file, setFile] = useState<File | null>(null)
  const [creating, setCreating] = useState(false)

  const [revealItem, setRevealItem] = useState<VaultItem | null>(null)
  const [purpose, setPurpose] = useState('')
  const [requestedSeconds, setRequestedSeconds] = useState(30)
  const [authorizing, setAuthorizing] = useState(false)
  const [revealed, setRevealed] = useState<RevealedState | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const revealRef = useRef<RevealedState | null>(null)

  useEffect(() => {
    revealRef.current = revealed
  }, [revealed])

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    setError('')

    try {
      const result = await listVault()
      setItems(result.items)
    } catch (err) {
      setError(friendlyVaultError(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Only used to hide Delete where the server would refuse it. If this cannot
  // be read, Delete stays visible and the server still decides.
  useEffect(() => {
    let alive = true
    currentViewer().then((v) => alive && setViewer(v)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const conceal = useCallback(async () => {
    const active = revealRef.current

    if (active?.documentUrl) {
      URL.revokeObjectURL(active.documentUrl)
    }

    setRevealed(null)
    setSecondsLeft(0)

    if (active?.token) {
      try {
        await hideReveal(active.token)
      } catch {
        // Conceal locally even if remote revocation cannot complete.
      }
    }
  }, [])

  useEffect(() => {
    if (!revealed) return

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(revealed.expiresAt).getTime() - Date.now()) / 1000),
      )

      setSecondsLeft(remaining)

      if (remaining <= 0) {
        void conceal()
      }
    }

    tick()
    const timer = window.setInterval(tick, 250)

    return () => window.clearInterval(timer)
  }, [revealed, conceal])

  useEffect(() => {
    const hideOnVisibility = () => {
      if (document.hidden && revealRef.current) void conceal()
    }

    const hideOnBlur = () => {
      if (revealRef.current) void conceal()
    }

    const blockSensitiveInteraction = (event: Event) => {
      if (revealRef.current) event.preventDefault()
    }

    document.addEventListener('visibilitychange', hideOnVisibility)
    window.addEventListener('blur', hideOnBlur)

    document.addEventListener('copy', blockSensitiveInteraction)
    document.addEventListener('cut', blockSensitiveInteraction)
    document.addEventListener('contextmenu', blockSensitiveInteraction)
    document.addEventListener('dragstart', blockSensitiveInteraction)

    return () => {
      document.removeEventListener('visibilitychange', hideOnVisibility)
      window.removeEventListener('blur', hideOnBlur)

      document.removeEventListener('copy', blockSensitiveInteraction)
      document.removeEventListener('cut', blockSensitiveInteraction)
      document.removeEventListener('contextmenu', blockSensitiveInteraction)
      document.removeEventListener('dragstart', blockSensitiveInteraction)
    }
  }, [conceal])

  useEffect(() => {
    return () => {
      if (revealRef.current?.documentUrl) {
        URL.revokeObjectURL(revealRef.current.documentUrl)
      }
    }
  }, [])

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false
      if (!needle) return true

      return [
        item.label,
        item.kind,
        item.classification,
        item.original_filename || '',
        item.last_four || '',
      ].some((part) => part.toLowerCase().includes(needle))
    })
  }, [items, query, filter])

  const resetCreate = () => {
    setKind('text')
    setLabel('')
    setValue('')
    setClassification('highly_restricted')
    setRevealSeconds(30)
    setFile(null)
  }

  const createSecret = async () => {
    if (!label.trim()) {
      setError('Enter a label for this protected item.')
      return
    }

    if (kind !== 'document' && !value) {
      setError('Enter the sensitive value to encrypt.')
      return
    }

    if (kind === 'document' && !file) {
      setError('Select a document to protect.')
      return
    }

    if (kind === 'document' && file && file.size === 0) {
      setError('That file is empty. Choose a file with content.')
      return
    }

    if (kind === 'document' && file && file.size > MAX_VAULT_FILE_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The vault accepts files up to 15 MB.`)
      return
    }

    setCreating(true)
    setError('')

    try {
      if (kind === 'document' && file) {
        await createDocumentSecret({
          label: label.trim(),
          file,
          classification,
          reveal_max_seconds: revealSeconds,
        })
      } else {
        const lastFour =
          kind === 'number'
            ? value.replace(/\s+/g, '').slice(-4) || undefined
            : undefined

        const textKind: 'text' | 'number' =
          kind === 'number' ? 'number' : 'text'

        await createTextSecret({
          label: label.trim(),
          value,
          kind: textKind,
          classification,
          reveal_max_seconds: revealSeconds,
          last_four: lastFour,
        })
      }

      resetCreate()
      setShowCreate(false)
      await load(true)
    } catch (err) {
      setError(friendlyVaultError(err))
    } finally {
      setCreating(false)
    }
  }

  const beginReveal = (item: VaultItem) => {
    setPurpose('')
    setRequestedSeconds(Math.min(30, item.reveal_max_seconds || 30))
    setRevealItem(item)
    setError('')
  }

  const authorize = async () => {
    if (!revealItem) return

    if (purpose.trim().length < 3) {
      setError('Enter a reason for revealing this protected information.')
      return
    }

    setAuthorizing(true)
    setError('')

    try {
      const auth = await authorizeReveal(
        revealItem.id,
        requestedSeconds,
        purpose.trim(),
      )

      const result = await readReveal(revealItem.id, auth.token)
      const bytes = decodeBase64(result.value_base64)

      let next: RevealedState

      if (revealItem.kind === 'document') {
        const preview = vaultPreview(bytes, result.mime_type)

        if (preview.kind === 'text') {
          next = {
            item: revealItem,
            token: auth.token,
            expiresAt: result.expires_at,
            value: new TextDecoder().decode(bytes),
          }
        } else if (preview.kind === 'none') {
          next = {
            item: revealItem,
            token: auth.token,
            expiresAt: result.expires_at,
            preview: 'none',
          }
        } else {
          // The type comes from vaultPreview (allowlist + file signature),
          // never from the stored mime type. See the note there.
          next = {
            item: revealItem,
            token: auth.token,
            expiresAt: result.expires_at,
            preview: preview.kind,
            documentUrl: URL.createObjectURL(
              new Blob([bytes], { type: preview.type }),
            ),
          }
        }
      } else {
        next = {
          item: revealItem,
          token: auth.token,
          expiresAt: result.expires_at,
          value: new TextDecoder().decode(bytes),
        }
      }

      setRevealItem(null)
      setRevealed(next)
    } catch (err) {
      setError(friendlyVaultError(err))
    } finally {
      setAuthorizing(false)
    }
  }

  const deleteItem = async (item: VaultItem) => {
    const confirmed = window.confirm(
      `Delete "${item.label}" from the Secret Vault? This action is audited.`,
    )

    if (!confirmed) return

    setError('')

    try {
      await deleteVaultItem(item.id)
      await load(true)
    } catch (err) {
      setError(friendlyVaultError(err))
    }
  }

  return (
    <section className="secretVault">
      <header className="secretVaultHero">
        <div className="secretVaultHeroGlow" />

        <div className="secretVaultHeroMain">
          <div className="secretVaultIdentity">
            <div className="secretVaultMark" aria-hidden="true">
              <LockKeyhole size={25} />
            </div>

            <div>
              <div className="secretVaultEyebrow">
                <span className="secretVaultStatus secretVaultStatusSecure">
                  <ShieldCheck size={14} />
                  AES-256 encrypted
                </span>

                <span className="secretVaultStatus secretVaultStatusRestricted">
                  <Fingerprint size={14} />
                  Highly restricted
                </span>
              </div>

              <h2>Secret Vault</h2>
              <p>
                Protected company and personal records with audited, time-limited
                reveal access.
              </p>
            </div>
          </div>

          <button
            className="secretVaultPrimary"
            type="button"
            onClick={() => {
              setError('')
              setShowCreate(true)
            }}
          >
            <Plus size={17} />
            Add protected item
          </button>
        </div>

        <div className="secretVaultMetrics">
          <div>
            <strong>{items.length}</strong>
            <span>Protected items</span>
          </div>

          <div>
            <strong>{revealed ? 1 : 0}</strong>
            <span>Currently revealed</span>
          </div>

          <div>
            <strong>{items[0] ? formatDate(items[0].updated_at) : '-'}</strong>
            <span>Latest vault activity</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="secretVaultError" role="alert">
          <AlertTriangle size={20} />

          <div>
            <strong>Unable to complete vault request</strong>
            <span>{error}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setError('')
              void load(true)
            }}
          >
            Retry
          </button>
        </div>
      )}

      <SecretVaultSharing items={items} onChanged={() => void load(true)} />

      <div className="secretVaultWorkspace">
        <main className="secretVaultMain">
          <div className="secretVaultToolbar">
            <label className="secretVaultSearch">
              <Search size={17} />
              <input
                aria-label="Search Secret Vault"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search protected items"
              />
            </label>

            <div className="secretVaultFilters" aria-label="Vault item filters">
              {(['all', 'text', 'number', 'document'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={filter === entry ? 'isActive' : ''}
                  onClick={() => setFilter(entry)}
                >
                  {entry === 'all'
                    ? 'All'
                    : entry.charAt(0).toUpperCase() + entry.slice(1)}
                </button>
              ))}
            </div>

            <button
              className="secretVaultRefresh"
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              aria-label="Refresh Secret Vault"
            >
              <RefreshCw
                size={17}
                className={refreshing ? 'isSpinning' : ''}
              />
            </button>
          </div>

          {loading ? (
            <div className="secretVaultSkeletonList" aria-label="Loading vault">
              {[1, 2, 3].map((row) => (
                <div className="secretVaultSkeleton" key={row}>
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="secretVaultEmpty">
              <div className="secretVaultEmptyIcon">
                <FileLock2 size={28} />
              </div>

              <h3>{items.length ? 'No matching records' : 'Your vault is empty'}</h3>

              <p>
                {items.length
                  ? 'Try another search or filter.'
                  : 'Add an encrypted number, secret text, or protected document.'}
              </p>

              {!items.length && (
                <button
                  type="button"
                  className="secretVaultPrimary"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus size={17} />
                  Add first protected item
                </button>
              )}
            </div>
          ) : (
            <div className="secretVaultItemList">
              {filteredItems.map((item) => (
                <article className="secretVaultItem" key={item.id}>
                  <div
                    className={`secretVaultItemIcon secretVaultItemIcon-${item.kind}`}
                  >
                    {item.kind === 'document' ? (
                      <FileText size={20} />
                    ) : item.kind === 'number' ? (
                      <Fingerprint size={20} />
                    ) : (
                      <KeyRound size={20} />
                    )}
                  </div>

                  <div className="secretVaultItemBody">
                    <div className="secretVaultItemHeading">
                      <div>
                        <h3>{item.label}</h3>
                        <span className="secretVaultItemKind">
                          {item.kind}
                        </span>
                      </div>

                      <span
                        className={`secretVaultClassification secretVaultClassification-${item.classification}`}
                      >
                        {item.classification.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="secretVaultMasked">
                      <EyeOff size={15} />
                      <span>{maskValue(item)}</span>
                    </div>

                    <div className="secretVaultItemMeta">
                      {item.byte_size ? (
                        <span>{formatBytes(item.byte_size)}</span>
                      ) : null}

                      <span>
                        Reveal up to {item.reveal_max_seconds || 30}s
                      </span>

                      <span>Updated {formatDate(item.updated_at)}</span>
                    </div>
                  </div>

                  <div className="secretVaultItemActions">
                    <button
                      className="secretVaultRevealButton"
                      type="button"
                      onClick={() => beginReveal(item)}
                    >
                      <Eye size={16} />
                      Reveal
                    </button>

                    {!viewer || viewer.isAdmin || item.owner_id === viewer.id ? (
                      <button
                        className="secretVaultDeleteButton"
                        type="button"
                        onClick={() => void deleteItem(item)}
                        aria-label={`Delete ${item.label}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <span className="secretVaultSharedTag">Shared with you</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>

        <aside className="secretVaultSecurityRail">
          <div className="secretVaultSecurityCard">
            <div className="secretVaultSecurityCardIcon">
              <ShieldCheck size={22} />
            </div>

            <div>
              <strong>Protected by design</strong>
              <p>
                Plaintext is never included in normal Vault listings and reveal
                access automatically expires.
              </p>
            </div>
          </div>

          <div className="secretVaultSecurityCard">
            <div className="secretVaultSecurityCardIcon">
              <Clock3 size={22} />
            </div>

            <div>
              <strong>Timed access</strong>
              <p>
                Every reveal requires a purpose and is restricted to a short,
                audited viewing window.
              </p>
            </div>
          </div>

          <div className="secretVaultSecurityCard">
            <div className="secretVaultSecurityCardIcon">
              <EyeOff size={22} />
            </div>

            <div>
              <strong>Auto concealment</strong>
              <p>
                Revealed information is hidden when its timer expires or the
                application loses focus.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {showCreate && (
        <div
          className="secretVaultModalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !creating) {
              setShowCreate(false)
            }
          }}
        >
          <div
            className="secretVaultModal secretVaultCreateModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-create-title"
          >
            <div className="secretVaultModalHeader">
              <div>
                <span className="secretVaultModalEyebrow">
                  <LockKeyhole size={14} />
                  Encrypt new record
                </span>
                <h3 id="vault-create-title">Add protected item</h3>
                <p>
                  Sensitive content is encrypted before being stored in the
                  private Vault payload store.
                </p>
              </div>

              <button
                className="secretVaultIconButton"
                type="button"
                aria-label="Close"
                disabled={creating}
                onClick={() => setShowCreate(false)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="secretVaultTypePicker">
              {(['text', 'number', 'document'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={kind === entry ? 'isActive' : ''}
                  onClick={() => setKind(entry)}
                >
                  {entry === 'text' && <KeyRound size={17} />}
                  {entry === 'number' && <Fingerprint size={17} />}
                  {entry === 'document' && <FileText size={17} />}
                  {entry === 'text'
                    ? 'Secret text'
                    : entry === 'number'
                      ? 'Number / ID'
                      : 'Document'}
                </button>
              ))}
            </div>

            <div className="secretVaultFormGrid">
              <label className="secretVaultField secretVaultFieldWide">
                <span>Label</span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={
                    kind === 'number'
                      ? 'e.g. National Identification Number'
                      : kind === 'document'
                        ? 'e.g. Passport copy'
                        : 'e.g. Recovery code'
                  }
                />
              </label>

              {kind === 'document' ? (
                <label className="secretVaultUpload secretVaultFieldWide">
                  <UploadCloud size={27} />
                  <strong>{file ? file.name : 'Choose protected document'}</strong>
                  <span>
                    {file
                      ? formatBytes(file.size)
                      : 'Select a file to encrypt and store securely'}
                  </span>
                  <input
                    type="file"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] || null)
                    }
                  />
                </label>
              ) : (
                <label className="secretVaultField secretVaultFieldWide">
                  <span>Sensitive value</span>
                  <textarea
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    rows={4}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      kind === 'number'
                        ? 'Enter sensitive number'
                        : 'Enter protected text'
                    }
                  />
                </label>
              )}

              <label className="secretVaultField">
                <span>Classification</span>
                <select
                  value={classification}
                  onChange={(event) =>
                    setClassification(event.target.value as Classification)
                  }
                >
                  <option value="highly_restricted">Highly restricted</option>
                  <option value="restricted">Restricted</option>
                </select>
              </label>

              <label className="secretVaultField">
                <span>Maximum reveal window</span>
                <select
                  value={revealSeconds}
                  onChange={(event) =>
                    setRevealSeconds(Number(event.target.value))
                  }
                >
                  <option value={10}>10 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={300}>5 minutes</option>
                </select>
              </label>
            </div>

            <div className="secretVaultModalFooter">
              <button
                className="secretVaultSecondary"
                type="button"
                disabled={creating}
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>

              <button
                className="secretVaultPrimary"
                type="button"
                disabled={creating}
                onClick={() => void createSecret()}
              >
                <LockKeyhole size={17} />
                {creating ? 'Encrypting…' : 'Encrypt & store'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealItem && (
        <div className="secretVaultModalBackdrop">
          <div
            className="secretVaultModal secretVaultRevealRequest"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-reveal-title"
          >
            <div className="secretVaultModalHeader">
              <div>
                <span className="secretVaultModalEyebrow">
                  <Eye size={14} />
                  Audited reveal
                </span>
                <h3 id="vault-reveal-title">{revealItem.label}</h3>
                <p>
                  State why you need access. The reveal will be automatically
                  concealed when the timer expires.
                </p>
              </div>

              <button
                className="secretVaultIconButton"
                type="button"
                disabled={authorizing}
                onClick={() => setRevealItem(null)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <label className="secretVaultField">
              <span>Purpose for reveal</span>
              <textarea
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                rows={3}
                placeholder="e.g. Verify identity for compliance review"
              />
            </label>

            <div className="secretVaultDurationPicker">
              {[10, 30, 60].map((seconds) => {
                if (seconds > revealItem.reveal_max_seconds) return null

                return (
                  <button
                    key={seconds}
                    type="button"
                    className={requestedSeconds === seconds ? 'isActive' : ''}
                    onClick={() => setRequestedSeconds(seconds)}
                  >
                    {seconds}s
                  </button>
                )
              })}
            </div>

            <div className="secretVaultRevealWarning">
              <ShieldCheck size={18} />
              <span>This reveal will be permanently recorded in the Vault audit trail.</span>
            </div>

            <div className="secretVaultModalFooter">
              <button
                className="secretVaultSecondary"
                type="button"
                disabled={authorizing}
                onClick={() => setRevealItem(null)}
              >
                Cancel
              </button>

              <button
                className="secretVaultPrimary"
                type="button"
                disabled={authorizing}
                onClick={() => void authorize()}
              >
                <Eye size={17} />
                {authorizing ? 'Authorizing…' : 'Authorize reveal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealed && (
        <div
          className="secretVaultRevealStage"
          onContextMenu={(event) => event.preventDefault()}
          onCopy={(event) => event.preventDefault()}
          onCut={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="secretVaultWatermark" aria-hidden="true">
            AUTHORIZED VIEW • AUDITED • AUTHORIZED VIEW • AUDITED • AUTHORIZED VIEW
          </div>

          <div className="secretVaultRevealSurface">
            <div className="secretVaultRevealTop">
              <div>
                <span className="secretVaultLiveIndicator">
                  <span />
                  Viewing recorded
                </span>
                <h3>{revealed.item.label}</h3>
              </div>

              <div className="secretVaultCountdown">
                <strong>{secondsLeft}</strong>
                <span>sec</span>
              </div>
            </div>

            <div className="secretVaultRevealContent">
              {revealed.preview === 'image' && revealed.documentUrl ? (
                <img
                  src={revealed.documentUrl}
                  alt={revealed.item.label}
                  className="secretVaultDocumentPreview"
                  referrerPolicy="no-referrer"
                />
              ) : revealed.preview === 'pdf' && revealed.documentUrl ? (
                <iframe
                  src={revealed.documentUrl}
                  title={revealed.item.label}
                  className="secretVaultDocumentPreview"
                  referrerPolicy="no-referrer"
                />
              ) : revealed.preview === 'none' ? (
                <div className="secretVaultPlaintext" aria-live="polite">
                  This file type cannot be previewed safely. Only PDF, images
                  and plain text open in the Vault.
                </div>
              ) : (
                <div className="secretVaultPlaintext" aria-live="polite">
                  {revealed.value}
                </div>
              )}
            </div>

            <div className="secretVaultRevealFooter">
              <div>
                <ShieldCheck size={17} />
                Auto-conceals on timer expiry or focus loss
              </div>

              <button
                className="secretVaultHideButton"
                type="button"
                onClick={() => void conceal()}
              >
                <EyeOff size={17} />
                Hide now
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
