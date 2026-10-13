import { supabase } from './supabase'
import { resolveBlogOrigin } from './blogPolicy'
import type { BlogRole } from './blogPolicy'
export type BlogStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived'
export type BlogContentType = 'article' | 'quick_post'
export type BlogAssetKind = 'image' | 'source' | 'attachment'
export type BlogAssetRelationship = 'cover' | 'source' | 'attachment' | 'inline'
export type BlogIdentity = { employee_id: string; full_name: string; role: BlogRole | null; active: boolean; can_manage_access: boolean }
export type BlogPermissions = { write: boolean; publish: boolean; archive: boolean; remove: boolean; manage_access: boolean }
export type BlogMe = { identity: BlogIdentity; permissions: BlogPermissions; categories: string[] }
export type BlogArticle = {
  id: string; version: number; content_type: BlogContentType; title: string; slug: string; excerpt: string; body: string; category: string;
  status: BlogStatus; published_at: string | null; cover_media_id: string | null; cover_alt: string;
  editorial_note: string; fact_checked: boolean; ever_published: boolean; author_id: string; author_name: string;
  updated_at: string; created_at: string; can_edit: boolean; reading_minutes: number;
}
export type BlogDraft = Pick<BlogArticle, 'content_type'|'title'|'slug'|'excerpt'|'body'|'category'|'status'|'published_at'|'cover_media_id'|'cover_alt'|'editorial_note'|'fact_checked'> & { id?:string; version?:number; ever_published?:boolean; author_id?:string; can_edit?:boolean }
export type BlogList = { posts: BlogArticle[]; total: number; page: number; page_size: number; counts: Record<string,number> }
export type BlogMedia = { id: string; filename: string; mime: string; bytes: number; uploaded_by: string; uploaded_at: string }
export type BlogAsset = { id:string; object_key:string; original_filename:string; mime_type:string; byte_size:number; asset_kind:BlogAssetKind; uploaded_by:string; alt_text:string; sha256:string|null; created_at:string }
export type BlogPostAssetLink = { asset:BlogAsset; relationship:BlogAssetRelationship; sort_order:number; linked_at:string }
export type BlogPerson = { employee_id: string; full_name: string; email: string; department: string; active: boolean; workspace_role: string; blog_role: BlogRole | null; granted_at: string | null }
export type BlogEvent = { id: string; post_id: string; title: string; event: string; version: number; actor_id: string; created_at: string }
export type BlogAccessEvent = { id:string; actor_name:string; target_name:string; previous_role:BlogRole|null; new_role:BlogRole|null; happened_at:string }
export type BlogRevision = { id:string; version:number; event:string; created_at:string; snapshot:BlogDraft }
export class BlogApiError extends Error { constructor(message:string, public status:number) { super(message) } }
export function blogOrigin(): string { return resolveBlogOrigin(import.meta.env.VITE_BLOG_API_ORIGIN as string | undefined, import.meta.env.DEV) }
type Options = { method?: 'GET'|'POST'|'PATCH'|'DELETE'; data?: unknown; file?: File; assetKind?:BlogAssetKind; signal?: AbortSignal }
export function inferBlogAssetMime(file:Pick<File,'name'|'type'>):string {
  if (file.type) return file.type
  const name=file.name.toLowerCase()
  if(name.endsWith('.pdf')) return 'application/pdf'
  if(name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if(name.endsWith('.md')) return 'text/markdown'
  if(name.endsWith('.txt')) return 'text/plain'
  if(name.endsWith('.json')) return 'application/json'
  if(name.endsWith('.jpg')||name.endsWith('.jpeg')) return 'image/jpeg'
  if(name.endsWith('.png')) return 'image/png'
  if(name.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}
async function send(route:string, options:Options = {}):Promise<Response> {
  const origin = blogOrigin()
  const url = new URL(`/api/studio/${route}`, origin)
  if (url.origin !== origin || !url.pathname.startsWith('/api/studio/') || route.includes('\\')) throw new Error('Invalid Blog Studio API route.')
  if (!supabase) throw new Error('RA-Workspace sign-in is not configured.')
  const { data, error } = await supabase.auth.getSession()
  const session = data.session
  if (error || !session?.access_token) throw new BlogApiError('Sign in to RA-Workspace again to use Blog Studio.', 401)
  const headers:Record<string,string> = { Authorization: `Bearer ${session.access_token}` }
  let body:BodyInit|undefined
  if (options.file) {
    headers['Content-Type'] = inferBlogAssetMime(options.file)
    headers['X-File-Name'] = encodeURIComponent(options.file.name)
    if(options.assetKind)headers['X-Asset-Kind']=options.assetKind
    body = options.file
  } else if (options.data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.data) }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', abort, { once:true })
  const timeout = window.setTimeout(abort, 25000)
  try {
    const response = await fetch(url, { method:options.method || 'GET', headers, body, credentials: 'omit', cache:'no-store', redirect:'error', signal:controller.signal })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as {error?:unknown}
      throw new BlogApiError(typeof payload.error === 'string' ? payload.error.slice(0,600) : `Blog request failed (${response.status}). Check its deployment and bindings.`, response.status)
    }
    return response
  } finally { window.clearTimeout(timeout); options.signal?.removeEventListener('abort', abort) }
}
export async function blogRequest<T>(route:string, options:Options = {}):Promise<T> {
  const response = await send(route, options)
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new BlogApiError('The Blog API returned a web page instead of data. Check the Pages Functions deployment.', 503)
  return response.json() as Promise<T>
}
export async function blogImage(id:string, signal?:AbortSignal):Promise<Blob> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid image identifier.')
  return (await send(`media/${id}`, {signal})).blob()
}
export async function uploadBlogAsset(file:File,kind:BlogAssetKind,signal?:AbortSignal):Promise<BlogAsset>{
  const payload=await blogRequest<{asset:BlogAsset}>('assets',{method:'POST',file,assetKind:kind,signal});return payload.asset
}
export async function listBlogAssets(page=1):Promise<{assets:BlogAsset[];page:number;has_more:boolean}>{return blogRequest(`assets?page=${page}`)}
export async function importBlogDraft(assetId:string,draft:Pick<BlogDraft,'title'|'slug'|'excerpt'|'body'|'category'|'editorial_note'>):Promise<{post:BlogArticle;source_asset:BlogAsset}>{
  return blogRequest('import',{method:'POST',data:{asset_id:assetId,content_type:'article',draft}})
}
export async function linkBlogAsset(postId:string,assetId:string,relationship:BlogAssetRelationship):Promise<void>{await blogRequest(`posts/${postId}/assets`,{method:'POST',data:{asset_id:assetId,relationship}})}
export async function listPostAssets(postId:string):Promise<BlogPostAssetLink[]>{const value=await blogRequest<{assets:BlogPostAssetLink[]}>(`posts/${postId}/assets`);return value.assets}
export async function unlinkBlogAsset(postId:string,assetId:string,relationship:BlogAssetRelationship):Promise<void>{await blogRequest(`posts/${postId}/assets/${assetId}?relationship=${encodeURIComponent(relationship)}`,{method:'DELETE'})}
export function blankBlogDraft(contentType:BlogContentType='article'):BlogDraft {
  return { content_type:contentType,title:'',slug:'',excerpt:'',body:'',category:'Mobility',status:'draft',published_at:null,cover_media_id:null,cover_alt:'',editorial_note:'',fact_checked:false }
}
