import { splitLinks } from './linkify'
import { openInParasyte } from '../lib/parasyte'

/*
 * Message text with web addresses made clickable. A normal click opens the page
 * in the workstation's own PArAsYtE browser. Cmd or Ctrl click, middle click and
 * the right click menu keep working for people who want a normal browser tab.
 */
export default function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <a
            key={index}
            className="cmLink"
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title="Open in the PArAsYtE browser. Cmd or Ctrl click opens a new tab."
            onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
              event.preventDefault()
              event.stopPropagation()
              openInParasyte(part.href)
            }}
          >
            {part.text}
          </a>
        ),
      )}
    </>
  )
}
