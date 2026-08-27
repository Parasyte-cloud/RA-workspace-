import {
  useEffect,
  useState
} from 'react'

import type {
  ChangeEvent,
  ReactNode
} from 'react'

import {
  BriefcaseBusiness,
  Camera,
  Clock3,
  CreditCard,
  Edit3,
  ExternalLink,
  Globe2,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Save,
  UserRound,
  X
} from 'lucide-react'

import { supabase } from '../lib/supabase'

import {
  EmployeeVirtualCard,
  type EmployeeCardProfile
} from '../components/EmployeeVirtualCard'

import '../virtual-card.css'

type Profile =
  EmployeeCardProfile & {
    avatar_path?:string|null
  }

type Props = {
  profile:Profile
  onProfileUpdated:()=>Promise<void>
}

export function ProfileModule({
  profile,
  onProfileUpdated
}:Props){
  const [editing,setEditing]=useState(false)
  const [showCard,setShowCard]=useState(false)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')

  const [phone,setPhone]=
    useState(profile.phone || '')

  const [whatsapp,setWhatsapp]=
    useState(profile.whatsapp || '')

  const [office,setOffice]=
    useState(profile.office_address || 'Lagos, Nigeria')

  const [website,setWebsite]=
    useState(profile.website || 'https://ridearrivo.com')

  const [linkedin,setLinkedin]=
    useState(profile.linkedin_url || '')

  const [xUrl,setXUrl]=
    useState(profile.x_url || '')

  const [instagram,setInstagram]=
    useState(profile.instagram_url || '')

  const [bio,setBio]=
    useState(profile.bio || '')

  const [hours,setHours]=
    useState(
      profile.working_hours ||
      'Mon - Fri: 9:00 AM - 6:00 PM'
    )

  const [avatarPath,setAvatarPath]=
    useState(profile.avatar_path || '')

  const [avatarUrl,setAvatarUrl]=
    useState(profile.avatar_url || '')

  useEffect(()=>{
    setPhone(profile.phone || '')
    setWhatsapp(profile.whatsapp || '')
    setOffice(
      profile.office_address ||
      'Lagos, Nigeria'
    )
    setWebsite(
      profile.website ||
      'https://ridearrivo.com'
    )
    setLinkedin(profile.linkedin_url || '')
    setXUrl(profile.x_url || '')
    setInstagram(profile.instagram_url || '')
    setBio(profile.bio || '')
    setHours(
      profile.working_hours ||
      'Mon - Fri: 9:00 AM - 6:00 PM'
    )
    setAvatarPath(profile.avatar_path || '')
    setAvatarUrl(profile.avatar_url || '')
  },[profile])

  async function save(){
    if(!supabase) return

    setSaving(true)
    setMessage('')

    try{
      const {error}=
        await supabase.rpc(
          'update_my_employee_profile',
          {
            p_phone:
              phone.trim() || null,
            p_whatsapp:
              whatsapp.trim() || null,
            p_avatar_path:
              avatarPath || null,
            p_linkedin_url:
              linkedin.trim() || null,
            p_bio:
              bio.trim() || null,
            p_office_address:
              office.trim() || null,
            p_website:
              website.trim() || null,
            p_x_url:
              xUrl.trim() || null,
            p_instagram_url:
              instagram.trim() || null,
            p_working_hours:
              hours.trim() || null
          }
        )

      if(error) throw error

      await onProfileUpdated()

      setEditing(false)
      setMessage('Profile updated successfully.')
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to update profile.'
      )
    }finally{
      setSaving(false)
    }
  }

  async function uploadHeadshot(
    event:ChangeEvent<HTMLInputElement>
  ){
    const file=
      event.target.files?.[0]

    if(!file || !supabase) return

    setMessage('')

    if(
      ![
        'image/jpeg',
        'image/png',
        'image/webp'
      ].includes(file.type)
    ){
      setMessage(
        'Use a JPG, PNG or WebP image.'
      )
      return
    }

    if(file.size > 5*1024*1024){
      setMessage(
        'Headshot must be 5MB or smaller.'
      )
      return
    }

    setSaving(true)

    try{
      const {
        data:{user}
      } =
        await supabase.auth.getUser()

      if(!user){
        throw new Error(
          'Authentication required.'
        )
      }

      const extension=
        file.type==='image/png'
          ? 'png'
          : file.type==='image/webp'
            ? 'webp'
            : 'jpg'

      const path=
        `${user.id}/headshot.${extension}`

      const {error:uploadError}=
        await supabase.storage
          .from('employee-headshots')
          .upload(
            path,
            file,
            {
              upsert:true,
              contentType:file.type
            }
          )

      if(uploadError){
        throw uploadError
      }

      setAvatarPath(path)

      const {data:signed,error:signedError}=
        await supabase.storage
          .from('employee-headshots')
          .createSignedUrl(
            path,
            3600
          )

      if(signedError){
        throw signedError
      }

      setAvatarUrl(
        signed.signedUrl
      )

      setMessage(
        'Headshot ready. Save your profile.'
      )
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

  const cardProfile:EmployeeCardProfile={
    ...profile,
    phone,
    whatsapp,
    office_address:office,
    website,
    linkedin_url:linkedin,
    x_url:xUrl,
    instagram_url:instagram,
    bio,
    working_hours:hours,
    avatar_url:avatarUrl
  }

  return (
    <section className="employeeProfilePage">
      <div className="profileHero">
        <div>
          <span className="eyebrow">
            RIDEARRIVO IDENTITY
          </span>

          <h2>My Profile</h2>

          <p>
            Your company identity,
            contact details and digital card.
          </p>
        </div>

        {!editing &&
          <button
            className="glassButton"
            onClick={()=>
              setEditing(true)
            }
          >
            <Edit3 size={16}/>
            Edit profile
          </button>
        }
      </div>

      <div className="profileShell">
        <aside className="profileIdentityCard">
          <div className="profileHeadshot">
            {avatarUrl
              ? (
                <img
                  src={avatarUrl}
                  alt={`${profile.full_name} headshot`}
                />
              )
              : <UserRound size={48}/>
            }
          </div>

          {editing &&
            <label className="profilePhotoAction">
              <Camera size={16}/>
              Change headshot

              <input
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={uploadHeadshot}
              />
            </label>
          }

          <h2>
            {profile.full_name}
          </h2>

          <strong>
            {profile.job_title ||
             'RideArrivo Team'}
          </strong>

          <span>
            {profile.department}
          </span>

          <div className="profileIdentityEmail">
            <Mail size={15}/>
            {profile.email}
          </div>

          <button
            className="primaryButton"
            onClick={()=>
              setShowCard(true)
            }
          >
            <CreditCard size={17}/>
            View Virtual Card
          </button>
        </aside>

        <div className="profileDetailsCard">
          {!editing ? (
            <>
              <div className="profileDetailGrid">
                <Info
                  icon={<Phone/>}
                  label="Phone"
                  value={phone}
                />

                <Info
                  icon={<MessageCircle/>}
                  label="WhatsApp"
                  value={whatsapp}
                />

                <Info
                  icon={<BriefcaseBusiness/>}
                  label="Job title"
                  value={profile.job_title}
                />

                <Info
                  icon={<UserRound/>}
                  label="Department"
                  value={profile.department}
                />

                <Info
                  icon={<MapPin/>}
                  label="Office"
                  value={office}
                />

                <Info
                  icon={<Clock3/>}
                  label="Working hours"
                  value={hours}
                />

                <Info
                  icon={<Globe2/>}
                  label="Website"
                  value={website}
                />

                <Info
                  icon={<Linkedin/>}
                  label="LinkedIn"
                  value={linkedin}
                />
              </div>

              <div className="profileBio">
                <span className="eyebrow">
                  ABOUT
                </span>

                <p>
                  {bio ||
                    'No professional bio added yet.'}
                </p>
              </div>
            </>
          ) : (
            <div className="profileEditForm">
              <div className="profileEditHeader">
                <div>
                  <span className="eyebrow">
                    EDIT PROFILE
                  </span>
                  <h3>
                    Contact & digital identity
                  </h3>
                </div>

                <button
                  className="iconButton"
                  onClick={()=>
                    setEditing(false)
                  }
                >
                  <X size={18}/>
                </button>
              </div>

              <div className="profileFieldGrid">
                <Field
                  label="Phone"
                  value={phone}
                  setValue={setPhone}
                />

                <Field
                  label="WhatsApp"
                  value={whatsapp}
                  setValue={setWhatsapp}
                />

                <Field
                  label="Office address"
                  value={office}
                  setValue={setOffice}
                />

                <Field
                  label="Company website"
                  value={website}
                  setValue={setWebsite}
                />

                <Field
                  label="LinkedIn"
                  value={linkedin}
                  setValue={setLinkedin}
                />

                <Field
                  label="X / Twitter"
                  value={xUrl}
                  setValue={setXUrl}
                />

                <Field
                  label="Instagram"
                  value={instagram}
                  setValue={setInstagram}
                />

                <Field
                  label="Working hours"
                  value={hours}
                  setValue={setHours}
                />
              </div>

              <label className="profileTextareaField">
                <span>Professional bio</span>
                <textarea
                  value={bio}
                  onChange={e=>
                    setBio(e.target.value)
                  }
                  rows={5}
                  placeholder="Write a short professional introduction..."
                />
              </label>

              <div className="profileEditActions">
                <button
                  className="glassButton"
                  onClick={()=>
                    setEditing(false)
                  }
                >
                  Cancel
                </button>

                <button
                  className="primaryButton"
                  disabled={saving}
                  onClick={()=>
                    void save()
                  }
                >
                  {saving
                    ? <Loader2 size={16}/>
                    : <Save size={16}/>
                  }

                  {saving
                    ? 'Saving...'
                    : 'Save changes'
                  }
                </button>
              </div>
            </div>
          )}

          {message &&
            <div className="profileMessage">
              {message}
            </div>
          }
        </div>
      </div>

      {showCard &&
        <EmployeeVirtualCard
          profile={cardProfile}
          onClose={()=>
            setShowCard(false)
          }
        />
      }
    </section>
  )
}

function Info({
  icon,
  label,
  value
}:{
  icon:ReactNode
  label:string
  value?:string|null
}){
  return (
    <div className="profileInfo">
      <div className="profileInfoIcon">
        {icon}
      </div>

      <div>
        <small>{label}</small>
        <strong>
          {value || 'Not added'}
        </strong>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  setValue
}:{
  label:string
  value:string
  setValue:(value:string)=>void
}){
  return (
    <label className="profileField">
      <span>{label}</span>

      <input
        value={value}
        onChange={e=>
          setValue(e.target.value)
        }
      />
    </label>
  )
}
