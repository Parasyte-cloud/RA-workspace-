import DOMPurify from 'dompurify'

// Email bodies are untrusted. DOMPurify already removes scripts and event
// handlers; this also stops links from handing the opener window to the
// destination, strips forms and style blocks (used for phishing look-alikes
// and for restyling the workspace), and blocks remote images so a message
// cannot report that it was opened.
let hooked = false
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
      if (/^(https?:)?\/\//i.test(src)) {
        node.removeAttribute('src')
        node.setAttribute('data-blocked-src', 'remote image blocked')
      }
    }
  })
}

export function safeMailHtml(html: string): string {
  installHooks()
  return DOMPurify.sanitize(html || '', {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style'],
  })
}
