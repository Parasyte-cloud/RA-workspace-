import type { CSSProperties } from 'react'

type Props = {
  name: string
  initialsText: string
  url?: string | null
  statusEmoji?: string | null
  className?: string
  size?: number
  onClick?: () => void
  label?: string
}

// A round picture, or initials when the person has not shared one. A small
// status emoji sits on the corner when they have set a status.
export function ChatAvatar({ name, initialsText, url, statusEmoji, className = '', size, onClick, label }: Props) {
  const style: CSSProperties | undefined = size ? { width: size, height: size, flexBasis: size, fontSize: Math.max(10, Math.round(size * 0.34)) } : undefined
  const content = (
    <>
      {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : initialsText}
      {statusEmoji && <span className="cmAvatarStatus" aria-hidden="true">{statusEmoji}</span>}
    </>
  )
  const classes = `cmAvatar cmAvatarBox${url ? ' cmHasPhoto' : ''} ${className}`.trim()
  if (onClick) {
    return (
      <button type="button" className={`${classes} cmAvatarButton`} style={style} onClick={onClick} aria-label={label || `View ${name}`}>
        {content}
      </button>
    )
  }
  return <span className={classes} style={style} role="img" aria-label={name}>{content}</span>
}
