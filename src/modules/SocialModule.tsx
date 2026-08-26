import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  AtSign, BarChart3, Bell, Bookmark, BookmarkCheck, CalendarClock, Camera, CheckCircle2,
  CircleUserRound, Ellipsis, Flag, Hash, Heart, ImagePlus, List, Lock, Megaphone,
  MessageCircle, MessagesSquare, Newspaper, Paperclip, Plus, Repeat2, Search, Send,
  ShieldCheck, Smile, Sparkles, TrendingUp, Upload, UserPlus, Users, Vote, X
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type FeedTab='For You'|'Following'|'News'|'Bookmarks'
type SocialPost={
  id:string;author_id:string;body:string;post_type:string;visibility:string;reply_to_id?:string|null;
  quote_post_id?:string|null;created_at:string;edited_at?:string|null;scheduled_for?:string|null;
  author?:{full_name?:string;email?:string;department?:string;job_title?:string}|null;
  media?:{id:string;storage_path:string;media_type:string;alt_text?:string|null;signed_url?:string|null}[];
  likes?:number;replies?:number;reposts?:number;liked?:boolean;bookmarked?:boolean;reposted?:boolean;
}

type Notice={kind:'ok'|'error';text:string}
const initials=(name?:string)=>String(name||'RA').split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase()
const timeAgo=(date:string)=>{const ms=Date.now()-new Date(date).getTime();const m=Math.max(1,Math.floor(ms/60000));if(m<60)return `${m}m`;const h=Math.floor(m/60);if(h<24)return `${h}h`;const d=Math.floor(h/24);return `${d}d`}

export function SocialModule(){
  const [tab,setTab]=useState<FeedTab>('For You')
  const [posts,setPosts]=useState<SocialPost[]>([])
  const [loading,setLoading]=useState(true)
  const [notice,setNotice]=useState<Notice|null>(null)
  const [query,setQuery]=useState('')
  const [body,setBody]=useState('')
  const [visibility,setVisibility]=useState('employees')
  const [postType,setPostType]=useState('post')
  const [schedule,setSchedule]=useState('')
  const [files,setFiles]=useState<File[]>([])
  const [publishing,setPublishing]=useState(false)
  const [replyTo,setReplyTo]=useState<SocialPost|null>(null)
  const [replyBody,setReplyBody]=useState('')
  const [trends,setTrends]=useState<{tag:string;count:number}[]>([])
  const [people,setPeople]=useState<{id:string;full_name:string;department:string;job_title:string}[]>([])
  const fileRef=useRef<HTMLInputElement|null>(null)

  const load=async()=>{
    if(!supabase){setLoading(false);return}
    setLoading(true);setNotice(null)
    const {data:sessionData}=await supabase.auth.getSession();const uid=sessionData.session?.user.id
    let q=supabase.from('social_posts').select(`id,author_id,body,post_type,visibility,reply_to_id,quote_post_id,created_at,edited_at,scheduled_for,author:employee_profiles!social_posts_author_id_fkey(full_name,email,department,job_title),media:social_post_media(id,storage_path,media_type,alt_text)`).is('deleted_at',null).is('reply_to_id',null).order('created_at',{ascending:false}).limit(80)
    if(tab==='News') q=q.in('post_type',['news','announcement'])
    if(tab==='Following'&&uid){const {data:f}=await supabase.from('social_follows').select('following_id').eq('follower_id',uid);const ids=(f||[]).map(x=>x.following_id);q=ids.length?q.in('author_id',ids):q.eq('author_id',uid)}
    const {data,error}=await q
    if(error){setNotice({kind:'error',text:error.message});setPosts([]);setLoading(false);return}
    let base=(data||[]) as unknown as SocialPost[]
    const mediaPaths=base.flatMap(p=>(p.media||[]).map(m=>m.storage_path)).filter(Boolean)
    if(mediaPaths.length){
      const {data:signed}=await supabase.storage.from('social-media').createSignedUrls(mediaPaths,3600)
      const urlMap=new Map((signed||[]).map(x=>[x.path,x.signedUrl]))
      base=base.map(p=>({...p,media:(p.media||[]).map(m=>({...m,signed_url:urlMap.get(m.storage_path)||null}))}))
    }
    const ids=base.map(p=>p.id)
    const [likes,replies,reposts,bookmarks,myLikes,myBookmarks,myReposts]=await Promise.all([
      ids.length?supabase.from('social_post_reactions').select('post_id').in('post_id',ids).eq('reaction','like'):Promise.resolve({data:[]}),
      ids.length?supabase.from('social_posts').select('reply_to_id').in('reply_to_id',ids).is('deleted_at',null):Promise.resolve({data:[]}),
      ids.length?supabase.from('social_reposts').select('post_id').in('post_id',ids):Promise.resolve({data:[]}),
      ids.length?supabase.from('social_bookmarks').select('post_id').in('post_id',ids):Promise.resolve({data:[]}),
      uid&&ids.length?supabase.from('social_post_reactions').select('post_id').eq('user_id',uid).eq('reaction','like').in('post_id',ids):Promise.resolve({data:[]}),
      uid&&ids.length?supabase.from('social_bookmarks').select('post_id').eq('user_id',uid).in('post_id',ids):Promise.resolve({data:[]}),
      uid&&ids.length?supabase.from('social_reposts').select('post_id').eq('user_id',uid).in('post_id',ids):Promise.resolve({data:[]}),
    ])
    const count=(rows:any[]|null|undefined,key:string,id:string)=>rows?.filter(r=>r[key]===id).length||0
    const mine=(rows:any[]|null|undefined,id:string)=>!!rows?.some(r=>r.post_id===id)
    let enhanced=base.map(p=>({...p,likes:count(likes.data,'post_id',p.id),replies:count(replies.data,'reply_to_id',p.id),reposts:count(reposts.data,'post_id',p.id),liked:mine(myLikes.data,p.id),bookmarked:mine(myBookmarks.data,p.id),reposted:mine(myReposts.data,p.id)}))
    if(tab==='Bookmarks'&&uid) enhanced=enhanced.filter(p=>p.bookmarked)
    setPosts(enhanced)
    const {data:tagRows}=await supabase.from('social_post_hashtags').select('hashtag:social_hashtags(tag)').limit(400)
    const counts=new Map<string,number>();(tagRows||[]).forEach((r:any)=>{const tag=r.hashtag?.tag;if(tag)counts.set(tag,(counts.get(tag)||0)+1)})
    setTrends([...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([tag,count])=>({tag,count})))
    const {data:profiles}=await supabase.from('employee_profiles').select('id,full_name,department,job_title').eq('active',true).limit(8)
    setPeople((profiles||[]) as any)
    setLoading(false)
  }
  useEffect(()=>{void load()},[tab])

  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return q?posts.filter(p=>p.body.toLowerCase().includes(q)||String(p.author?.full_name||'').toLowerCase().includes(q)):posts},[posts,query])

  const uploadMedia=async(postId:string)=>{
    if(!supabase||files.length===0)return
    const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid)return
    for(const file of files.slice(0,4)){
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'-');const path=`${uid}/${postId}/${crypto.randomUUID()}-${safe}`
      const {error}=await supabase.storage.from('social-media').upload(path,file,{upsert:false,contentType:file.type})
      if(error)throw error
      await supabase.from('social_post_media').insert({post_id:postId,storage_path:path,media_type:file.type.startsWith('video/')?'video':'image'})
    }
  }
  const extractHashtags=async(postId:string,text:string)=>{
    if(!supabase)return
    const tags=[...new Set([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)].map(m=>m[1].toLowerCase()).slice(0,10))]
    for(const tag of tags){const {data}=await supabase.from('social_hashtags').upsert({tag},{onConflict:'tag'}).select('id').single();if(data)await supabase.from('social_post_hashtags').upsert({post_id:postId,hashtag_id:data.id})}
  }
  const publish=async(e:FormEvent)=>{
    e.preventDefault();if(!supabase||!body.trim())return;setPublishing(true);setNotice(null)
    const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid){setPublishing(false);return}
    const payload:any={author_id:uid,body:body.trim(),post_type:postType,visibility}
    if(schedule)payload.scheduled_for=new Date(schedule).toISOString()
    const {data,error}=await supabase.from('social_posts').insert(payload).select('id').single()
    if(error){setNotice({kind:'error',text:error.message});setPublishing(false);return}
    try{await uploadMedia(data.id);await extractHashtags(data.id,body)}catch(err:any){setNotice({kind:'error',text:`Post saved, but media failed: ${err.message}`})}
    setBody('');setFiles([]);setSchedule('');setPublishing(false);if(!notice)setNotice({kind:'ok',text:schedule?'Post scheduled.':'Post published.'});await load()
  }
  const toggleLike=async(p:SocialPost)=>{if(!supabase)return;const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid)return;p.liked?await supabase.from('social_post_reactions').delete().eq('post_id',p.id).eq('user_id',uid).eq('reaction','like'):await supabase.from('social_post_reactions').upsert({post_id:p.id,user_id:uid,reaction:'like'});await load()}
  const toggleBookmark=async(p:SocialPost)=>{if(!supabase)return;const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid)return;p.bookmarked?await supabase.from('social_bookmarks').delete().eq('post_id',p.id).eq('user_id',uid):await supabase.from('social_bookmarks').upsert({post_id:p.id,user_id:uid});await load()}
  const toggleRepost=async(p:SocialPost)=>{if(!supabase)return;const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid)return;p.reposted?await supabase.from('social_reposts').delete().eq('post_id',p.id).eq('user_id',uid):await supabase.from('social_reposts').upsert({post_id:p.id,user_id:uid});await load()}
  const sendReply=async(e:FormEvent)=>{e.preventDefault();if(!supabase||!replyTo||!replyBody.trim())return;const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid)return;const {error}=await supabase.from('social_posts').insert({author_id:uid,body:replyBody.trim(),post_type:'reply',visibility:replyTo.visibility,reply_to_id:replyTo.id});if(error)setNotice({kind:'error',text:error.message});else{setReplyBody('');setReplyTo(null);await load()}}
  const follow=async(id:string)=>{if(!supabase)return;const {data:s}=await supabase.auth.getSession();const uid=s.session?.user.id;if(!uid||uid===id)return;await supabase.from('social_follows').upsert({follower_id:uid,following_id:id});setNotice({kind:'ok',text:'Following updated.'})}

  return <section className="socialModule">
    <div className="sectionTitle"><div><span className="eyebrow">RIDEARRIVO SOCIAL & NEWS</span><h2>RideArrivo Pulse</h2><p>Company news, conversations, announcements and team knowledge in a fast social feed.</p></div><div className="buttonRow"><button className="glassButton"><Bell size={16}/>Notifications</button><button className="primaryButton" onClick={()=>document.getElementById('social-composer')?.scrollIntoView({behavior:'smooth'})}><Plus size={16}/>Post</button></div></div>
    <div className="socialLayout">
      <div className="socialMain">
        <div className="glassCard socialTabs">{(['For You','Following','News','Bookmarks'] as FeedTab[]).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='News'?<Newspaper size={16}/>:t==='Bookmarks'?<Bookmark size={16}/>:t==='Following'?<Users size={16}/>:<Sparkles size={16}/>}<span>{t}</span></button>)}</div>
        <form id="social-composer" className="glassCard socialComposer" onSubmit={publish}>
          <div className="composerTop"><div className="composerAvatar">RA</div><textarea value={body} onChange={e=>setBody(e.target.value.slice(0,10000))} placeholder="What's happening at RideArrivo? Share news, an update, a win or an idea…"/></div>
          {files.length>0&&<div className="mediaQueue">{files.map((f,i)=><span key={`${f.name}-${i}`}><Paperclip size={13}/>{f.name}<button type="button" onClick={()=>setFiles(files.filter((_,x)=>x!==i))}><X size={12}/></button></span>)}</div>}
          <div className="composerOptions"><select value={postType} onChange={e=>setPostType(e.target.value)}><option value="post">Post</option><option value="news">News</option><option value="announcement">Announcement</option></select><select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="employees">All employees</option><option value="department">My department</option><option value="leadership">Leadership</option></select>{schedule&&<input type="datetime-local" value={schedule} onChange={e=>setSchedule(e.target.value)}/>}</div>
          <div className="composerBar"><div><input ref={fileRef} hidden type="file" accept="image/*,video/*" multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>setFiles(Array.from(e.target.files||[]).slice(0,4))}/><button type="button" className="iconButton" title="Add media" onClick={()=>fileRef.current?.click()}><ImagePlus size={17}/></button><button type="button" className="iconButton" title="Schedule" onClick={()=>setSchedule(schedule?'':new Date(Date.now()+3600000).toISOString().slice(0,16))}><CalendarClock size={17}/></button><button type="button" className="iconButton" title="Poll"><Vote size={17}/></button><button type="button" className="iconButton" title="Emoji"><Smile size={17}/></button></div><div className="composerSubmit"><small>{body.length}/10,000</small><button className="primaryButton" disabled={publishing||!body.trim()}>{publishing?'Publishing…':schedule?'Schedule':'Post'}</button></div></div>
        </form>
        {notice&&<div className={notice.kind==='ok'?'moduleNotice':'moduleError'}>{notice.text}</div>}
        <div className="glassCard socialSearch"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search posts and people"/></div>
        <div className="socialFeed">{loading?<div className="glassCard socialEmpty">Loading feed…</div>:filtered.length===0?<div className="glassCard socialEmpty"><Newspaper/><strong>No posts yet</strong><span>Start the RideArrivo conversation.</span></div>:filtered.map(p=><article key={p.id} className="glassCard socialPost">
          <div className="postAvatar">{initials(p.author?.full_name)}</div><div className="postBody"><div className="postMeta"><strong>{p.author?.full_name||'RideArrivo Employee'}</strong><span>@{String(p.author?.email||'employee').split('@')[0]} · {timeAgo(p.created_at)}</span>{p.post_type!=='post'&&<span className="postType">{p.post_type}</span>}<button className="postMore"><Ellipsis size={17}/></button></div><p className="postText">{p.body}</p>{p.media&&p.media.length>0&&<div className={`postMedia mediaCount${Math.min(4,p.media.length)}`}>{p.media.slice(0,4).map(m=>m.media_type==='video'?<video key={m.id} src={m.signed_url||''} controls/>:<img key={m.id} src={m.signed_url||''} alt={m.alt_text||'Post media'}/>)}</div>}<div className="postActions"><button onClick={()=>setReplyTo(p)}><MessageCircle size={17}/><span>{p.replies||0}</span></button><button className={p.reposted?'active repost':''} onClick={()=>void toggleRepost(p)}><Repeat2 size={17}/><span>{p.reposts||0}</span></button><button className={p.liked?'active like':''} onClick={()=>void toggleLike(p)}><Heart size={17}/><span>{p.likes||0}</span></button><button className={p.bookmarked?'active':''} onClick={()=>void toggleBookmark(p)}>{p.bookmarked?<BookmarkCheck size={17}/>:<Bookmark size={17}/>}</button><button title="Report"><Flag size={16}/></button></div></div>
        </article>)}</div>
      </div>
      <aside className="socialRail">
        <div className="glassCard railCard"><h3><TrendingUp size={18}/>Trending at RideArrivo</h3>{trends.length?trends.map((t,i)=><button key={t.tag} className="trend"><span><small>{i+1} · Trending</small><strong>#{t.tag}</strong><small>{t.count} posts</small></span><Ellipsis size={16}/></button>):<p>No trends yet. Add hashtags to posts.</p>}</div>
        <div className="glassCard railCard"><h3><UserPlus size={18}/>Who to follow</h3>{people.map(p=><div className="personRow" key={p.id}><div className="postAvatar small">{initials(p.full_name)}</div><span><strong>{p.full_name}</strong><small>{p.job_title||p.department}</small></span><button className="miniButton" onClick={()=>void follow(p.id)}>Follow</button></div>)}</div>
        <div className="glassCard railCard socialFeatures"><h3><ShieldCheck size={18}/>Social controls</h3><p><Lock size={14}/>Employee-only visibility</p><p><Megaphone size={14}/>News & announcements</p><p><MessagesSquare size={14}/>Threads & replies</p><p><Hash size={14}/>Hashtags & trends</p><p><AtSign size={14}/>Mentions</p><p><List size={14}/>Lists & communities ready</p></div>
      </aside>
    </div>
    {replyTo&&<div className="socialModal" onClick={()=>setReplyTo(null)}><form className="glassCard replyModal" onSubmit={sendReply} onClick={e=>e.stopPropagation()}><button className="modalClose" type="button" onClick={()=>setReplyTo(null)}><X/></button><span className="eyebrow">REPLYING TO {replyTo.author?.full_name||'POST'}</span><p className="quotedPost">{replyTo.body}</p><textarea autoFocus value={replyBody} onChange={e=>setReplyBody(e.target.value.slice(0,10000))} placeholder="Post your reply"/><button className="primaryButton" disabled={!replyBody.trim()}><Send size={16}/>Reply</button></form></div>}
  </section>
}
