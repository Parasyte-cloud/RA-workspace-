import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  FolderOpen,
  Search,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

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
  folder_path?: string
  department?: string
  file_type?: string
  size_bytes?: number
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

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!supabase) return

    const { data } = await supabase
      .from('workspace_files')
      .select('*')
      .order('created_at', { ascending: false })

    setItems((data || []) as WorkspaceFile[])
    setLoading(false)
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
        subtitle="The central file directory for RideArrivo documents, department records and shared resources."
      />

      <div className="glassCard companyFilesNotice">
        <FolderOpen size={20} />
        <div>
          <strong>RideArrivo Company Repository</strong>
          <p>
            Microsoft SharePoint / OneDrive integration will become the official
            underlying company file store. This page is the workspace interface.
          </p>
        </div>
      </div>

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

            {file.description && <p>{file.description}</p>}

            <div className="phase2Meta">
              {file.folder_path && <span>{file.folder_path}</span>}
              {file.file_type && <span>{file.file_type}</span>}

              {file.provider_url && (
                <a
                  href={file.provider_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open file <ExternalLink size={13} />
                </a>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <EmptyState text="No company files have been registered yet." />
      )}
    </section>
  )
}
