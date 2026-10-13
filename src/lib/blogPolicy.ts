export type BlogRole = 'writer' | 'editor' | 'blog_admin'
/** Explicit destinations only: never send staff tokens to an arbitrary URL. */
export function resolveBlogOrigin(value?: string, dev = false): string {
  const url = new URL(value || 'https://blog.ridearrivo.com')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Blog API must be an origin without credentials or a path.')
  const trusted = new Set(['https://blog.ridearrivo.com', 'https://blog-3h5.pages.dev'])
  const local = dev && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8788'
  if (!trusted.has(url.origin) && !local) throw new Error('Untrusted Blog API origin. Use blog.ridearrivo.com or the approved Pages project.')
  return url.origin
}
export function canEditBlogPost(role: string | null, user: string, post: {author_id:string;status:string;ever_published:boolean}): boolean {
  if (role === 'editor' || role === 'blog_admin') return true
  return role === 'writer' && user === post.author_id && ['draft', 'review'].includes(post.status) && !post.ever_published
}
/** The editor explicitly labels its input as Lagos (UTC+1), not device time. */
export function fromLagosInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Select a valid Lagos date and time.')
  const parsed = new Date(`${value}:00+01:00`)
  if (!Number.isFinite(parsed.getTime()) || toLagosInput(parsed.toISOString()) !== value) throw new Error('Select a valid calendar date and time.')
  return parsed.toISOString()
}
export function toLagosInput(value: string | null): string {
  if (!value) return ''
  const n = Date.parse(value)
  return Number.isFinite(n) ? new Date(n + 3600000).toISOString().slice(0,16) : ''
}
export const BLOG_ROLE_LABELS: Record<BlogRole, string> = { writer: 'Writer', editor: 'Editor', blog_admin: 'Blog administrator' }
export const BLOG_CATEGORIES = ['Mobility', 'Travel guides', 'Company news', 'For drivers'] as const
