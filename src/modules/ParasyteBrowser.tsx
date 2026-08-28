import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Home,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2
} from 'lucide-react'

import {
  supabase
} from '../lib/supabase'

import '../parasyte.css'


const HOME =
  'parasyte://home'


type ManagedLink={
  id:string
  title:string
  url:string
  category:string
}

type Bookmark={
  id:string
  title:string
  url:string
}


const externalOnlyHosts=[
  'google.com',
  'www.google.com',
  'accounts.google.com',

  'github.com',

  'supabase.com',
  'dashboard.render.com',

  'facebook.com',
  'www.facebook.com',
  'business.facebook.com',

  'linkedin.com',
  'www.linkedin.com',

  'mail.zoho.com',

  'web.whatsapp.com',

  'canva.com',
  'www.canva.com',

  'analytics.google.com',

  'search.google.com',

  'dash.cloudflare.com',

  'ibank.providusbank.com'
]


function safeHttpUrl(
  value:string
){

  try{

    const url=
      new URL(value)

    if(
      url.protocol!=='http:'
      && url.protocol!=='https:'
    ){
      return null
    }

    return url

  }catch{

    return null

  }

}


function resolveInput(
  raw:string
){

  const value=
    raw.trim()

  if(!value){
    return HOME
  }


  if(
    /^https?:\/\//i.test(
      value
    )
  ){

    const parsed=
      safeHttpUrl(value)

    return parsed
      ? parsed.toString()
      : HOME

  }


  if(
    !value.includes(' ')
    && value.includes('.')
  ){

    const parsed=
      safeHttpUrl(
        `https://${value}`
      )

    return parsed
      ? parsed.toString()
      : HOME

  }


  return (
    'https://www.google.com/search?q='
    + encodeURIComponent(
        value
      )
  )

}


function externalOnly(
  value:string
){

  const parsed=
    safeHttpUrl(value)

  if(!parsed){
    return false
  }

  const hostname=
    parsed.hostname.toLowerCase()

  return externalOnlyHosts.some(
    host=>
      hostname===host
      ||
      hostname.endsWith(
        `.${host}`
      )
  )

}


function displayAddress(
  value:string
){

  if(value===HOME){
    return ''
  }

  return value

}


export default function ParasyteBrowser({
  initialUrl
}:{
  initialUrl?:string
}){

  const [current,setCurrent]=
    useState(HOME)

  const [address,setAddress]=
    useState('')

  const [history,setHistory]=
    useState<string[]>([
      HOME
    ])

  const [historyIndex,setHistoryIndex]=
    useState(0)

  const [reloadKey,setReloadKey]=
    useState(0)

  const [managed,setManaged]=
    useState<ManagedLink[]>([])

  const [bookmarks,setBookmarks]=
    useState<Bookmark[]>([])

  const [userId,setUserId]=
    useState('')

  const [message,setMessage]=
    useState('')


  const loadLinks=
    useCallback(
      async()=>{

        const client=supabase

        if(!client){
          return
        }

        try{

          const {
            data:{
              user
            },
            error:userError
          }=
            await client.auth.getUser()

          if(userError){
            throw userError
          }

          if(!user){
            return
          }

          setUserId(
            user.id
          )


          const [
            managedResult,
            bookmarkResult
          ]=
            await Promise.all([

              client
                .from(
                  'parasyte_managed_links'
                )
                .select(
                  'id,title,url,category'
                )
                .eq(
                  'active',
                  true
                )
                .order(
                  'sort_order'
                ),

              client
                .from(
                  'parasyte_bookmarks'
                )
                .select(
                  'id,title,url'
                )
                .eq(
                  'user_id',
                  user.id
                )
                .order(
                  'created_at',
                  {
                    ascending:false
                  }
                )

            ])


          if(
            managedResult.error
          ){
            throw managedResult.error
          }

          if(
            bookmarkResult.error
          ){
            throw bookmarkResult.error
          }

          setManaged(
            (
              managedResult.data
              || []
            ) as ManagedLink[]
          )

          setBookmarks(
            (
              bookmarkResult.data
              || []
            ) as Bookmark[]
          )


        }catch(error){

          console.error(
            'PArAsYtE links:',
            error
          )

          setMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load browser links.'
          )

        }

      },
      []
    )


  useEffect(()=>{

    void loadLinks()

  },[
    loadLinks
  ])


  const navigate=
    useCallback(
      (
        value:string,
        push=true
      )=>{

        const resolved=
          value===HOME
            ? HOME
            : resolveInput(
                value
              )

        setCurrent(
          resolved
        )

        setAddress(
          displayAddress(
            resolved
          )
        )

        setMessage('')


        if(!push){
          return
        }


        setHistory(
          previous=>{

            const base=
              previous.slice(
                0,
                historyIndex+1
              )

            const next=[
              ...base,
              resolved
            ]

            setHistoryIndex(
              next.length-1
            )

            return next

          }
        )

      },
      [
        historyIndex
      ]
    )


  useEffect(()=>{

    if(
      initialUrl
      && initialUrl.trim()
    ){

      navigate(
        initialUrl
      )

    }

  },[
    initialUrl
  ])


  const submit=
    (
      event:FormEvent
    )=>{

      event.preventDefault()

      navigate(
        address
      )

    }


  const goBack=()=>{

    if(historyIndex<=0){
      return
    }

    const nextIndex=
      historyIndex-1

    setHistoryIndex(
      nextIndex
    )

    navigate(
      history[nextIndex],
      false
    )

  }


  const goForward=()=>{

    if(
      historyIndex
      >= history.length-1
    ){
      return
    }

    const nextIndex=
      historyIndex+1

    setHistoryIndex(
      nextIndex
    )

    navigate(
      history[nextIndex],
      false
    )

  }


  const goHome=()=>{

    navigate(
      HOME
    )

  }


  const openExternal=()=>{

    if(current===HOME){
      return
    }

    const parsed=
      safeHttpUrl(current)

    if(!parsed){
      return
    }

    window.open(
      parsed.toString(),
      '_blank',
      'noopener,noreferrer'
    )

  }


  const saveBookmark=
    async()=>{

      const client=supabase

      if(
        !client
        || !userId
        || current===HOME
      ){
        return
      }

      const parsed=
        safeHttpUrl(current)

      if(!parsed){
        return
      }

      const title=
        parsed.hostname

      const {
        error
      }=
        await client
          .from(
            'parasyte_bookmarks'
          )
          .upsert(
            {
              user_id:
                userId,

              title,

              url:
                parsed.toString()
            },
            {
              onConflict:
                'user_id,url'
            }
          )

      if(error){

        setMessage(
          error.message
        )

        return
      }

      setMessage(
        'Bookmark saved.'
      )

      await loadLinks()

  }


  const removeBookmark=
    async(
      bookmarkId:string
    )=>{

      const client=supabase

      if(!client){
        return
      }

      const {
        error
      }=
        await client
          .from(
            'parasyte_bookmarks'
          )
          .delete()
          .eq(
            'id',
            bookmarkId
          )

      if(error){

        setMessage(
          error.message
        )

        return
      }

      await loadLinks()

  }


  const categories=
    useMemo(
      ()=>{

        const grouped=
          new Map<
            string,
            ManagedLink[]
          >()

        for(
          const link
          of managed
        ){

          const list=
            grouped.get(
              link.category
            ) || []

          list.push(link)

          grouped.set(
            link.category,
            list
          )

        }

        return [
          ...grouped.entries()
        ]

      },
      [
        managed
      ]
    )


  const currentExternalOnly=
    current!==HOME
    && externalOnly(
      current
    )


  return (
    <section className="parasyteBrowser">

      <div className="parasyteChrome">

        <div className="parasyteBrand">

          <img
            src="/parasyte-logo.png"
            alt="PArAsYtE"
          />

          <span>

            <strong>
              PArAsYtE
            </strong>

            <small>
              RideArrivo browser
            </small>

          </span>

        </div>


        <div className="parasyteNavButtons">

          <button
            type="button"
            disabled={
              historyIndex<=0
            }
            onClick={goBack}
            title="Back"
          >
            <ArrowLeft size={16}/>
          </button>

          <button
            type="button"
            disabled={
              historyIndex
              >= history.length-1
            }
            onClick={goForward}
            title="Forward"
          >
            <ArrowRight size={16}/>
          </button>

          <button
            type="button"
            onClick={()=>{
              setReloadKey(
                value=>
                  value+1
              )
            }}
            title="Reload"
          >
            <RefreshCw size={16}/>
          </button>

          <button
            type="button"
            onClick={goHome}
            title="Home"
          >
            <Home size={16}/>
          </button>

        </div>


        <form
          className="parasyteOmnibox"
          onSubmit={submit}
        >

          <ShieldCheck size={15}/>

          <input
            value={address}
            placeholder="Search Google or enter a web address"
            onChange={event=>{
              setAddress(
                event.target.value
              )
            }}
          />

          <button
            type="submit"
            title="Go"
          >
            <Search size={16}/>
          </button>

        </form>


        <div className="parasyteActions">

          <button
            type="button"
            disabled={
              current===HOME
            }
            onClick={()=>{
              void saveBookmark()
            }}
            title="Bookmark"
          >
            <Star size={16}/>
          </button>

          <button
            type="button"
            disabled={
              current===HOME
            }
            onClick={openExternal}
            title="Open in external browser"
          >
            <ExternalLink size={16}/>
          </button>

        </div>

      </div>


      {message &&
        <div className="moduleNotice">
          {message}
        </div>
      }


      <div className="parasyteBody">

        <aside className="parasyteSidebar">

          <div className="parasyteSidebarTitle">
            Managed
          </div>


          {categories.map(
            ([
              category,
              links
            ])=>(

              <div
                className="parasyteLinkGroup"
                key={category}
              >

                <small>
                  {category}
                </small>

                {links.map(link=>(

                  <button
                    type="button"
                    key={link.id}
                    onClick={()=>{
                      navigate(
                        link.url
                      )
                    }}
                  >
                    <Globe2 size={14}/>

                    <span>
                      {link.title}
                    </span>
                  </button>

                ))}

              </div>

            )
          )}


          <div className="parasyteSidebarTitle personal">
            My bookmarks
          </div>


          {bookmarks.map(
            bookmark=>(

              <div
                className="parasyteBookmark"
                key={bookmark.id}
              >

                <button
                  type="button"
                  onClick={()=>{
                    navigate(
                      bookmark.url
                    )
                  }}
                >
                  <Star size={13}/>
                  <span>
                    {bookmark.title}
                  </span>
                </button>

                <button
                  type="button"
                  className="remove"
                  onClick={()=>{
                    void removeBookmark(
                      bookmark.id
                    )
                  }}
                  title="Remove bookmark"
                >
                  <Trash2 size={12}/>
                </button>

              </div>

            )
          )}


          {bookmarks.length===0 &&
            <span className="parasyteNoBookmarks">
              No bookmarks yet.
            </span>
          }

        </aside>


        <main className="parasyteViewport">

          {current===HOME
            ? (
              <div className="parasyteHome">

                <img
                  src="/parasyte-logo.png"
                  alt=""
                />

                <span className="eyebrow">
                  RIDEARRIVO INTERNAL BROWSER
                </span>

                <h2>
                  PArAsYtE
                </h2>

                <p>
                  Search the web or launch your
                  authorised RideArrivo work tools.
                </p>


                <form
                  className="parasyteHomeSearch"
                  onSubmit={submit}
                >

                  <Search size={20}/>

                  <input
                    value={address}
                    placeholder="Search Google"
                    onChange={event=>{
                      setAddress(
                        event.target.value
                      )
                    }}
                  />

                  <button
                    type="submit"
                  >
                    Search
                  </button>

                </form>


                <div className="parasyteHomeLinks">

                  {managed
                    .slice(0,8)
                    .map(link=>(

                      <button
                        type="button"
                        key={link.id}
                        onClick={()=>{
                          navigate(
                            link.url
                          )
                        }}
                      >

                        <Globe2 size={17}/>

                        <span>
                          {link.title}
                        </span>

                      </button>

                    ))
                  }

                </div>

              </div>
            )

            : currentExternalOnly
              ? (
                <div className="parasyteExternalNotice">

                  <img
                    src="/parasyte-logo.png"
                    alt=""
                  />

                  <ShieldCheck size={28}/>

                  <h3>
                    Secure external launch required
                  </h3>

                  <p>
                    This website does not permit secure
                    embedding inside another web
                    application. PArAsYtE will not bypass
                    the site's browser security policy.
                  </p>

                  <code>
                    {current}
                  </code>

                  <button
                    type="button"
                    onClick={openExternal}
                  >
                    <ExternalLink size={16}/>
                    Open secure tab
                  </button>

                </div>
              )

              : (
                <iframe
                  key={
                    `${current}-${reloadKey}`
                  }
                  title="PArAsYtE browser view"
                  src={current}
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="
                    allow-forms
                    allow-scripts
                    allow-popups
                    allow-popups-to-escape-sandbox
                    allow-downloads
                  "
                />
              )
          }

        </main>

      </div>

    </section>
  )
}
