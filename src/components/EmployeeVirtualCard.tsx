import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  Clock3,
  Download,
  ExternalLink,
  Globe2,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  RotateCcw,
  UserRound,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

export type EmployeeCardProfile = {
  id:string
  full_name?:string|null
  email?:string|null
  role?:string|null
  department?:string|null
  job_title?:string|null
  phone?:string|null
  whatsapp?:string|null
  avatar_url?:string|null
  office_address?:string|null
  website?:string|null
  linkedin_url?:string|null
  x_url?:string|null
  instagram_url?:string|null
  bio?:string|null
  working_hours?:string|null
  virtual_card_enabled?:boolean|null
  public_card_enabled?:boolean|null
}

type Props = {
  profile:EmployeeCardProfile
  onClose?:()=>void
}

const DEFAULT_WEBSITE='https://ridearrivo.com'
const DEFAULT_OFFICE='Lagos, Nigeria'
const DEFAULT_HOURS='Mon - Fri: 9:00 AM - 6:00 PM'

function initials(name?:string|null){
  return String(name || 'RideArrivo')
    .trim()
    .split(/\s+/)
    .slice(0,2)
    .map(part=>part[0]?.toUpperCase() || '')
    .join('')
}

function normalizePhone(value?:string|null){
  return String(value || '').replace(/[^\d+]/g,'')
}

function safeUrl(value?:string|null){
  const raw=String(value || '').trim()

  if(!raw) return ''

  try{
    const url=new URL(
      /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`
    )

    if(
      url.protocol !== 'https:' &&
      url.protocol !== 'http:'
    ){
      return ''
    }

    return url.toString()
  }catch{
    return ''
  }
}

export function EmployeeVirtualCard({
  profile,
  onClose
}:Props){

  const [back,setBack]=useState(false)
  const [avatarFailed,setAvatarFailed]=useState(false)

  const fullName=
    profile.full_name ||
    profile.email?.split('@')[0] ||
    'RideArrivo Employee'

  const workEmail=
    String(profile.email || '').trim()

  const phone=
    String(profile.phone || '').trim()

  const whatsapp=
    String(profile.whatsapp || profile.phone || '').trim()

  const website=
    safeUrl(profile.website) ||
    DEFAULT_WEBSITE

  const office=
    profile.office_address ||
    DEFAULT_OFFICE

  const hours=
    profile.working_hours ||
    DEFAULT_HOURS

  const shareUrl=useMemo(()=>{

    const configured=
      String(
        import.meta.env.VITE_CONTACT_CARD_BASE_URL ||
        ''
      ).replace(/\/$/,'')

    if(
      configured &&
      profile.public_card_enabled
    ){
      return `${configured}/${encodeURIComponent(profile.id)}`
    }

    return `${window.location.origin}/?employee=${encodeURIComponent(profile.id)}`

  },[
    profile.id,
    profile.public_card_enabled
  ])

  const downloadVCard=()=>{

    const lines=[
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${fullName}`,
      `ORG:RideArrivo Limited`,
      profile.job_title
        ? `TITLE:${profile.job_title}`
        : '',
      workEmail
        ? `EMAIL;TYPE=WORK:${workEmail}`
        : '',
      phone
        ? `TEL;TYPE=WORK,VOICE:${phone}`
        : '',
      whatsapp
        ? `TEL;TYPE=CELL:${whatsapp}`
        : '',
      office
        ? `ADR;TYPE=WORK:;;${office};;;;`
        : '',
      website
        ? `URL:${website}`
        : '',
      profile.linkedin_url
        ? `X-SOCIALPROFILE;TYPE=linkedin:${profile.linkedin_url}`
        : '',
      profile.bio
        ? `NOTE:${profile.bio.replace(/\r?\n/g,' ')}`
        : '',
      'END:VCARD'
    ].filter(Boolean)

    const blob=new Blob(
      [lines.join('\r\n')],
      {
        type:'text/vcard;charset=utf-8'
      }
    )

    const url=URL.createObjectURL(blob)

    const anchor=document.createElement('a')

    anchor.href=url
    anchor.download=
      `${fullName.replace(/[^\w-]+/g,'-').toLowerCase()}.vcf`

    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    URL.revokeObjectURL(url)
  }

  const phoneHref=
    phone
      ? `tel:${normalizePhone(phone)}`
      : ''

  const whatsappHref=
    whatsapp
      ? `https://wa.me/${normalizePhone(whatsapp).replace(/^\+/,'')}`
      : ''

  return (
    <div className="virtualCardOverlay">

      <div className="virtualCardModal">

        <div className="virtualCardTop">

          <div>

            <span className="eyebrow">
              RIDEARRIVO DIGITAL IDENTITY
            </span>

            <h2>
              Employee Virtual Card
            </h2>

            <p>
              Secure company profile and digital business card.
            </p>

          </div>

          {onClose&&
            <button
              type="button"
              className="iconButton"
              onClick={onClose}
              aria-label="Close profile"
            >
              <ArrowLeft size={18}/>
            </button>
          }

        </div>

        <div className="virtualCardStage">

          <div
            className={`virtualCardPhone ${back?'showBack':''}`}
          >

            <div className="virtualCardFaces">

              <article className="virtualCardFace virtualCardFront">

                <div className="virtualCardBrand">

                  <strong>
                    <span>Ride</span>
                    <b>Arrivo</b>
                  </strong>

                  <span>
                    INTERNAL IDENTITY
                  </span>

                </div>

                <div className="virtualCardIdentity">

                  <div className="virtualCardAvatar">

                    {profile.avatar_url && !avatarFailed
                      ? (
                        <img
                          src={profile.avatar_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={()=>setAvatarFailed(true)}
                        />
                      )
                      : (
                        <span>
                          {initials(fullName)}
                        </span>
                      )
                    }

                  </div>

                  <h1>
                    {fullName}
                  </h1>

                  <strong className="virtualCardTitle">
                    {profile.job_title || 'RideArrivo Team'}
                  </strong>

                  {profile.department&&
                    <span className="virtualCardDepartment">
                      {profile.department}
                    </span>
                  }

                </div>

                <div className="virtualCardActions">

                  {phone&&
                    <a href={phoneHref}>
                      <Phone size={17}/>
                      <span>{phone}</span>
                      <ExternalLink size={14}/>
                    </a>
                  }

                  {workEmail&&
                    <a href={`mailto:${workEmail}`}>
                      <Mail size={17}/>
                      <span>{workEmail}</span>
                      <ExternalLink size={14}/>
                    </a>
                  }

                  {whatsapp&&
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle size={17}/>
                      <span>Chat on WhatsApp</span>
                      <ExternalLink size={14}/>
                    </a>
                  }

                  <div>
                    <MapPin size={17}/>
                    <span>{office}</span>
                  </div>

                  <a
                    href={website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Globe2 size={17}/>
                    <span>
                      {website.replace(/^https?:\/\//,'').replace(/\/$/,'')}
                    </span>
                    <ExternalLink size={14}/>
                  </a>

                </div>

                <div className="virtualCardSocial">

                  {profile.linkedin_url&&
                    <a
                      href={safeUrl(profile.linkedin_url)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="LinkedIn"
                    >
                      <Linkedin size={18}/>
                    </a>
                  }

                  <button
                    type="button"
                    onClick={()=>setBack(true)}
                  >
                    <RotateCcw size={17}/>
                    About
                  </button>

                </div>

              </article>

              <article className="virtualCardFace virtualCardBack">

                <div className="virtualCardBackLogo">
                  <MapPin size={50}/>
                </div>

                <h2>
                  About RideArrivo
                </h2>

                <p className="virtualCardBio">
                  {profile.bio ||
                    'Representing RideArrivo with professionalism, service excellence and integrity.'
                  }
                </p>

                <div className="virtualCardDivider"/>

                <div className="virtualCardFacts">

                  <div>
                    <UserRound size={19}/>
                    <span>
                      <small>Department</small>
                      <strong>
                        {profile.department || 'RideArrivo'}
                      </strong>
                    </span>
                  </div>

                  <div>
                    <Mail size={19}/>
                    <span>
                      <small>Work Email</small>
                      <strong>
                        {workEmail || '—'}
                      </strong>
                    </span>
                  </div>

                  <div>
                    <Building2 size={19}/>
                    <span>
                      <small>Office</small>
                      <strong>{office}</strong>
                    </span>
                  </div>

                  <div>
                    <Clock3 size={19}/>
                    <span>
                      <small>Working Hours</small>
                      <strong>{hours}</strong>
                    </span>
                  </div>

                </div>

                <div className="virtualCardQR">

                  <div>
                    <QRCodeSVG
                      value={shareUrl}
                      size={104}
                      level="M"
                      includeMargin
                    />
                  </div>

                  <span>
                    Scan profile
                  </span>

                </div>

                <button
                  type="button"
                  className="virtualCardSave"
                  onClick={downloadVCard}
                >
                  <Download size={18}/>
                  Save Contact
                </button>

                <button
                  type="button"
                  className="virtualCardFlipBack"
                  onClick={()=>setBack(false)}
                >
                  <RotateCcw size={16}/>
                  View front
                </button>

              </article>

            </div>

          </div>

        </div>

      </div>

    </div>
  )
}
