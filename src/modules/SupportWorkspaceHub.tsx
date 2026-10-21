import { useMemo, useState } from 'react'
import {
  BookOpenCheck,
  Headphones,
  Inbox,
  MessageCircleMore,
  PlaneTakeoff,
  ReceiptText,
} from 'lucide-react'
import SupportCommandCentre from './SupportCommandCentre'
import InvestorEnquiriesPanel from './InvestorEnquiriesPanel'
import IntakeSubmissionInbox from './IntakeSubmissionInbox'
import SupportWhatsAppPanel from './SupportWhatsAppPanel'
import SupportAssistedBookingPanel from './SupportAssistedBookingPanel'
import OperationsExportsCard from '../components/OperationsExportsCard'
import RideArrivoCrmLauncher from './RideArrivoCrmLauncher'
import '../support-workspace-hub.css'

type SupportArea =
  | 'command'
  | 'intake'
  | 'messages'
  | 'booking'
  | 'investors'
  | 'records'

const AREAS: Array<{
  id: SupportArea
  label: string
  short: string
  description: string
  icon: typeof Headphones
}> = [
  {
    id: 'command',
    label: 'Command Centre',
    short: 'Command',
    description: 'Queues, tickets, calls, callbacks, emergencies and live support status.',
    icon: Headphones,
  },
  {
    id: 'intake',
    label: 'Routed Intake',
    short: 'Intake',
    description: 'Website forms, customer complaints and routed service requests.',
    icon: Inbox,
  },
  {
    id: 'messages',
    label: 'WhatsApp',
    short: 'WhatsApp',
    description: 'Continue governed customer conversations without leaving Support.',
    icon: MessageCircleMore,
  },
  {
    id: 'booking',
    label: 'Assisted Booking',
    short: 'Booking',
    description: 'Create governed booking requests for existing riders.',
    icon: PlaneTakeoff,
  },
  {
    id: 'investors',
    label: 'Investor Enquiries',
    short: 'Investors',
    description: 'Review and follow up investor and partnership enquiries.',
    icon: BookOpenCheck,
  },
  {
    id: 'records',
    label: 'Operations Records',
    short: 'Records',
    description: 'Download governed operational records and evidence when needed.',
    icon: ReceiptText,
  },
]

export default function SupportWorkspaceHub() {
  const [active, setActive] = useState<SupportArea>('command')
  const selected = useMemo(() => AREAS.find((item) => item.id === active) ?? AREAS[0], [active])
  const ActiveIcon = selected.icon

  return (
    <div className="supportHub">
      <RideArrivoCrmLauncher />

      <section className="supportHubShell" aria-label="Support workspace tools">
        <header className="supportHubHeader">
          <div>
            <span className="supportHubEyebrow">SUPPORT OPERATIONS</span>
            <h3>Everything in its place</h3>
            <p>Keep the live command centre focused, then open the specialist tool you need without scrolling through the entire Support workstation.</p>
          </div>
          <div className="supportHubCurrent" aria-live="polite">
            <ActiveIcon size={17} />
            <span>{selected.label}</span>
          </div>
        </header>

        <nav className="supportHubNav" aria-label="Support tools">
          {AREAS.map((area) => {
            const Icon = area.icon
            return (
              <button
                key={area.id}
                type="button"
                className={active === area.id ? 'active' : ''}
                onClick={() => setActive(area.id)}
                aria-pressed={active === area.id}
                title={area.description}
              >
                <Icon size={17} />
                <span>{area.short}</span>
              </button>
            )
          })}
        </nav>

        <div className="supportHubContext">
          <div className="supportHubContextIcon"><ActiveIcon size={18} /></div>
          <div>
            <strong>{selected.label}</strong>
            <p>{selected.description}</p>
          </div>
        </div>

        <div className="supportHubPanel">
          {active === 'command' ? <SupportCommandCentre /> : null}
          {active === 'intake' ? (
            <IntakeSubmissionInbox
              workstation="support"
              title="Support Form Submissions"
              description="Customer support, complaints and other forms routed to Support appear here automatically."
            />
          ) : null}
          {active === 'messages' ? <SupportWhatsAppPanel /> : null}
          {active === 'booking' ? <SupportAssistedBookingPanel /> : null}
          {active === 'investors' ? <InvestorEnquiriesPanel /> : null}
          {active === 'records' ? <OperationsExportsCard /> : null}
        </div>
      </section>
    </div>
  )
}
