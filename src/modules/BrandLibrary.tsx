import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  ChangeEvent,
} from 'react'

import {
  ExternalLink,
  FileImage,
  FileText,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react'

import {
  supabase,
} from '../lib/supabase'
import ControlledDownloadButton from '../components/ControlledDownloadButton'
import { createInternalImagePreview, isPreviewableImage } from '../lib/workspacePreviews'

import '../brand-library.css'


const BUCKET =
  'brand-assets'

const MAX_FILE_BYTES =
  20 * 1024 * 1024


const CATEGORIES = [
  {
    value:'all',
    label:'All assets',
  },
  {
    value:'logos',
    label:'Logos',
  },
  {
    value:'brand-guidelines',
    label:'Brand Guidelines',
  },
  {
    value:'templates',
    label:'Templates',
  },
  {
    value:'social-media',
    label:'Social Media',
  },
  {
    value:'photography',
    label:'Photography',
  },
  {
    value:'icons',
    label:'Icons',
  },
  {
    value:'other',
    label:'Other',
  },
] as const


const ALLOWED_TYPES =
  new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
  ])


type BrandAsset = {
  id:string
  name:string
  description:string|null
  category:string
  file_name:string
  storage_path:string
  mime_type:string
  file_size:number
  uploaded_by:string
  created_at:string
  preview_path?:string|null
  preview_url?:string|null
}


function formatBytes(
  value:number
){
  if(
    !Number.isFinite(value) ||
    value <= 0
  ){
    return '0 KB'
  }

  const units = [
    'B',
    'KB',
    'MB',
    'GB',
  ]

  const index =
    Math.min(
      Math.floor(
        Math.log(value) /
        Math.log(1024)
      ),
      units.length - 1
    )

  return `${
    (
      value /
      Math.pow(1024,index)
    ).toFixed(
      index === 0
        ? 0
        : 1
    )
  } ${units[index]}`
}


function categoryLabel(
  value:string
){
  return (
    CATEGORIES.find(
      item=>
        item.value === value
    )?.label ||
    'Other'
  )
}


function safeFileName(
  value:string
){
  return value
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]+/g,
      '-'
    )
    .replace(
      /-+/g,
      '-'
    )
    .replace(
      /^[-.]+|[-.]+$/g,
      ''
    ) || 'asset'
}


export default function BrandLibrary(){

  const [assets,setAssets] =
    useState<BrandAsset[]>([])

  const [loading,setLoading] =
    useState(true)

  const [uploading,setUploading] =
    useState(false)

  const [canManage,setCanManage] =
    useState(false)

  const [isAdmin,setIsAdmin] =
    useState(false)

  const [message,setMessage] =
    useState('')

  const previewBackfillStarted =
    useRef(false)

  const [query,setQuery] =
    useState('')

  const [
    category,
    setCategory,
  ] =
    useState('all')

  const [
    uploadCategory,
    setUploadCategory,
  ] =
    useState('logos')


  const load =
    useCallback(
      async()=>{

        if(!supabase){
          setLoading(false)

          setMessage(
            'Brand Library is unavailable because Supabase is not configured.'
          )

          return
        }

        setLoading(true)
        setMessage('')

        try{

          const {
            data,
            error,
          } =
            await supabase
              .from(
                'brand_assets'
              )
              .select(
                'id,name,description,category,file_name,storage_path,preview_path,mime_type,file_size,uploaded_by,created_at'
              )
              .eq(
                'is_active',
                true
              )
              .order(
                'created_at',
                {
                  ascending:false,
                }
              )
              .overrideTypes<
                BrandAsset[],
                { merge:false }
              >()

          if(error){
            throw error
          }

          const rows =
            data || []

          const resolved =
            await Promise.all(
              rows.map(
                async asset=>{

                  if(!asset.preview_path){
                    return {
                      ...asset,
                      preview_url:null,
                    }
                  }

                  const {
                    data:signed,
                    error:signedError,
                  } =
                    await supabase!
                      .storage
                      .from('workspace-previews')
                      .createSignedUrl(
                        asset.preview_path,
                        15 * 60
                      )

                  return {
                    ...asset,
                    preview_url:
                      signedError
                        ? null
                        : signed?.signedUrl ||
                          null,
                  }
                }
              )
            )

          setAssets(
            resolved
          )

        }catch(error:any){

          console.error(
            'Brand Library load',
            error
          )

          setMessage(
            error?.message ||
            'Unable to load Brand Library.'
          )

        }finally{

          setLoading(false)

        }
      },
      []
    )


  useEffect(
    ()=>{
      void load()
    },
    [load]
  )


  useEffect(
    ()=>{

      const checkPermission =
        async()=>{

          if(!supabase){
            return
          }

          const {
            data:{
              session,
            },
          } =
            await supabase.auth
              .getSession()

          if(
            !session?.user?.id
          ){
            return
          }

          const {
            data,
          } =
            await supabase
              .from(
                'employee_profiles'
              )
              .select(
                'role,active'
              )
              .eq(
                'id',
                session.user.id
              )
              .maybeSingle()

          const role =
            String(
              data?.role || ''
            )
              .trim()
              .toLowerCase()

          setCanManage(
            data?.active === true &&
            (
              role === 'marketing' ||
              role === 'manager' ||
              role === 'admin'
            )
          )

          setIsAdmin(
            data?.active === true &&
            role === 'admin'
          )
        }

      void checkPermission()

    },
    []
  )


  const filtered =
    useMemo(
      ()=>{

        const clean =
          query
            .trim()
            .toLowerCase()

        return assets.filter(
          asset=>{

            if(
              category !== 'all' &&
              asset.category !==
                category
            ){
              return false
            }

            if(!clean){
              return true
            }

            return [
              asset.name,
              asset.description ||
                '',
              asset.file_name,
              categoryLabel(
                asset.category
              ),
            ]
              .join(' ')
              .toLowerCase()
              .includes(clean)
          }
        )
      },
      [
        assets,
        category,
        query,
      ]
    )


  const upload =
    async(
      event:
        ChangeEvent<HTMLInputElement>
    )=>{

      const files =
        Array.from(
          event.target.files ||
          []
        )

      event.target.value=''

      if(
        !files.length ||
        !supabase
      ){
        return
      }

      if(!canManage){

        setMessage(
          'Only Marketing, Managers and Administrators can add Brand Library assets.'
        )

        return
      }


      setUploading(true)
      setMessage('')


      try{

        const {
          data:{
            session,
          },
        } =
          await supabase.auth
            .getSession()

        const userId =
          session?.user?.id

        if(!userId){
          throw new Error(
            'Your workspace session has expired.'
          )
        }


        for(
          const file of files
        ){

          if(
            !ALLOWED_TYPES.has(
              file.type
            )
          ){
            throw new Error(
              `${file.name}: unsupported file type.`
            )
          }

          if(
            file.size >
            MAX_FILE_BYTES
          ){
            throw new Error(
              `${file.name}: file exceeds the 20 MB limit.`
            )
          }


          const cleaned =
            safeFileName(
              file.name
            )

          const assetId = crypto.randomUUID()
          const path =
            `${uploadCategory}/` +
            `${Date.now()}-` +
            `${assetId}-` +
            cleaned

          const previewBlob =
            isPreviewableImage(file)
              ? await createInternalImagePreview(file)
              : null

          const previewPath =
            previewBlob
              ? `brand/${assetId}/preview.webp`
              : null


          const {
            error:
              uploadError,
          } =
            await supabase
              .storage
              .from(BUCKET)
              .upload(
                path,
                file,
                {
                  contentType:
                    file.type,
                  cacheControl:
                    '3600',
                  upsert:false,
                }
              )

          if(uploadError){
            throw uploadError
          }

          if(previewBlob && previewPath){
            const {
              error:previewError,
            } = await supabase
              .storage
              .from('workspace-previews')
              .upload(
                previewPath,
                previewBlob,
                {
                  contentType:'image/webp',
                  cacheControl:'900',
                  upsert:false,
                }
              )

            if(previewError){
              await supabase.storage.from(BUCKET).remove([path])
              throw previewError
            }
          }


          const displayName =
            file.name
              .replace(
                /\.[^.]+$/,
                ''
              )
              .trim() ||
            file.name


          const {
            error:
              metadataError,
          } =
            await supabase
              .from(
                'brand_assets'
              )
              .insert({
                id:
                  assetId,

                name:
                  displayName,

                category:
                  uploadCategory,

                file_name:
                  file.name,

                storage_path:
                  path,

                preview_path:
                  previewPath,

                mime_type:
                  file.type,

                file_size:
                  file.size,

                uploaded_by:
                  userId,
              })


          if(metadataError){

            await supabase
              .storage
              .from(BUCKET)
              .remove([
                path,
              ])

            if(previewPath){
              await supabase
                .storage
                .from('workspace-previews')
                .remove([
                  previewPath,
                ])
            }

            throw metadataError
          }

        }


        setMessage(
          files.length === 1
            ? 'Brand asset uploaded successfully.'
            : `${files.length} brand assets uploaded successfully.`
        )

        await load()

      }catch(error:any){

        console.error(
          'Brand Library upload',
          error
        )

        setMessage(
          error?.message ||
          'Unable to upload brand asset.'
        )

      }finally{

        setUploading(false)

      }
    }


  const buildMissingPreviews =
    async(silent=false)=>{
      if(!supabase || !isAdmin){
        return
      }

      const missing = assets.filter(
        asset=>
          asset.mime_type.startsWith('image/') &&
          !asset.preview_path
      )

      if(!missing.length){
        if(!silent){
          setMessage('All image assets already have internal previews.')
        }
        return
      }

      setUploading(true)
      if(!silent){
        setMessage('')
      }

      try{
        for(const asset of missing){
          const {data:blob,error:downloadError}=await supabase
            .storage
            .from(BUCKET)
            .download(asset.storage_path)

          if(downloadError) throw downloadError

          const source = new File(
            [blob],
            asset.file_name,
            {type:asset.mime_type}
          )

          const preview = await createInternalImagePreview(source)
          if(!preview) continue

          const previewPath = `brand/${asset.id}/preview.webp`
          const {error:previewError}=await supabase
            .storage
            .from('workspace-previews')
            .upload(previewPath,preview,{
              upsert:true,
              contentType:'image/webp',
              cacheControl:'900',
            })

          if(previewError) throw previewError

          const {error:updateError}=await supabase
            .from('brand_assets')
            .update({preview_path:previewPath})
            .eq('id',asset.id)

          if(updateError) throw updateError
        }

        if(!silent){
          setMessage('Missing image previews generated. Originals remain protected.')
        }
        await load()
      }catch(error:any){
        if(!silent){
          setMessage(error?.message || 'Unable to generate missing previews.')
        }else{
          console.error('Brand preview backfill',error)
        }
      }finally{
        setUploading(false)
      }
    }


  useEffect(()=>{
    if(
      !isAdmin ||
      loading ||
      uploading ||
      previewBackfillStarted.current ||
      !assets.some(asset=>asset.mime_type.startsWith('image/') && !asset.preview_path)
    ){
      return
    }

    previewBackfillStarted.current=true
    void buildMissingPreviews(true)
  },[assets,isAdmin,loading,uploading])


  const download =
    async(
      asset:BrandAsset
    )=>{

      if(!supabase){
        return
      }

      setMessage('')

      try{

        const {
          data,
          error,
        } =
          await supabase
            .storage
            .from(BUCKET)
            .download(
              asset.storage_path
            )

        if(error){
          throw error
        }

        const url =
          URL.createObjectURL(
            data
          )

        const anchor =
          document
            .createElement('a')

        anchor.href=url

        anchor.download=
          asset.file_name

        document.body
          .appendChild(anchor)

        anchor.click()
        anchor.remove()

        window.setTimeout(
          ()=>{
            URL.revokeObjectURL(
              url
            )
          },
          1000
        )

      }catch(error:any){

        setMessage(
          error?.message ||
          'Unable to download this asset.'
        )
      }
    }


  return (
    <section className="brandLibrary">

      <div className="brandLibraryHero">

        <div>

          <span className="eyebrow">
            RIDEARRIVO BRAND CENTRE
          </span>

          <h2>
            Brand Library
          </h2>

          <p>
            Approved logos, visual assets,
            templates, photography and brand
            reference material for everyone
            across RideArrivo.
          </p>

        </div>


        <div className="brandLibrarySecurity">

          <ShieldCheck size={18}/>

          <div>
            <strong>
              Governed access
            </strong>

            <span>
              Metadata is visible to employees; original files require administrator download approval.
            </span>
          </div>

        </div>

      </div>


      <div className="brandLibraryToolbar">

        <label className="brandLibrarySearch">

          <Search size={17}/>

          <input
            value={query}
            onChange={event=>
              setQuery(
                event.target.value
              )
            }
            placeholder="Search logos, templates and brand assets..."
          />

        </label>


        {isAdmin && assets.some(asset=>asset.mime_type.startsWith('image/') && !asset.preview_path) &&
          <button
            type="button"
            className="glassButton"
            disabled={uploading}
            onClick={()=>void buildMissingPreviews()}
          >
            <FileImage size={16}/>
            Build missing previews
          </button>
        }

        {canManage &&
          <div className="brandLibraryUpload">

            <select
              value={
                uploadCategory
              }
              onChange={event=>
                setUploadCategory(
                  event.target.value
                )
              }
              aria-label="Upload category"
            >
              {CATEGORIES
                .filter(
                  item=>
                    item.value !==
                    'all'
                )
                .map(
                  item=>
                    <option
                      key={
                        item.value
                      }
                      value={
                        item.value
                      }
                    >
                      {item.label}
                    </option>
                )
              }
            </select>


            <label
              className={
                `brandLibraryUploadButton ${
                  uploading
                    ? 'disabled'
                    : ''
                }`
              }
            >

              <Upload size={16}/>

              {uploading
                ? 'Uploading...'
                : 'Upload assets'
              }

              <input
                hidden
                type="file"
                multiple
                disabled={
                  uploading
                }
                accept="
                  image/png,
                  image/jpeg,
                  image/webp,
                  image/svg+xml,
                  application/pdf
                "
                onChange={
                  event=>
                    void upload(
                      event
                    )
                }
              />

            </label>

          </div>
        }

      </div>


      <div className="brandLibraryCategories">

        {CATEGORIES.map(
          item=>
            <button
              key={item.value}
              type="button"
              className={
                category ===
                item.value
                  ? 'active'
                  : ''
              }
              onClick={()=>
                setCategory(
                  item.value
                )
              }
            >
              {item.label}
            </button>
        )}

      </div>


      {message &&
        <div className="brandLibraryNotice">
          {message}
        </div>
      }


      <div className="brandLibraryCount">

        <strong>
          {filtered.length}
        </strong>

        <span>
          {filtered.length === 1
            ? 'asset'
            : 'assets'
          }
        </span>

      </div>


      {loading ? (

        <div className="brandLibraryEmpty">
          Loading Brand Library...
        </div>

      ) : filtered.length === 0 ? (

        <div className="brandLibraryEmpty">

          <FileImage size={34}/>

          <strong>
            No brand assets found
          </strong>

          <span>
            Approved RideArrivo assets will
            appear here.
          </span>

        </div>

      ) : (

        <div className="brandLibraryGrid">

          {filtered.map(
            asset=>
              <article
                key={asset.id}
                className="brandAssetCard"
              >

                <div className="brandAssetPreview" onContextMenu={event=>event.preventDefault()} title="Internal preview. Original download requires approval.">

                  {asset.mime_type.startsWith('image/')
                    ? asset.preview_url
                      ? (
                        <img
                          src={asset.preview_url}
                          alt={asset.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          draggable={false}
                        />
                      )
                      : (
                        <div className="brandAssetPreviewPending">
                          <FileImage size={34}/>
                          <strong>Preview preparing</strong>
                          <span>The protected original is not exposed.</span>
                        </div>
                      )
                    : (
                      <div className="brandAssetDocumentPreview">
                        <FileText size={36}/>
                        <strong>{asset.mime_type==='application/pdf'?'PDF document':'Brand file'}</strong>
                        <span>{asset.file_name}</span>
                      </div>
                    )
                  }

                </div>


                <div className="brandAssetBody">

                  <span className="brandAssetCategory">
                    {categoryLabel(
                      asset.category
                    )}
                  </span>

                  <h3>
                    {asset.name}
                  </h3>

                  {asset.description &&
                    <p>
                      {asset.description}
                    </p>
                  }


                  <div className="brandAssetMeta">

                    <span>
                      {formatBytes(
                        asset.file_size
                      )}
                    </span>

                    <span>
                      {new Date(
                        asset.created_at
                      ).toLocaleDateString(
                        'en-NG'
                      )}
                    </span>

                  </div>


                  <div className="brandAssetActions">

                    <ControlledDownloadButton
                      compact
                      className="glassButton"
                      resource={{
                        resourceType:'brand_asset',
                        resourceKey:asset.id,
                        resourceName:asset.name
                      }}
                      label="Download"
                      onGranted={()=>download(asset)}
                    />


                    {asset.preview_url &&
                      <a
                        href={
                          asset.preview_url
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14}/>
                        Open preview
                      </a>
                    }

                  </div>

                </div>

              </article>
          )}

        </div>

      )}

    </section>
  )
}
