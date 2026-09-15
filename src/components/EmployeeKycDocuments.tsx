import {
  useCallback,
  useEffect,
  useState
} from 'react'

import type {
  ChangeEvent
} from 'react'

import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Trash2,
  UploadCloud
} from 'lucide-react'

import { supabase } from '../lib/supabase'

type DocumentType =
  | 'means_of_identification'
  | 'home_address_proof'
  | 'account_details_form'
  | 'guarantors_form'
  | 'reference_letters'

type KycDocumentRow = {
  id:string
  document_type:DocumentType
  storage_path:string
  original_filename:string
  file_size:number
  content_type:string|null
  created_at:string
}

const MAX_FILES_PER_TYPE = 3
const MAX_FILE_BYTES = 10*1024*1024
const BUCKET = 'employee-kyc-documents'

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg'
]

const SLOTS:{
  type:DocumentType
  label:string
  description:string
}[] = [
  {
    type:'means_of_identification',
    label:'Means of Identification',
    description:'NIN or International Passport'
  },
  {
    type:'home_address_proof',
    label:'Proof of Home Address',
    description:'Utility bill, tenancy agreement or similar'
  },
  {
    type:'account_details_form',
    label:'Account Details Form',
    description:'Account Number, Account Name and SWIFT Code'
  },
  {
    type:'guarantors_form',
    label:"Guarantor's Form",
    description:'Completed and signed guarantor form'
  },
  {
    type:'reference_letters',
    label:'Reference Letters',
    description:'One or more reference letters'
  }
]

function formatSize(bytes:number){
  if(!bytes) return '0 KB'
  if(bytes < 1024*1024){
    return `${Math.max(1,Math.round(bytes/1024))} KB`
  }
  return `${(bytes/(1024*1024)).toFixed(1)} MB`
}

export default function EmployeeKycDocuments(){
  const [userId,setUserId]=useState('')
  const [documents,setDocuments]=
    useState<KycDocumentRow[]>([])
  const [loading,setLoading]=useState(true)
  const [uploadingType,setUploadingType]=
    useState<DocumentType|''>('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')

  const load=useCallback(async ()=>{
    if(!supabase) return

    setLoading(true)
    setError('')

    try{
      const {
        data:{user}
      }=await supabase.auth.getUser()

      if(!user){
        throw new Error('Authentication required.')
      }

      setUserId(user.id)

      const {data,error:loadError}=
        await supabase
          .from('employee_kyc_documents')
          .select(
            'id,document_type,storage_path,original_filename,file_size,content_type,created_at'
          )
          .eq('employee_id',user.id)
          .order('created_at',{ascending:true})

      if(loadError) throw loadError

      setDocuments((data || []) as KycDocumentRow[])
    }catch(err:any){
      setError(
        err?.message ||
        'Unable to load your documents.'
      )
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{
    void load()
  },[load])

  async function handleUpload(
    documentType:DocumentType,
    event:ChangeEvent<HTMLInputElement>
  ){
    const files=Array.from(
      event.target.files || []
    )

    event.target.value=''

    if(!files.length || !supabase || !userId) return

    setError('')
    setNotice('')

    const existingCount=documents.filter(
      doc=>doc.document_type===documentType
    ).length

    const remaining=
      MAX_FILES_PER_TYPE - existingCount

    if(remaining <= 0){
      setError(
        `You've already uploaded the maximum of ${MAX_FILES_PER_TYPE} files for this document. Delete one before uploading another.`
      )
      return
    }

    const toUpload=files.slice(0,remaining)
    const skipped=files.length - toUpload.length

    setUploadingType(documentType)

    let uploaded=0
    let failedFiles:string[]=[]

    for(const file of toUpload){
      if(!ALLOWED_MIME_TYPES.includes(file.type)){
        failedFiles.push(
          `${file.name} (use PDF, PNG or JPG)`
        )
        continue
      }

      if(file.size > MAX_FILE_BYTES){
        failedFiles.push(
          `${file.name} (must be 10MB or smaller)`
        )
        continue
      }

      const safeName=
        file.name
          .replace(/[^a-zA-Z0-9._-]/g,'_')
          .slice(-120)

      const path=
        `${userId}/${documentType}/${crypto.randomUUID()}-${safeName}`

      try{
        const {error:uploadError}=
          await supabase.storage
            .from(BUCKET)
            .upload(
              path,
              file,
              {
                upsert:false,
                contentType:file.type
              }
            )

        if(uploadError) throw uploadError

        const {error:insertError}=
          await supabase
            .from('employee_kyc_documents')
            .insert({
              employee_id:userId,
              document_type:documentType,
              storage_path:path,
              original_filename:file.name,
              file_size:file.size,
              content_type:file.type,
              uploaded_by:userId
            })

        if(insertError){
          await supabase.storage
            .from(BUCKET)
            .remove([path])

          throw insertError
        }

        uploaded += 1
      }catch(err:any){
        failedFiles.push(
          `${file.name} (${err?.message || 'upload failed'})`
        )
      }
    }

    setUploadingType('')

    if(uploaded){
      setNotice(
        `${uploaded} file${uploaded===1 ? '' : 's'} uploaded.`
      )
      await load()
    }

    const problems=[
      ...failedFiles,
      ...(skipped
        ? [`${skipped} file${skipped===1 ? '' : 's'} skipped — only ${remaining} slot${remaining===1 ? '' : 's'} left.`]
        : [])
    ]

    if(problems.length){
      setError(problems.join(' · '))
    }
  }

  async function handleView(doc:KycDocumentRow){
    if(!supabase) return

    setError('')

    const {data,error:signError}=
      await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path,300)

    if(signError || !data?.signedUrl){
      setError(
        signError?.message ||
        'Unable to open this document.'
      )
      return
    }

    window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }

  async function handleDelete(doc:KycDocumentRow){
    if(!supabase) return

    setError('')
    setNotice('')

    try{
      const {error:deleteError}=
        await supabase
          .from('employee_kyc_documents')
          .delete()
          .eq('id',doc.id)

      if(deleteError) throw deleteError

      await supabase.storage
        .from(BUCKET)
        .remove([doc.storage_path])

      setDocuments(prev=>
        prev.filter(item=>item.id !== doc.id)
      )
    }catch(err:any){
      setError(
        err?.message ||
        'Unable to delete this document.'
      )
    }
  }

  return (
    <div className="kycDocsSection">
      <div className="kycDocsHeader">
        <span className="eyebrow">
          ONBOARDING DOCUMENTS
        </span>

        <h3>Identity & compliance documents</h3>

        <p>
          Upload up to {MAX_FILES_PER_TYPE} files per document
          type. PDF, PNG or JPG, 10MB max per file. Only you
          and HR/Admin can view these.
        </p>
      </div>

      {loading ? (
        <div className="kycDocsLoading">
          <Loader2 size={18} className="spin"/>
          Loading your documents...
        </div>
      ) : (
        <div className="kycDocsGrid">
          {SLOTS.map(slot=>{
            const items=documents.filter(
              doc=>doc.document_type===slot.type
            )

            const atLimit=
              items.length >= MAX_FILES_PER_TYPE

            const isUploading=
              uploadingType===slot.type

            return (
              <div
                key={slot.type}
                className="kycDocCard"
              >
                <div className="kycDocCardHeader">
                  <div>
                    <strong>{slot.label}</strong>
                    <small>{slot.description}</small>
                  </div>

                  <span className="kycDocCount">
                    {items.length}/{MAX_FILES_PER_TYPE}
                  </span>
                </div>

                {items.length > 0 &&
                  <ul className="kycDocFileList">
                    {items.map(doc=>(
                      <li
                        key={doc.id}
                        className="kycDocFileRow"
                      >
                        <FileText size={15}/>

                        <span
                          className="kycDocFileName"
                          title={doc.original_filename}
                        >
                          {doc.original_filename}
                        </span>

                        <span className="kycDocFileSize">
                          {formatSize(doc.file_size)}
                        </span>

                        <button
                          type="button"
                          className="iconButton"
                          title="View document"
                          onClick={()=>
                            void handleView(doc)
                          }
                        >
                          <Download size={15}/>
                        </button>

                        <button
                          type="button"
                          className="iconButton"
                          title="Delete document"
                          onClick={()=>
                            void handleDelete(doc)
                          }
                        >
                          <Trash2 size={15}/>
                        </button>
                      </li>
                    ))}
                  </ul>
                }

                <label
                  className={
                    atLimit
                      ? 'kycDocUploadButton kycDocUploadButtonDisabled'
                      : 'kycDocUploadButton'
                  }
                >
                  {isUploading
                    ? <Loader2 size={15} className="spin"/>
                    : <UploadCloud size={15}/>
                  }

                  {atLimit
                    ? 'Maximum reached'
                    : isUploading
                      ? 'Uploading...'
                      : 'Upload file'
                  }

                  <input
                    hidden
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    multiple
                    disabled={atLimit || isUploading}
                    onChange={e=>
                      void handleUpload(slot.type,e)
                    }
                  />
                </label>
              </div>
            )
          })}
        </div>
      )}

      {notice &&
        <div className="profileMessage">
          {notice}
        </div>
      }

      {error &&
        <div className="kycDocsError">
          <AlertTriangle size={15}/>
          {error}
        </div>
      }
    </div>
  )
}
