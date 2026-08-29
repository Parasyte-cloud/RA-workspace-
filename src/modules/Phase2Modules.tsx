import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  FileUp,
  FolderOpen,
  ExternalLink,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import ControlledDownloadButton from '../components/ControlledDownloadButton'
import { createInternalImagePreview, isPreviewableImage } from '../lib/workspacePreviews'

type Announcement = {
  id: string
  title: string
  body: string
  category: string
  priority: string
  published_at: string
  audience_roles?: string[]
  audience_departments?: string[]
}

type Task = {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  due_at?: string
  department?: string
}

type WorkspaceEvent = {
  id: string
  title: string
  description?: string
  event_type?: string
  location?: string
  meeting_url?: string
  starts_at: string
  ends_at?: string
  all_day?: boolean
}

type KnowledgeArticle = {
  id: string
  title: string
  slug: string
  summary?: string
  content: string
  category: string
  tags?: string[]
}

type WorkspaceFile = {
  id: string
  name: string
  description?: string
  provider: string
  provider_url?: string
  storage_path?: string
  folder_path?: string
  department?: string
  file_type?: string
  size_bytes?: number
  preview_path?: string|null
  preview_url?: string|null
}

function workspaceFileLooksImage(file: WorkspaceFile) {
  const type=String(file.file_type || '').toLowerCase()
  return type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)
}

function ModuleHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string
  title: string
  subtitle: string
}) {
  return (
    <div className="phase2Header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="glassCard phase2Empty">{text}</div>
}

export function AnnouncementsModule() {
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('workspace_announcements')
      .select('*')
      .eq('published', true)
      .order('published_at', { ascending: false })

    if (error) setError(error.message)
    else setItems((data || []) as Announcement[])

    setLoading(false)
  }

  return (
    <section className="phase2Module">
      <ModuleHeader
        eyebrow="COMPANY"
        title="Announcements"
        subtitle="Company notices, operational updates and important internal communications."
      />

      {loading && <EmptyState text="Loading announcements..." />}
      {error && <EmptyState text={error} />}

      <div className="phase2Stack">
        {items.map((item) => (
          <article className="glassCard phase2Record" key={item.id}>
            <div className="phase2RecordTop">
              <div className="phase2Icon">
                <Bell size={18} />
              </div>

              <div>
                <span className="eyebrow">{item.category}</span>
                <h3>{item.title}</h3>
              </div>

              <span className={`statusPill ${item.priority}`}>
                {item.priority}
              </span>
            </div>

            <p>{item.body}</p>

            <small>
              {new Date(item.published_at).toLocaleString()}
            </small>
          </article>
        ))}
      </div>

      {!loading && !error && items.length === 0 && (
        <EmptyState text="No announcements yet." />
      )}
    </section>
  )
}

export function TasksModule() {
  const [items, setItems] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!supabase) return

    const { data } = await supabase
      .from('workspace_tasks')
      .select('*')
      .order('due_at', { ascending: true, nullsFirst: false })

    setItems((data || []) as Task[])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((item) => item.status === filter)
  }, [items, filter])

  return (
    <section className="phase2Module">
      <ModuleHeader
        eyebrow="MY WORK"
        title="Tasks"
        subtitle="Your assignments, priorities, deadlines and progress."
      />

      <div className="phase2Filters">
        {[
          ['all', 'All'],
          ['todo', 'To Do'],
          ['in_progress', 'In Progress'],
          ['review', 'Review'],
          ['completed', 'Completed'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? 'appCategory active' : 'appCategory'}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <EmptyState text="Loading tasks..." />}

      <div className="phase2Stack">
        {filtered.map((task) => (
          <article className="glassCard phase2Record" key={task.id}>
            <div className="phase2RecordTop">
              <div className="phase2Icon">
                {task.status === 'completed' ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <Clock3 size={18} />
                )}
              </div>

              <div>
                <span className="eyebrow">
                  {task.department || 'Workspace'}
                </span>
                <h3>{task.title}</h3>
              </div>

              <span className={`statusPill ${task.priority}`}>
                {task.priority}
              </span>
            </div>

            {task.description && <p>{task.description}</p>}

            <div className="phase2Meta">
              <span>{task.status.replace(/_/g, ' ')}</span>
              {task.due_at && (
                <span>
                  Due {new Date(task.due_at).toLocaleString()}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <EmptyState text="No tasks in this view." />
      )}
    </section>
  )
}

export function CalendarModule() {
  const [items, setItems] = useState<WorkspaceEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!supabase) return

    const { data } = await supabase
      .from('workspace_events')
      .select('*')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(100)

    setItems((data || []) as WorkspaceEvent[])
    setLoading(false)
  }

  return (
    <section className="phase2Module">
      <ModuleHeader
        eyebrow="MY WORK"
        title="Calendar"
        subtitle="Company events, meetings, deadlines and operational schedules."
      />

      {loading && <EmptyState text="Loading calendar..." />}

      <div className="phase2Stack">
        {items.map((event) => (
          <article className="glassCard phase2Record" key={event.id}>
            <div className="phase2RecordTop">
              <div className="phase2Icon">
                <CalendarDays size={18} />
              </div>

              <div>
                <span className="eyebrow">
                  {event.event_type || 'EVENT'}
                </span>
                <h3>{event.title}</h3>
              </div>
            </div>

            {event.description && <p>{event.description}</p>}

            <div className="phase2Meta">
              <span>
                {new Date(event.starts_at).toLocaleString()}
              </span>

              {event.location && <span>{event.location}</span>}

              {event.meeting_url && (
                <a
                  href={event.meeting_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Join meeting <ExternalLink size={13} />
                </a>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && items.length === 0 && (
        <EmptyState text="No upcoming events." />
      )}
    </section>
  )
}

export function KnowledgeBaseModule() {
  const [items, setItems] = useState<KnowledgeArticle[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!supabase) return

    const { data } = await supabase
      .from('workspace_knowledge_articles')
      .select('*')
      .eq('status', 'published')
      .order('category')
      .order('title')

    setItems((data || []) as KnowledgeArticle[])
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    if (!q) return items

    return items.filter((item) =>
      [
        item.title,
        item.summary,
        item.category,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [items, query])

  if (selected) {
    return (
      <section className="phase2Module">
        <button
          className="glassButton"
          onClick={() => setSelected(null)}
        >
          Back to Knowledge Base
        </button>

        <article className="glassCard knowledgeArticle">
          <span className="eyebrow">{selected.category}</span>
          <h2>{selected.title}</h2>
          {selected.summary && <p>{selected.summary}</p>}
          <div className="knowledgeContent">{selected.content}</div>
        </article>
      </section>
    )
  }

  return (
    <section className="phase2Module">
      <ModuleHeader
        eyebrow="COMPANY"
        title="Knowledge Base"
        subtitle="Policies, SOPs, training, guides and company operating knowledge."
      />

      <label className="phase2Search glassCard">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the knowledge base..."
        />
      </label>

      <div className="phase2Grid">
        {filtered.map((article) => (
          <button
            className="glassCard knowledgeCard"
            key={article.id}
            onClick={() => setSelected(article)}
          >
            <BookOpen size={20} />
            <span className="eyebrow">{article.category}</span>
            <strong>{article.title}</strong>
            <p>{article.summary || 'Open article'}</p>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <EmptyState text="No knowledge articles found." />
      )}
    </section>
  )
}

export function CompanyFilesModule() {
  const [items, setItems] = useState<WorkspaceFile[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('employee')
  const [showUpload, setShowUpload] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File|null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [department, setDepartment] = useState('Company-wide')
  const [folderPath, setFolderPath] = useState('')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement|null>(null)
  const previewBackfillStarted = useRef(false)

  const canUpload = role === 'legal' || role === 'admin'

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    if (!supabase) return
    const client = supabase

    setLoading(true)
    setNotice('')

    const { data: authData } = await client.auth.getUser()
    const userId = authData.user?.id

    const [catalogResult, profileResult] = await Promise.all([
      client.rpc('list_workspace_files'),
      userId
        ? client
            .from('employee_profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (catalogResult.error) {
      setNotice(catalogResult.error.message)
      setItems([])
    } else {
      const rows = (catalogResult.data || []) as WorkspaceFile[]
      const resolved = await Promise.all(
        rows.map(async (file) => {
          if (!file.preview_path) return file
          const { data, error } = await client.storage
            .from('workspace-previews')
            .createSignedUrl(file.preview_path, 15 * 60)
          return {
            ...file,
            preview_url: error ? null : data?.signedUrl || null,
          }
        })
      )
      setItems(resolved)
    }

    setRole(String(profileResult.data?.role || 'employee').toLowerCase())
    setLoading(false)
  }

  async function backfillMissingCompanyPreviews() {
    if (!supabase || role !== 'admin' || previewBackfillStarted.current) return

    const missing = items.filter(file =>
      !file.preview_path &&
      workspaceFileLooksImage(file)
    )

    if (!missing.length) return

    previewBackfillStarted.current = true

    try {
      for (const file of missing) {
        const { data: location, error: locationError } = await supabase.rpc(
          'get_workspace_file_download_location',
          { p_file_id: file.id }
        )
        if (locationError) throw locationError

        const payload = location as {
          provider?: string
          storage_path?: string|null
        } | null

        if (payload?.provider !== 'supabase' || !payload.storage_path) continue

        const { data: blob, error: downloadError } = await supabase.storage
          .from('company-files')
          .download(payload.storage_path)
        if (downloadError) throw downloadError

        const source = new File(
          [blob],
          file.name,
          { type: blob.type || (String(file.file_type || '').startsWith('image/') ? file.file_type : 'image/png') }
        )
        const preview = await createInternalImagePreview(source)
        if (!preview) continue

        const previewPath = `company/${file.id}/preview.webp`
        const { error: previewError } = await supabase.storage
          .from('workspace-previews')
          .upload(previewPath, preview, {
            upsert: true,
            contentType: 'image/webp',
            cacheControl: '900',
          })
        if (previewError) throw previewError

        const { error: updateError } = await supabase
          .from('workspace_files')
          .update({ preview_path: previewPath })
          .eq('id', file.id)
        if (updateError) throw updateError
      }

      await load()
    } catch (error) {
      console.error('Company preview backfill', error)
    }
  }

  useEffect(() => {
    if (
      role === 'admin' &&
      !loading &&
      items.some(file =>
        !file.preview_path &&
        workspaceFileLooksImage(file)
      )
    ) {
      void backfillMissingCompanyPreviews()
    }
  }, [items, loading, role])

  async function uploadCompanyFile(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !selectedFile || !canUpload) return

    setUploading(true)
    setNotice('')

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!authData.user) throw new Error('Your session has expired.')

      const fileId = crypto.randomUUID()
      const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
      const storagePath = `${fileId}/${safeName}`
      const previewBlob = isPreviewableImage(selectedFile)
        ? await createInternalImagePreview(selectedFile)
        : null
      const previewPath = previewBlob
        ? `company/${fileId}/preview.webp`
        : null

      const { error: uploadError } = await supabase.storage
        .from('company-files')
        .upload(storagePath, selectedFile, {
          upsert: false,
          contentType: selectedFile.type || undefined,
          cacheControl: '3600',
        })

      if (uploadError) throw uploadError

      if (previewBlob && previewPath) {
        const { error: previewError } = await supabase.storage
          .from('workspace-previews')
          .upload(previewPath, previewBlob, {
            upsert: false,
            contentType: 'image/webp',
            cacheControl: '900',
          })
        if (previewError) {
          await supabase.storage.from('company-files').remove([storagePath])
          throw previewError
        }
      }

      const { error: rowError } = await supabase
        .from('workspace_files')
        .insert({
          id: fileId,
          name: title.trim() || selectedFile.name,
          description: description.trim() || null,
          provider: 'supabase',
          provider_url: null,
          storage_path: storagePath,
          folder_path: folderPath.trim() || null,
          department,
          file_type: selectedFile.type || selectedFile.name.split('.').pop() || 'file',
          size_bytes: selectedFile.size,
          preview_path: previewPath,
          uploaded_by: authData.user.id,
          is_active: true,
        })

      if (rowError) {
        await supabase.storage.from('company-files').remove([storagePath])
        if (previewPath) await supabase.storage.from('workspace-previews').remove([previewPath])
        throw rowError
      }

      setSelectedFile(null)
      setTitle('')
      setDescription('')
      setFolderPath('')
      setDepartment('Company-wide')
      setShowUpload(false)
      setNotice('File uploaded. Employees can see the record, but downloading still requires administrator approval.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to upload company file.')
    } finally {
      setUploading(false)
    }
  }

  async function openApprovedFile(file: WorkspaceFile) {
    if (!supabase) return

    const { data: location, error: locationError } = await supabase.rpc(
      'get_workspace_file_download_location',
      { p_file_id: file.id }
    )

    if (locationError) throw locationError

    const payload = location as {
      provider?: string
      provider_url?: string|null
      storage_path?: string|null
    } | null

    if (payload?.provider === 'supabase' && payload.storage_path) {
      const { data, error } = await supabase.storage
        .from('company-files')
        .createSignedUrl(payload.storage_path, 60, { download: file.name })

      if (error) throw error
      if (!data?.signedUrl) throw new Error('Unable to create the approved download link.')

      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
      return
    }

    if (payload?.provider_url) {
      window.open(payload.provider_url, '_blank', 'noopener,noreferrer')
      return
    }

    throw new Error('This file has no available storage location.')
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    if (!q) return items

    return items.filter((file) =>
      [
        file.name,
        file.description,
        file.department,
        file.folder_path,
        file.file_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [items, query])

  return (
    <section className="phase2Module">
      <ModuleHeader
        eyebrow="COMPANY"
        title="Company Files"
        subtitle="The controlled RideArrivo repository for policies, contracts, department records and shared company documents."
      />

      <div className="glassCard companyFilesNotice">
        <FolderOpen size={20} />
        <div>
          <strong>Controlled company repository</strong>
          <p>
            Legal and Admin can upload files for now. Employees can discover authorised records here, but every protected download must be approved by an administrator before the file can leave the workspace.
          </p>
        </div>
        {canUpload && (
          <button
            type="button"
            className="primaryButton"
            onClick={() => setShowUpload(true)}
          >
            <FileUp size={16} /> Upload file
          </button>
        )}
      </div>

      {!canUpload && (
        <div className="glassCard companyFilePermissionNote">
          <ShieldCheck size={18} />
          <span>Upload permission is currently restricted to Legal and Admin.</span>
        </div>
      )}

      {notice && <div className="moduleNotice">{notice}</div>}

      <label className="phase2Search glassCard">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search company files..."
        />
      </label>

      {loading && <EmptyState text="Loading company files..." />}

      <div className="phase2Stack">
        {filtered.map((file) => (
          <article className="glassCard phase2Record" key={file.id}>
            <div className="phase2RecordTop">
              <div className="phase2Icon">
                <FileText size={18} />
              </div>

              <div>
                <span className="eyebrow">
                  {file.department || file.provider}
                </span>
                <h3>{file.name}</h3>
              </div>
            </div>

            {workspaceFileLooksImage(file) ? (
              <div
                className="companyFilePreview"
                onContextMenu={(event) => event.preventDefault()}
                title="Internal preview. Original download requires approval."
              >
                {file.preview_url ? (
                  <img
                    src={file.preview_url}
                    alt={`${file.name} preview`}
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="companyFilePreviewPending">
                    <FileText size={30}/>
                    <strong>Preview preparing</strong>
                    <small>The protected original is not exposed.</small>
                  </div>
                )}
                <span>Internal preview</span>
              </div>
            ) : (
              <div className="companyFileDocumentCard">
                <FileText size={28}/>
                <div>
                  <strong>{file.file_type || 'Document'}</strong>
                  <small>{file.name}</small>
                </div>
              </div>
            )}

            {file.description && <p>{file.description}</p>}

            <div className="phase2Meta">
              {file.folder_path && <span>{file.folder_path}</span>}
              {file.file_type && <span>{file.file_type}</span>}
              {typeof file.size_bytes === 'number' && (
                <span>{Math.max(1, Math.round(file.size_bytes / 1024))} KB</span>
              )}

              <ControlledDownloadButton
                compact
                resource={{
                  resourceType:'company_file',
                  resourceKey:file.id,
                  resourceName:file.name
                }}
                label="Download approved file"
                onGranted={() => openApprovedFile(file)}
              />
            </div>
          </article>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <EmptyState text="No company files have been registered yet." />
      )}

      {showUpload && canUpload && (
        <div className="downloadAccessOverlay" role="dialog" aria-modal="true">
          <form className="downloadAccessModal glassCard companyFileUploadModal" onSubmit={(event) => void uploadCompanyFile(event)}>
            <div className="downloadAccessModalHead">
              <FileUp size={22} />
              <div>
                <h3>Upload company file</h3>
                <p>Only Legal and Admin can add records. Download access remains separately controlled by Admin approval.</p>
              </div>
            </div>

            <input
              ref={inputRef}
              hidden
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                setSelectedFile(file)
                if (file && !title) setTitle(file.name)
              }}
            />

            <button
              type="button"
              className="glassButton companyFilePicker"
              onClick={() => inputRef.current?.click()}
            >
              <FileUp size={16} />
              {selectedFile ? selectedFile.name : 'Choose file'}
            </button>

            <label>
              File title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Driver Partner Agreement Template" required />
            </label>

            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this document for?" />
            </label>

            <label>
              Department / audience
              <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                {['Company-wide','Administration','Legal','Finance','Operations','Support','People & HR','Marketing','Partnerships','Engineering'].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label>
              Folder
              <input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="e.g. Legal / Contracts / Templates" />
            </label>

            <div className="downloadAccessModalActions">
              <button type="button" className="glassButton" onClick={() => setShowUpload(false)} disabled={uploading}>
                <X size={15} /> Cancel
              </button>
              <button type="submit" className="primaryButton" disabled={uploading || !selectedFile}>
                <FileUp size={15} /> {uploading ? 'Uploading...' : 'Upload securely'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

