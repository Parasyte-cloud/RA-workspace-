import DOMPurify from 'dompurify'

// Email bodies are untrusted. DOMPurify already removes scripts and event
// handlers; this also stops links from handing the opener window to the
// destination, strips forms and style blocks (used for phishing look-alikes
// and for restyling the workspace), and blocks remote images so a message
// cannot report that it was opened.
let hooked = false

// An image may only come from inside the message itself: an inline data URL or
// a cid: attachment reference. Everything else is treated as remote.
//
// Browsers drop tabs, newlines and other control characters inside a URL
// before using it, so "ht<newline>tps://evil.test/a.png" is loaded as
// https://evil.test/a.png. Testing the raw text for "http" therefore missed it.
// Strip those characters (and spaces) first, then allow only known-safe starts.
export function isEmbeddedImageSource(value: string): boolean {
  const compact = String(value || '').replace(/[\u0000-\u0020\u007f-\u009f]+/g, '').toLowerCase()
  return compact.startsWith('data:image/') || compact.startsWith('cid:')
}
function installHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer nofollow')
    }
    // Other attributes that make the browser fetch a remote file on open.
    for (const attr of ['background', 'srcset', 'poster', 'data-src', 'lowsrc', 'dynsrc']) {
      if (node.hasAttribute(attr)) node.removeAttribute(attr)
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || ''
      if (src && !isEmbeddedImageSource(src)) {
        node.removeAttribute('src')
        node.setAttribute('data-blocked-src', 'remote image blocked')
      }
    }
  })
}

export function safeMailHtml(html: string): string {
  installHooks()
  return DOMPurify.sanitize(html || '', {
    // svg and math can pull remote files through href attributes that the image check does not see.
    FORBID_TAGS: ['svg', 'math', 'image', 'use', 'style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style'],
  })
}
