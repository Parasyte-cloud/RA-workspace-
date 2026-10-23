import {
  useMemo,
  useState,
} from 'react'

import {
  CalendarDays,
  Check,
  Copy,
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

type ScheduleLabels = {
  date: string
  time: string
  timezone: string
}

function scheduleLabels(
  event: Room7CalendarEvent,
): ScheduleLabels {
  const start =
    new Date(event.startsAt)

  const end =
    new Date(event.endsAt)

  const timezone =
    event.timezone ||
    'Africa/Lagos'

  const safeTimezone = (() => {
    try {
      new Intl.DateTimeFormat(
        'en-NG',
        {
          timeZone: timezone,
        },
      ).format(start)

      return timezone
    } catch {
      return 'Africa/Lagos'
    }
  })()

  const dateFormatter =
    new Intl.DateTimeFormat(
      'en-NG',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: safeTimezone,
      },
    )

  const timeFormatter =
    new Intl.DateTimeFormat(
      'en-NG',
      {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: safeTimezone,
      },
    )

  const zoneFormatter =
    new Intl.DateTimeFormat(
      'en-NG',
      {
        timeZone: safeTimezone,
        timeZoneName: 'short',
      },
    )

  const zoneName =
    zoneFormatter
      .formatToParts(start)
      .find(
        part =>
          part.type ===
          'timeZoneName',
      )
      ?.value ||
    safeTimezone

  const startDate =
    dateFormatter.format(start)

  const endDate =
    dateFormatter.format(end)

  const time =
    startDate === endDate
      ? `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`
      : `${startDate}, ${timeFormatter.format(start)} → ${endDate}, ${timeFormatter.format(end)}`

  return {
    date: startDate,
    time,
    timezone:
      safeTimezone === zoneName
        ? safeTimezone
        : `${zoneName} · ${safeTimezone}`,
  }
}

export default function Room7CalendarActions({
  event,
}: Props) {
  const [copied, setCopied] =
    useState(false)

  const ics =
    room7IcsUrl(
      event.eventCode,
    )

  const schedule =
    useMemo(
      () =>
        scheduleLabels(
          event,
        ),
      [
        event.startsAt,
        event.endsAt,
        event.timezone,
      ],
    )

  const invitation =
    useMemo(
      () =>
        [
          event.title,
          '',
          schedule.date,
          `${schedule.time} · ${schedule.timezone}`,
          '',
          `Join ROOM 7: ${event.joinUrl}`,
          `Event code: ${event.eventCode}`,
          '',
          `Add to calendar: ${ics}`,
        ].join('\n'),
      [
        event.title,
        event.joinUrl,
        event.eventCode,
        schedule.date,
        schedule.time,
        schedule.timezone,
        ics,
      ],
    )

  const copyInvitation =
    async () => {
      try {
        await navigator.clipboard.writeText(
          invitation,
        )

        setCopied(true)

        window.setTimeout(
          () =>
            setCopied(false),
          1800,
        )
      } catch {
        setCopied(false)
      }
    }

  return (
    <section
      className="room7CalendarActions"
      aria-label="ROOM 7 calendar"
    >
      <div className="room7CalendarSchedule">
        <div className="room7CalendarScheduleIcon">
          <CalendarDays
            size={20}
          />
        </div>

        <div>
          <strong>
            {schedule.date}
          </strong>

          <span>
            {schedule.time}
          </span>

          <small>
            {schedule.timezone}
          </small>
        </div>
      </div>

      <div className="room7CalendarActionRow">
        <a
          className="room7CalendarPrimary"
          href={ics}
          target="_blank"
          rel="noreferrer"
        >
          <CalendarDays
            size={17}
          />

          Add to calendar
        </a>

        <button
          type="button"
          className="room7CalendarCopy"
          onClick={() =>
            void copyInvitation()
          }
        >
          {copied ? (
            <Check size={16} />
          ) : (
            <Copy size={16} />
          )}

          {copied
            ? 'Copied'
            : 'Copy invitation'}
        </button>
      </div>

      <details className="room7CalendarMore">
        <summary>
          Calendar options
        </summary>

        <div className="room7CalendarMenu">
          <a
            href={
              googleCalendarUrl(
                event,
              )
            }
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink
              size={15}
            />

            Google Calendar
          </a>

          <a
            href={
              outlookCalendarUrl(
                event,
              )
            }
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink
              size={15}
            />

            Outlook (work or school)
          </a>

          <a
            href={
              outlookCalendarUrl(
                event,
                'personal',
              )
            }
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink
              size={15}
            />

            Outlook.com (personal)
          </a>

          <a
            href={ics}
            target="_blank"
            rel="noreferrer"
          >
            <Download
              size={15}
            />

            Apple / .ics
          </a>
        </div>
      </details>
    </section>
  )
}
