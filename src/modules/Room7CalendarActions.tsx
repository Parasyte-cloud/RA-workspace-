import {
  CalendarDays,
  Download,
  ExternalLink,
} from 'lucide-react'
import {
  googleCalendarUrl,
  outlookCalendarUrl,
  room7IcsUrl,
  type Room7CalendarEvent,
} from '../lib/room7Calendar'

type Props = {
  event: Room7CalendarEvent
}

export default function Room7CalendarActions({
  event,
}: Props) {
  const ics =
    room7IcsUrl(event.eventCode)

  return (
    <div className="room7CalendarActions">
      <a
        className="room7CalendarPrimary"
        href={ics}
        target="_blank"
        rel="noreferrer"
      >
        <CalendarDays size={17} />
        Add to calendar
      </a>

      <details className="room7CalendarMore">
        <summary>
          More options
        </summary>

        <div className="room7CalendarMenu">
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            Google Calendar
          </a>

          <a
            href={outlookCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            Outlook
          </a>

          <a
            href={ics}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={15} />
            Apple / .ics
          </a>
        </div>
      </details>
    </div>
  )
}
