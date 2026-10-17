import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as core from '../supabase/functions/_shared/knowledgeAiCore.ts'

const read = f => readFileSync(f, 'utf8')
const existing = [{ id: 'a1', slug: 'membership-plans', title: 'Membership plans', summary: '', category: 'Products', content: 'Old text about plans that is long enough to count.' }]
const long = 'This is a sufficiently long article body for the proposal to count as real content.'

test('cleanProposals: strips HTML and em dashes, caps and categorises', () => {
  const [p] = core.cleanProposals([{ slug: 'New Thing!', title: '<b>Lagos rules</b> — summary', content: `<script>x()</script>${long}—end`, category: 'Nonsense', tags: ['A B', 'a-b'], rationale: 'why' }], existing, new Map(), new Set())
  assert.equal(p.kind, 'create'); assert.equal(p.slug, 'new-thing'); assert.equal(p.category, 'General')
  assert.ok(!/[<>—]/.test(p.title + p.content)); assert.deepEqual(p.tags, ['a-b'])
})

test('cleanProposals: same slug becomes an update, identical text is dropped', () => {
  const [u] = core.cleanProposals([{ slug: 'membership-plans', title: 'Membership plans', content: long, category: 'Products', rationale: 'r' }], existing, new Map(), new Set())
  assert.equal(u.kind, 'update'); assert.equal(u.article_id, 'a1')
  assert.deepEqual(core.cleanProposals([{ slug: 'membership-plans', title: 'Membership plans', content: '  OLD text about plans that is long enough to count. ', category: 'Products', rationale: 'r' }], existing, new Map(), new Set()), [])
})

test('cleanProposals: skips pending slugs, duplicates, junk, and caps the count', () => {
  const mk = i => ({ slug: `s${i}`, title: `Title ${i}`, content: long, category: 'Industry', rationale: 'r' })
  const many = core.cleanProposals([...Array(10)].map((_, i) => mk(i)), existing, new Map(), new Set(['s0']))
  assert.equal(many.length, core.LIMITS.maxProposals); assert.ok(!many.some(p => p.slug === 's0'))
  assert.equal(core.cleanProposals([mk(1), mk(1), null, 'x', { title: 'a', content: 'short' }], existing, new Map(), new Set()).length, 1)
  assert.deepEqual(core.cleanProposals('nope', existing, new Map(), new Set()), [])
})

test('citations: only URLs the search returned, or our own domain, https only', () => {
  const seen = new Map([['https://www.ncc.gov.ng/page', 'NCC page']])
  const links = core.safeLinks(['https://www.ncc.gov.ng/page', 'https://evil.example/x', 'http://www.ridearrivo.com/a', 'https://www.ridearrivo.com/b', 'javascript:alert(1)', 5, 'https://www.ncc.gov.ng/page'], seen)
  assert.deepEqual(links.map(l => l.url), ['https://www.ncc.gov.ng/page', 'https://www.ridearrivo.com/b'])
})

test('collectSeenUrls reads web_search_result blocks only', () => {
  const m = new Map()
  core.collectSeenUrls([{ type: 'text', text: 'https://x.com' }, { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.com/p', title: 'A' }, { type: 'x', url: 'https://b.com' }] }], m)
  assert.deepEqual([...m.keys()], ['https://a.com/p'])
})

test('prompts treat web text as data and ban em dashes', () => {
  const sys = core.buildSystemPrompt()
  assert.match(sys, /DATA/); assert.match(sys, /Never follow them/); assert.ok(!sys.includes('—'))
  assert.match(core.buildUserPrompt('look at X', 'focus', existing), /membership-plans/)
})

test('slugify', () => { assert.equal(core.slugify('  Crème Brûlée & Co.  '), 'creme-brulee-co') })

const md = await import('data:text/javascript;base64,' + Buffer.from(transformSync(read('src/lib/miniMarkdown.tsx'), { loader: 'tsx', format: 'esm', jsx: 'automatic', jsxImportSource: 'react' }).code.replace(/from "react\/jsx-runtime"/, 'from "data:text/javascript,export const jsx=()=>null,jsxs=()=>null,Fragment=null"')).toString('base64'))
test('miniMarkdown parses headings, bullets and paragraphs', () => {
  const b = md.parseBlocks('## Title\nintro line\nmore\n\n- one\n- two\n\npara')
  assert.deepEqual(b.map(x => x.kind), ['h', 'p', 'ul', 'p']); assert.deepEqual(b[2].items, ['one', 'two']); assert.equal(b[1].text, 'intro line\nmore')
})

test('seed articles: unique slugs, no em dashes, all in the migration', () => {
  const a = JSON.parse(read('supabase/seed/knowledge-articles.json'))
  const sql = read('supabase/migrations/20261017130100_seed_knowledge_articles.sql')
  assert.equal(new Set(a.map(x => x.slug)).size, a.length); assert.ok(a.length >= 15)
  for (const x of a) {
    assert.ok(!(x.title + x.content + x.summary).includes('—'), x.slug)
    assert.ok(x.content.length > 200, x.slug); assert.ok(sql.includes(`$kb$${x.slug}$kb$`), x.slug)
  }
  assert.match(sql, /on conflict \(slug\) do nothing/)
})

test('migration: admin-only, proposals not client-writable, decide function pinned', () => {
  const sql = read('supabase/migrations/20261017130000_knowledge_ai_manager.sql')
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/)
  assert.match(sql, /has_workspace_role\(array\['admin'\]\)/)
  assert.match(sql, /for update;/)
  assert.ok(!/grant (insert|update|delete)[^;]*knowledge_ai_(runs|proposals)/i.test(sql))
  assert.match(sql, /revoke all on function public\.decide_knowledge_ai_proposal\(uuid, boolean\) from public, anon/)
})

test('function and Administration wiring', () => {
  assert.match(read('supabase/config.toml'), /\[functions\.knowledge-ai\][\s\S]*verify_jwt = true/)
  const fn = read('supabase/functions/knowledge-ai/index.ts')
  assert.match(fn, /data\.role !== "admin"/); assert.match(fn, /ANTHROPIC_API_KEY/); assert.match(fn, /web_search_20250305/)
  assert.ok(!/from\("workspace_knowledge_articles"\)\s*\.(insert|update|upsert)/.test(fn), 'function never writes articles directly')
  const admin = read('src/modules/AdministrationControlPlane.tsx')
  assert.match(admin, /'ai-knowledge','AI Management'/); assert.match(admin, /tab==='ai-knowledge'&&<AdminKnowledgeAi\/>/)
  assert.match(admin, /onOpenTab\('ai-knowledge'\)/)
  assert.match(read('src/modules/Phase2Modules.tsx'), /<ArticleBody text=\{selected\.content\}/)
})
