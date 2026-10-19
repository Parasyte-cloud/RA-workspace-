(() => {
  const host = window.location.hostname.toLowerCase()
  if (host !== 'support.ridearrivo.com') return

  document.documentElement.classList.add('supportDomain')
  document.title = 'RideArrivo Support'

  const upsertLink = (rel, href, attrs = {}) => {
    let el = document.head.querySelector(`link[rel="${rel}"]`)
    if (!el) {
      el = document.createElement('link')
      el.rel = rel
      document.head.appendChild(el)
    }
    el.href = href
    Object.entries(attrs).forEach(([key, value]) => {
      el.setAttribute(key, value)
    })
  }

  const upsertMeta = (attr, key, content) => {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`)
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute(attr, key)
      document.head.appendChild(el)
    }
    el.setAttribute('content', content)
  }

  upsertLink(
    'manifest',
    '/brand/support/support.webmanifest'
  )

  upsertLink(
    'icon',
    '/brand/support/support-favicon-32.png',
    {
      type: 'image/png',
      sizes: '32x32'
    }
  )

  upsertLink(
    'apple-touch-icon',
    '/brand/support/support-icon-180.png',
    {
      sizes: '180x180'
    }
  )

  upsertMeta('name', 'theme-color', '#07142b')

  upsertMeta('property', 'og:title', 'RideArrivo Support')
  upsertMeta(
    'property',
    'og:description',
    'Secure access to the RideArrivo Support Command Centre.'
  )
  upsertMeta(
    'property',
    'og:image',
    'https://support.ridearrivo.com/brand/support/support-og-1200x630.png'
  )
  upsertMeta(
    'property',
    'og:url',
    'https://support.ridearrivo.com'
  )
  upsertMeta('property', 'og:type', 'website')

  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', 'RideArrivo Support')
  upsertMeta(
    'name',
    'twitter:description',
    'Secure access to the RideArrivo Support Command Centre.'
  )
  upsertMeta(
    'name',
    'twitter:image',
    'https://support.ridearrivo.com/brand/support/support-og-1200x630.png'
  )
})()
