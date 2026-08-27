import {
  ChangeEvent,
  useEffect,
  useState
} from 'react'
import {
  Camera,
  CreditCard,
  Loader2,
  Save,
  UserRound
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  EmployeeVirtualCard,
  type EmployeeCardProfile
} from '../components/EmployeeVirtualCard'
import '../virtual-card.css'

type Profile = EmployeeCardProfile & {
  avatar_path?: string | null
}

type Props = {
  profile: Profile
  onProfileUpdated: () => Promise<void>
}

export function ProfileModule({
  profile,
  onProfileUpdated
}: Props) {
  const [showCard,setShowCard] = useState(false)
  const [phone,setPhone] = useState(profile.phone || '')
  const [whatsapp,setWhatsapp] = useState(profile.whatsapp || '')
  const [linkedin,setLinkedin] = useState(profile.linkedin_url || '')
  const [bio,setBio] = useState(profile.bio || '')
  const [avatarUrl,setAvatarUrl] =
    useState(profile.avatar_url || '')
  const [avatarPath,setAvatarPath] =
    useState(profile.avatar_path || '')
  const [saving,setSaving] = useState(false)
  const [message,setMessage] = useState('')

  useEffect(()=>{
    setPhone(profile.phone || '')
    setWhatsapp(profile.whatsapp || '')
    setLinkedin(profile.linkedin_url || '')
    setBio(profile.bio || '')
    setAvatarUrl(profile.avatar_url || '')
    setAvatarPath(profile.avatar_path || '')
  },[profile])

  const uploadHeadshot = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    if(!file || !supabase) return

    setMessage('')

    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      setMessage('Use a JPG, PNG or WebP image.')
      return
    }

    if(file.size > 5 * 1024 * 1024){
      setMessage('Headshots must be 5MB or smaller.')
      return
    }

    setSaving(true)

    try{
      const {
        data:{ user }
      } = await supabase.auth.getUser()

      if(!user){
        throw new Error('Authentication required.')
      }

      const extension =
        file.type === 'image/png'
          ? 'png'
          : file.type === 'image/webp'
            ? 'webp'
            : 'jpg'

      const path =
        `${user.id}/headshot.${extension}`

      const {error:uploadError} =
        await supabase.storage
          .from('employee-headshots')
          .upload(path,file,{
            upsert:true,
            contentType:file.type
          })

      if(uploadError) throw uploadError

      const {error:updateError} =
        await supabase.rpc(
          'update_my_employee_profile',
          {
            p_phone:phone || null,
            p_whatsapp:whatsapp || null,
            p_avatar_path:path,
            p_linkedin_url:linkedin || null,
            p_bio:bio || null
          }
        )

      if(updateError) throw updateError

      const {data:signed,error:signedError} =
        await supabase.storage
          .from('employee-headshots')
          .createSignedUrl(path,3600)

      if(signedError) throw signedError

      setAvatarPath(path)
      setAvatarUrl(signed.signedUrl)

      await onProfileUpdated()

      setMessage('Headshot updated.')
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to upload headshot.'
      )
    }finally{
      setSaving(false)
      event.target.value=''
    }
  }

  const saveProfile = async () => {
    if(!supabase) return

    setSaving(true)
    setMessage('')

    try{
      const {error} =
        await supabase.rpc(
          'update_my_employee_profile',
          {
            p_phone:phone.trim() || null,
            p_whatsapp:whatsapp.trim() || null,
            p_avatar_path:avatarPath || null,
            p_linkedin_url:linkedin.trim() || null,
            p_bio:bio.trim() || null
          }
        )

      if(error) throw error

      await onProfileUpdated()
      setMessage('Profile saved.')
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to save profile.'
      )
    }finally{
      setSaving(false)
    }
  }

  const cardProfile: EmployeeCardProfile = {
    ...profile,
    phone,
    whatsapp,
    linkedin_url:linkedin,
    bio,
    avatar_url:avatarUrl
  }

  return (
    <section>
      <div className="sectionTitle">
        <div>
          <span className="eyebrow">
            EMPLOYEE PROFILE
          </span>
          <h2>My Profile</h2>
          <p>
            Manage your RideArrivo identity,
            headshot and virtual employee card.
          </p>
        </div>
      </div>

      <div
        className="glassCard"
        style={{
          padding:24,
          display:'grid',
          gap:24
        }}
      >
        <div
          style={{
            display:'flex',
            alignItems:'center',
            gap:18,
            flexWrap:'wrap'
          }}
        >
          <div
            style={{
              width:96,
              height:96,
              borderRadius:'50%',
              overflow:'hidden',
              display:'grid',
              placeItems:'center',
              background:'rgba(255,255,255,.1)',
              fontSize:28,
              fontWeight:800
            }}
          >
            {avatarUrl
              ? (
                <img
                  src={avatarUrl}
                  alt={`${profile.full_name || 'Employee'} headshot`}
                  style={{
                    width:'100%',
                    height:'100%',
                    objectFit:'cover'
                  }}
                />
              )
              : <UserRound size={38}/>
            }
          </div>

          <div style={{display:'grid',gap:8}}>
            <strong style={{fontSize:20}}>
              {profile.full_name}
            </strong>

            <span>
              {profile.job_title || profile.role}
              {profile.department
                ? ` · ${profile.department}`
                : ''}
            </span>

            <label className="glassButton">
              <Camera size={16}/>
              {saving ? 'Uploading…' : 'Upload headshot'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={saving}
                onChange={uploadHeadshot}
              />
            </label>
          </div>
        </div>

        <div
          style={{
            display:'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(220px,1fr))',
            gap:16
          }}
        >
          <label>
            Phone
            <input
              value={phone}
              onChange={e=>setPhone(e.target.value)}
              placeholder="+234..."
            />
          </label>

          <label>
            WhatsApp
            <input
              value={whatsapp}
              onChange={e=>setWhatsapp(e.target.value)}
              placeholder="+234..."
            />
          </label>

          <label>
            LinkedIn
            <input
              value={linkedin}
              onChange={e=>setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/..."
            />
          </label>
        </div>

        <label>
          Bio
          <textarea
            value={bio}
            onChange={e=>setBio(e.target.value)}
            rows={4}
            placeholder="Short professional bio"
          />
        </label>

        <div
          style={{
            display:'flex',
            gap:12,
            flexWrap:'wrap'
          }}
        >
          <button
            className="primaryButton"
            onClick={saveProfile}
            disabled={saving}
          >
            {saving
              ? <Loader2 size={16}/>
              : <Save size={16}/>
            }
            Save profile
          </button>

          <button
            className="glassButton"
            onClick={()=>setShowCard(true)}
          >
            <CreditCard size={16}/>
            View virtual employee card
          </button>
        </div>

        {message &&
          <div className="authMessage">
            {message}
          </div>
        }
      </div>

      {showCard &&
        <EmployeeVirtualCard
          profile={cardProfile}
          onClose={()=>setShowCard(false)}
        />
      }
    </section>
  )
}
