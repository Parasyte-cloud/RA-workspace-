import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive, BookOpen, Check, Eye, EyeOff, Loader2, Pencil, Plus, RefreshCw, Save, Sparkles, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { callFunction, rpc } from '../room7-ai/api'
import { ArticleBody } from '../lib/miniMarkdown'
import '../knowledge-ai.css'

type Article = {
  id: string; title: string; slug: string; summary: string | null; content: string
  category: string; tags: string[]; status: 'draft' | 'published' | 'archived'
  source: 'manual' | 'seed' | 'ai'; updated_at: string
}
type Proposal = {
  id: string; run_id: string | null; kind: 'create' | 'update'; article_id: string | null
  slug: string; title: string; summary: string | null; content: string; category: string
  tags: string[]; rationale: string | null; source_links: { url: string; title: string }[]
  status: 'pending' | 'approved' | 'rejected'; created_at: string
}
type Run = {
  id: string; topic: string; status: 'running' | 'done' | 'failed'; summary: string | null
  error: string | null; searches_used: number; proposals_count: number; created_at: string
}
type Status = { configured: boolean; enabled: boolean; model: string }

const CATEGORIES = ['Company', 'Products', 'Policies', 'Workspace', 'Operations', 'Engineering', 'Industry', 'General']

const PRESETS: [string, string][] = [
  ['Full review', ''],
  ['Company and products', 'Check every Company and Products article for gaps or anything that looks out of date. Search for any public information about RideArrivo, its services and its brand, and propose corrections only where you find reliable evidence.'],
  ['Lagos transport and airports', 'Research what staff need to know about airport pickups at Murtala Muhammed International Airport (LOS), Lagos ride-hailing and chauffeur regulation, and private aviation and marine charter basics in Nigeria. Put it in the Industry category with sources.'],
  ['Recording and data protection', 'Research the Nigeria Data Protection Act 2023 as it applies to recording and transcribing meetings, retention of audio, and cross-border transfer. Summarise for staff in plain language with sources, and say it is not legal advice.'],
]

const STALE_MS = 10 * 60 * 1000

function when(v: string) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

type Draft = { id: string | null; title: string; slug: string; summary: string; content: string; category: string; tags: string; status: Article['status'] }
const blankDraft: Draft = { id: null, title: '', slug: '', summary: '', content: '', category: 'General', tags: '', status: 'published' }

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export default function AdminKnowledgeAi() {
  const [status, setStatus] = useState<Status | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [focus, setFocus] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deciding, setDeciding] = useState('')

  const byId = useMemo(() => new Map(articles.map(a => [a.id, a])), [articles])

  const load = useCallback(async () => {
    if (!supabase) return
    const [a, p, r, s] = await Promise.all([
      supabase.from('workspace_knowledge_articles')
        .select('id,title,slug,summary,content,category,tags,status,source,updated_at').order('category').order('title'),
      supabase.from('knowledge_ai_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('knowledge_ai_runs').select('*').order('created_at', { ascending: false }).limit(8),
      supabase.from('knowledge_ai_settings').select('enabled,focus').eq('id', true).maybeSingle(),
    ])
    setArticles((a.data || []) as Article[])
    setProposals((p.data || []) as Proposal[])
    setRuns((r.data || []) as Run[])
    if (s.data) setFocus(s.data.focus || '')
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await callFunction<Status>('knowledge-ai', { action: 'status' }))
    } catch (e) {
      setStatus(null)
      setNote(e instanceof Error ? e.message : 'Could not reach the Knowledge Manager.')
    }
  }, [])

  useEffect(() => { void load(); void loadStatus() }, [load, loadStatus])

  async function research() {
    setBusy(true); setNote('Researching. This usually takes one to two minutes. You can leave this page open.')
    try {
      const r = await callFunction<{ proposals: number; searches: number; summary: string }>('knowledge-ai', { action: 'run', topic })
      setNote(`Done. ${r.proposals} proposal${r.proposals === 1 ? '' : 's'} to review after ${r.searches} web search${r.searches === 1 ? '' : 'es'}. ${r.summary}`)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The research run failed.')
      await load()
    } finally { setBusy(false) }
  }

  async function saveSettings(patch: { enabled?: boolean; focus?: string }) {
    if (!supabase) return
    const { error } = await supabase.from('knowledge_ai_settings')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true)
    setNote(error ? error.message : 'Saved.')
    if (!error) void loadStatus()
  }

  async function decide(p: Proposal, approve: boolean) {
    setDeciding(p.id)
    try {
      await rpc('decide_knowledge_ai_proposal', { p_id: p.id, p_approve: approve })
      setNote(approve ? `Published "${p.title}".` : `Rejected "${p.title}".`)
      await load()
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not save the decision.') }
    finally { setDeciding('') }
  }

  async function setArticleStatus(a: Article, next: Article['status']) {
    if (!supabase) return
    const { error } = await supabase.from('workspace_knowledge_articles').update({ status: next }).eq('id', a.id)
    setNote(error ? error.message : `"${a.title}" is now ${next}.`)
    await load()
  }

  async function saveDraft() {
    if (!supabase || !draft) return
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (title.length < 3 || content.length < 10) { setNote('A title and some content are required.'); return }
    const row = {
      title, summary: draft.summary.trim() || null, content, category: draft.category,
      tags: draft.tags.split(',').map(t => slugify(t)).filter(Boolean).slice(0, 8), status: draft.status,
    }
    const { error } = draft.id
      ? await supabase.from('workspace_knowledge_articles').update({ ...row, last_reviewed_at: new Date().toISOString() }).eq('id', draft.id)
      : await supabase.from('workspace_knowledge_articles').insert({ ...row, slug: slugify(draft.slug || title) || `article-${Date.now()}`, source: 'manual' })
    if (error) { setNote(/duplicate key|unique/i.test(error.message) ? 'An article with that address already exists. Change the title or address.' : error.message); return }
    setNote('Article saved.'); setDraft(null); await load()
  }

  const staleRun = (r: Run) => r.status === 'running' && Date.now() - new Date(r.created_at).getTime() > STALE_MS

  return (
    <div className="kaiWrap">
      <div className="glassCard kaiHeader">
        <Sparkles size={24} />
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h3>AI Knowledge Manager</h3>
          <p>
            Searches the web and the existing Knowledge Base for what RideArrivo staff need, then
            proposes new or corrected articles. Nothing is published until you approve it here.
          </p>
        </div>
        <span className="adminState ok">Admin only</span>
      </div>

      {status && !status.configured && (
        <div className="glassCard kaiWarn" role="status">
          <strong>The AI is not connected yet.</strong>
          <span>Set the ANTHROPIC_API_KEY secret for the knowledge-ai function (see the setup notes). Manual article editing below works without it.</span>
        </div>
      )}

      {note && <div className="glassCard kaiNote" role="status" aria-live="polite">{note}</div>}

      <section className="glassCard kaiCard" aria-labelledby="kai-research">
        <h4 id="kai-research">Research</h4>
        <p className="kaiHint">Pick a starting point or describe what to look into. The AI cites only pages its search actually returned.</p>
        <div className="kaiChips">
          {PRESETS.map(([label, text]) => (
            <button key={label} type="button" className="glassButton" onClick={() => setTopic(text)} disabled={busy}>{label}</button>
          ))}
        </div>
        <label className="kaiField">
          <span>What should it look into? (blank means a full review)</span>
          <textarea value={topic} onChange={e => setTopic(e.target.value.slice(0, 600))} rows={3} disabled={busy} />
        </label>
        <div className="kaiRow">
          <button type="button" className="primaryButton" onClick={() => void research()}
            disabled={busy || !status?.configured || status?.enabled === false}>
            {busy ? <Loader2 size={15} className="kaiSpin" /> : <Sparkles size={15} />}
            {busy ? 'Researching...' : 'Research now'}
          </button>
          <label className="settingsToggle kaiToggle">
            <input type="checkbox" checked={status?.enabled !== false}
              onChange={e => void saveSettings({ enabled: e.target.checked })} />
            <span>Knowledge Manager switched on</span>
          </label>
          {status && <small className="kaiHint">Model: {status.model}</small>}
        </div>
        <label className="kaiField">
          <span>Standing focus (added to every run)</span>
          <textarea value={focus} onChange={e => setFocus(e.target.value.slice(0, 600))} rows={2}
            placeholder="For example: prioritise airport pickup and safety information." />
        </label>
        <button type="button" className="glassButton" onClick={() => void saveSettings({ focus })}><Save size={14} /> Save focus</button>
      </section>

      <section className="kaiCard" aria-labelledby="kai-queue">
        <div className="kaiRow kaiSpread">
          <h4 id="kai-queue">Review queue ({proposals.length})</h4>
          <button type="button" className="glassButton" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
        {proposals.length === 0 && <div className="glassCard adminEmpty">Nothing waiting. Run a research pass to get proposals.</div>}
        {proposals.map(p => {
          const current = p.article_id ? byId.get(p.article_id) : undefined
          const isOpen = !!open[p.id]
          return (
            <article key={p.id} className="glassCard kaiProposal">
              <div className="kaiRow kaiSpread">
                <div>
                  <span className={`adminState ${p.kind === 'update' ? 'idle' : 'ok'}`}>{p.kind === 'update' ? 'Update' : 'New article'}</span>{' '}
                  <span className="eyebrow">{p.category}</span>
                  <h5>{p.title}</h5>
                </div>
                <div className="kaiRow">
                  <button type="button" className="glassButton" disabled={deciding === p.id} onClick={() => void decide(p, false)}><X size={14} /> Reject</button>
                  <button type="button" className="primaryButton" disabled={deciding === p.id} onClick={() => void decide(p, true)}><Check size={14} /> Approve and publish</button>
                </div>
              </div>
              {p.summary && <p>{p.summary}</p>}
              {p.rationale && <p className="kaiWhy"><strong>Why:</strong> {p.rationale}</p>}
              {p.source_links.length > 0
                ? <ul className="kaiSources">{p.source_links.map(l => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title || l.url}</a></li>)}</ul>
                : <p className="kaiHint">No web sources. Based on the existing Knowledge Base only.</p>}
              <button type="button" className="glassButton" onClick={() => setOpen(o => ({ ...o, [p.id]: !isOpen }))}>
                {isOpen ? <EyeOff size={14} /> : <Eye size={14} />} {isOpen ? 'Hide text' : (current ? 'Compare with current' : 'Read proposed text')}
              </button>
              {isOpen && (
                <div className={current ? 'kaiCompare' : ''}>
                  {current && <div><h6>Current</h6><ArticleBody text={current.content} /></div>}
                  <div><h6>Proposed</h6><ArticleBody text={p.content} /></div>
                </div>
              )}
            </article>
          )
        })}
      </section>

      <section className="kaiCard" aria-labelledby="kai-articles">
        <div className="kaiRow kaiSpread">
          <h4 id="kai-articles">All articles ({articles.length})</h4>
          <button type="button" className="glassButton" onClick={() => setDraft({ ...blankDraft })}><Plus size={14} /> New article</button>
        </div>

        {draft && (
          <div className="glassCard kaiEditor">
            <h5>{draft.id ? 'Edit article' : 'New article'}</h5>
            <label className="kaiField"><span>Title</span>
              <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value.slice(0, 120) })} /></label>
            {!draft.id && <label className="kaiField"><span>Address (optional, made from the title)</span>
              <input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value.slice(0, 80) })} /></label>}
            <div className="kaiGrid2">
              <label className="kaiField"><span>Category</span>
                <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
              <label className="kaiField"><span>Visible to staff?</span>
                <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Article['status'] })}>
                  <option value="published">Published</option><option value="draft">Draft (hidden)</option><option value="archived">Archived</option></select></label>
            </div>
            <label className="kaiField"><span>Summary</span>
              <input value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value.slice(0, 300) })} /></label>
            <label className="kaiField"><span>Tags (comma separated)</span>
              <input value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} /></label>
            <label className="kaiField"><span>Content. Use "## " for headings and "- " for bullets.</span>
              <textarea rows={12} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value.slice(0, 20000) })} /></label>
            <div className="kaiRow">
              <button type="button" className="primaryButton" onClick={() => void saveDraft()}><Save size={14} /> Save</button>
              <button type="button" className="glassButton" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="glassCard kaiTableWrap">
          <table className="adminPeopleTable kaiTable">
            <thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Origin</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {articles.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong><small>{a.slug}</small></td>
                  <td>{a.category}</td>
                  <td><span className={`adminState ${a.status === 'published' ? 'ok' : a.status === 'draft' ? 'idle' : 'off'}`}>{a.status}</span></td>
                  <td>{a.source === 'ai' ? 'AI, approved' : a.source === 'seed' ? 'Starter set' : 'Written by hand'}</td>
                  <td>{when(a.updated_at)}</td>
                  <td className="kaiActions">
                    <button type="button" className="glassButton" aria-label={`Edit ${a.title}`}
                      onClick={() => setDraft({ id: a.id, title: a.title, slug: a.slug, summary: a.summary || '', content: a.content, category: CATEGORIES.includes(a.category) ? a.category : 'General', tags: (a.tags || []).join(', '), status: a.status })}><Pencil size={13} /></button>
                    {a.status === 'published'
                      ? <button type="button" className="glassButton" aria-label={`Hide ${a.title}`} title="Hide from staff" onClick={() => void setArticleStatus(a, 'draft')}><EyeOff size={13} /></button>
                      : <button type="button" className="glassButton" aria-label={`Publish ${a.title}`} title="Publish" onClick={() => void setArticleStatus(a, 'published')}><BookOpen size={13} /></button>}
                    {a.status !== 'archived' && <button type="button" className="glassButton" aria-label={`Archive ${a.title}`} title="Archive" onClick={() => void setArticleStatus(a, 'archived')}><Archive size={13} /></button>}
                  </td>
                </tr>
              ))}
              {articles.length === 0 && <tr><td colSpan={6} className="adminEmpty">No articles yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kaiCard" aria-labelledby="kai-runs">
        <h4 id="kai-runs">Recent research runs</h4>
        {runs.length === 0 && <div className="glassCard adminEmpty">No runs yet.</div>}
        {runs.map(r => (
          <div key={r.id} className="glassCard kaiRun">
            <div className="kaiRow kaiSpread">
              <strong>{r.topic ? r.topic.slice(0, 90) : 'Full review'}</strong>
              <span className={`adminState ${r.status === 'done' ? 'ok' : r.status === 'failed' || staleRun(r) ? 'off' : 'idle'}`}>{staleRun(r) ? 'timed out' : r.status}</span>
            </div>
            <small>{when(r.created_at)} · {r.searches_used} searches · {r.proposals_count} proposals</small>
            {(r.summary || r.error) && <p>{r.error || r.summary}</p>}
          </div>
        ))}
      </section>
    </div>
  )
}
