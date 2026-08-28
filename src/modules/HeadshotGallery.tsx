import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import {
  FileUp,
  Images,
  Share2,
  Trash2,
  X
} from 'lucide-react'

import { supabase } from '../lib/supabase'

import '../headshot-gallery.css'

const BUCKET='employee-headshots'
const MAX_BYTES=5*1024*1024

type HeadshotRow={
  id:string
  employee_id:string
  storage_path:string
  original_name:string|null
  mime_type:string
  file_size:number
  created_at:string
}

type Employee={
  id:string
  full_name:string
  email:string
  department:string|null
  job_title:string|null
}

type GalleryItem=
  HeadshotRow & {
    url:string|null
    employee?:Employee
  }

function formatDate(value:string){
  return new Intl.DateTimeFormat(
    'en',
    {
      day:'numeric',
      month:'short',
      year:'numeric'
    }
  ).format(new Date(value))
}

function extensionFor(file:File){
  switch(file.type){
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return ''
  }
}

export function HeadshotGallery(){

  const [items,setItems]=
    useState<GalleryItem[]>([])

  const [userId,setUserId]=
    useState('')

  const [loading,setLoading]=
    useState(true)

  const [uploading,setUploading]=
    useState(false)

  const [message,setMessage]=
    useState('')

  const [selected,setSelected]=
    useState<GalleryItem|null>(null)

  const inputRef=
    useRef<HTMLInputElement|null>(null)


  const load=
    useCallback(async()=>{

      const client=supabase

      if(!client){
        setLoading(false)
        setMessage(
          'Headshot gallery is unavailable.'
        )
        return
      }

      setLoading(true)

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
          throw new Error(
            'Your session has expired.'
          )
        }

        setUserId(user.id)

        const {
          data:rows,
          error:rowsError
        }=
          await client
            .from('employee_headshots')
            .select(
              'id,employee_id,storage_path,original_name,mime_type,file_size,created_at'
            )
            .order(
              'created_at',
              {
                ascending:false
              }
            )

        if(rowsError){
          throw rowsError
        }

        const headshots=
          (rows || []) as HeadshotRow[]

        const employeeIds=
          [
            ...new Set(
              headshots.map(
                item=>item.employee_id
              )
            )
          ]

        let employees:Employee[]=[]

        if(employeeIds.length){

          const {
            data:employeeRows,
            error:employeeError
          }=
            await client
              .from('employee_profiles')
              .select(
                'id,full_name,email,department,job_title'
              )
              .in(
                'id',
                employeeIds
              )

          if(employeeError){
            throw employeeError
          }

          employees=
            (employeeRows || []) as Employee[]
        }

        const employeeMap=
          new Map(
            employees.map(
              employee=>[
                employee.id,
                employee
              ]
            )
          )

        const paths=
          headshots.map(
            item=>item.storage_path
          )

        const signedMap=
          new Map<string,string>()

        if(paths.length){

          const {
            data:signed,
            error:signedError
          }=
            await client
              .storage
              .from(BUCKET)
              .createSignedUrls(
                paths,
                3600
              )

          if(signedError){
            throw signedError
          }

          for(
            const result
            of signed || []
          ){

            if(
              result.path
              && result.signedUrl
            ){
              signedMap.set(
                result.path,
                result.signedUrl
              )
            }

          }

        }

        setItems(
          headshots.map(
            item=>({
              ...item,
              url:
                signedMap.get(
                  item.storage_path
                ) || null,
              employee:
                employeeMap.get(
                  item.employee_id
                )
            })
          )
        )

        setMessage('')

      }catch(error){

        console.error(
          'Headshot gallery load failed:',
          error
        )

        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load headshots.'
        )

      }finally{

        setLoading(false)

      }

    },[])


  useEffect(()=>{

    void load()

    const client=supabase

    if(!client){
      return
    }

    const channel=
      client
        .channel(
          'employee-headshot-gallery'
        )
        .on(
          'postgres_changes',
          {
            event:'*',
            schema:'public',
            table:'employee_headshots'
          },
          ()=>{
            void load()
          }
        )
        .subscribe()

    return ()=>{

      void client.removeChannel(
        channel
      )

    }

  },[load])


  const upload=
    async(
      event:
        React.ChangeEvent<HTMLInputElement>
    )=>{

      const files=
        Array.from(
          event.target.files || []
        )

      event.target.value=''

      if(!files.length){
        return
      }

      const client=supabase

      if(!client){
        return
      }

      setUploading(true)
      setMessage('')

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
          throw new Error(
            'Your session has expired.'
          )
        }

        if(files.length>8){
          throw new Error(
            'Upload a maximum of 8 headshots at once.'
          )
        }

        for(const file of files){

          const extension=
            extensionFor(file)

          if(!extension){
            throw new Error(
              `${file.name}: use JPG, PNG or WEBP only.`
            )
          }

          if(file.size>MAX_BYTES){
            throw new Error(
              `${file.name}: maximum file size is 5 MB.`
            )
          }

          const storagePath=
            [
              user.id,
              `${crypto.randomUUID()}.${extension}`
            ].join('/')

          const {
            error:uploadError
          }=
            await client
              .storage
              .from(BUCKET)
              .upload(
                storagePath,
                file,
                {
                  upsert:false,
                  contentType:file.type,
                  cacheControl:'3600'
                }
              )

          if(uploadError){
            throw uploadError
          }

          const {
            error:insertError
          }=
            await client
              .from('employee_headshots')
              .insert({
                employee_id:user.id,
                storage_path:storagePath,
                original_name:file.name,
                mime_type:file.type,
                file_size:file.size
              })

          if(insertError){

            await client
              .storage
              .from(BUCKET)
              .remove([
                storagePath
              ])

            throw insertError

          }

        }

        setMessage(
          files.length===1
            ? 'Headshot uploaded.'
            : `${files.length} headshots uploaded.`
        )

        await load()

      }catch(error){

        console.error(
          'Headshot upload failed:',
          error
        )

        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to upload headshot.'
        )

      }finally{

        setUploading(false)

      }

    }


  const share=
    async(item:GalleryItem)=>{

      const client=supabase

      if(!client){
        return
      }

      setMessage('')

      try{

        const {
          data,
          error
        }=
          await client
            .storage
            .from(BUCKET)
            .createSignedUrl(
              item.storage_path,
              3600
            )

        if(error){
          throw error
        }

        if(!data?.signedUrl){
          throw new Error(
            'Unable to create share link.'
          )
        }

        const title=
          `${item.employee?.full_name || 'RideArrivo employee'} headshot`

        if(navigator.share){

          try{

            await navigator.share({
              title,
              text:
                'RideArrivo employee headshot',
              url:data.signedUrl
            })

            return

          }catch(error){

            if(
              error instanceof DOMException
              && error.name==='AbortError'
            ){
              return
            }

          }

        }

        await navigator.clipboard.writeText(
          data.signedUrl
        )

        setMessage(
          'Temporary 1-hour share link copied.'
        )

      }catch(error){

        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to share headshot.'
        )

      }

    }


  const remove=
    async(item:GalleryItem)=>{

      if(
        !userId
        || item.employee_id!==userId
      ){
        return
      }

      if(
        !window.confirm(
          'Delete this headshot from the gallery?'
        )
      ){
        return
      }

      const client=supabase

      if(!client){
        return
      }

      setMessage('')

      try{

        const {
          error:rowError
        }=
          await client
            .from('employee_headshots')
            .delete()
            .eq(
              'id',
              item.id
            )

        if(rowError){
          throw rowError
        }

        const {
          error:fileError
        }=
          await client
            .storage
            .from(BUCKET)
            .remove([
              item.storage_path
            ])

        if(fileError){
          console.warn(
            'Headshot row removed but file cleanup failed:',
            fileError.message
          )
        }

        if(selected?.id===item.id){
          setSelected(null)
        }

        setMessage(
          'Headshot deleted.'
        )

        await load()

      }catch(error){

        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to delete headshot.'
        )

      }

    }


  return (
    <section className="headshotGallery">

      <div className="headshotGalleryHero">

        <div>

          <span className="eyebrow">
            PEOPLE · BRAND ASSETS
          </span>

          <h2>
            Employee Headshot Gallery
          </h2>

          <p>
            A secure company gallery for professional
            employee headshots. Each employee can upload
            only to their own collection.
          </p>

        </div>

        <div className="headshotGalleryActions">

          <input
            ref={inputRef}
            hidden
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={event=>{
              void upload(event)
            }}
          />

          <button
            className="primaryButton"
            type="button"
            disabled={uploading}
            onClick={()=>{
              inputRef.current?.click()
            }}
          >
            <FileUp size={17}/>

            {uploading
              ? 'Uploading...'
              : 'Upload headshots'
            }
          </button>

        </div>

      </div>


      <div className="headshotPolicy">

        <Images size={18}/>

        <span>
          Professional headshots only · JPG, PNG or WEBP
          · maximum 5 MB each · private RideArrivo storage
        </span>

      </div>


      {message &&
        <div className="moduleNotice">
          {message}
        </div>
      }


      {loading
        ? (
          <div className="headshotEmpty glassCard">
            Loading company headshots...
          </div>
        )
        : items.length===0
          ? (
            <div className="headshotEmpty glassCard">

              <Images size={28}/>

              <strong>
                No company headshots yet
              </strong>

              <span>
                Upload the first professional headshot.
              </span>

            </div>
          )
          : (
            <div className="headshotGrid">

              {items.map(item=>(

                <article
                  className="headshotCard"
                  key={item.id}
                >

                  <button
                    type="button"
                    className="headshotPreview"
                    onClick={()=>{
                      setSelected(item)
                    }}
                  >

                    {item.url
                      ? (
                        <img
                          src={item.url}
                          alt={
                            `${item.employee?.full_name || 'Employee'} headshot`
                          }
                        />
                      )
                      : (
                        <span>
                          Image unavailable
                        </span>
                      )
                    }

                  </button>


                  <div className="headshotInfo">

                    <strong>
                      {item.employee?.full_name ||
                        'RideArrivo employee'}
                    </strong>

                    <span>
                      {item.employee?.job_title ||
                        item.employee?.department ||
                        'Employee'}
                    </span>

                    <small>
                      Uploaded {formatDate(item.created_at)}
                    </small>

                  </div>


                  <div className="headshotCardActions">

                    <button
                      type="button"
                      onClick={()=>{
                        void share(item)
                      }}
                      title="Share headshot"
                    >
                      <Share2 size={16}/>
                      Share
                    </button>

                    {item.employee_id===userId &&
                      <button
                        type="button"
                        className="danger"
                        onClick={()=>{
                          void remove(item)
                        }}
                        title="Delete your headshot"
                      >
                        <Trash2 size={16}/>
                      </button>
                    }

                  </div>

                </article>

              ))}

            </div>
          )
      }


      {selected &&
        <div
          className="headshotModal"
          role="dialog"
          aria-modal="true"
        >

          <button
            type="button"
            className="headshotModalClose"
            onClick={()=>{
              setSelected(null)
            }}
            aria-label="Close headshot"
          >
            <X size={20}/>
          </button>

          <div className="headshotModalBody">

            {selected.url &&
              <img
                src={selected.url}
                alt={
                  `${selected.employee?.full_name || 'Employee'} headshot`
                }
              />
            }

            <div>

              <strong>
                {selected.employee?.full_name ||
                  'RideArrivo employee'}
              </strong>

              <span>
                {selected.employee?.job_title ||
                  selected.employee?.department ||
                  'Employee'}
              </span>

              <button
                type="button"
                className="primaryButton"
                onClick={()=>{
                  void share(selected)
                }}
              >
                <Share2 size={16}/>
                Share headshot
              </button>

            </div>

          </div>

        </div>
      }

    </section>
  )
}
