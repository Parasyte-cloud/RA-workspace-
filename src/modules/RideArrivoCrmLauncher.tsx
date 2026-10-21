import { ArrowUpRight, Building2, Headphones, ShieldCheck, Users } from 'lucide-react'

const CRM_URL = 'https://crm.ridearrivo.com'

export default function RideArrivoCrmLauncher(){
  function openCrm(){
    window.open(CRM_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="ridearrivoCrmLauncher" aria-labelledby="ridearrivo-crm-launcher-title">
      <div className="ridearrivoCrmLauncher__copy">
        <span className="ridearrivoCrmLauncher__eyebrow">RIDEARRIVO CRM</span>
        <h3 id="ridearrivo-crm-launcher-title">Relationship & Support CRM</h3>
        <p>Open the standalone CRM for customer and driver relationships, tickets, calls, follow-ups, companies and growth pipelines.</p>
        <div className="ridearrivoCrmLauncher__features" aria-label="CRM capabilities">
          <span><Users size={15}/> Contacts</span>
          <span><Headphones size={15}/> Support</span>
          <span><Building2 size={15}/> Companies</span>
          <span><ShieldCheck size={15}/> Governed access</span>
        </div>
      </div>
      <button type="button" className="ridearrivoCrmLauncher__button" onClick={openCrm}>
        Open CRM <ArrowUpRight size={17}/>
      </button>
    </section>
  )
}
