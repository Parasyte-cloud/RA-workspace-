import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type {
  ChangeEvent,
} from 'react'

import {
  Download,
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
  signed_url?:string|null
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

  const [message,setMessage] =
    useState('')

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
                'id,name,description,category,file_name,storage_path,mime_type,file_size,uploaded_by,created_at'
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

                  const {
                    data:signed,
                    error:signedError,
                  } =
                    await supabase!
                      .storage
                      .from(BUCKET)
                      .createSignedUrl(
                        asset.storage_path,
                        60 * 60
                      )

                  return {
                    ...asset,
                    signed_url:
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

          const path =
            `${uploadCategory}/` +
            `${Date.now()}-` +
            `${crypto.randomUUID()}-` +
            cleaned


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
                name:
                  displayName,

                category:
                  uploadCategory,

                file_name:
                  file.name,

                storage_path:
                  path,

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
              Company access
            </strong>

            <span>
              Available to active RideArrivo
              employees.
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

                <div className="brandAssetPreview">

                  {asset.signed_url &&
                   asset.mime_type
                     .startsWith(
                       'image/'
                     )
                    ? (
                      <img
                        src={
                          asset.signed_url
                        }
                        alt={
                          asset.name
                        }
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    )
                    : (
                      <div className="brandAssetFileIcon">
                        <FileText size={36}/>
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

                    <button
                      type="button"
                      onClick={()=>
                        void download(
                          asset
                        )
                      }
                    >
                      <Download size={14}/>
                      Download
                    </button>


                    {asset.signed_url &&
                      <a
                        href={
                          asset.signed_url
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14}/>
                        Open
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
