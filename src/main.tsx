import React, {
  lazy,
  Suspense,
} from 'react'
import ReactDOM from 'react-dom/client'

const InternalApp = lazy(
  () => import('./InternalApp'),
)

const ExternalRoom7App = lazy(
  () => import('./room7-public/ExternalRoom7App'),
)

const FormsApp = lazy(
  () => import('./forms-public/FormsApp'),
)

function isPublicFormsSurface() {
  const hostname =
    window.location.hostname
      .toLowerCase()

  if (
    hostname ===
    'forms.ridearrivo.com'
  ) {
    return true
  }

  const requested =
    new URLSearchParams(
      window.location.search,
    ).get('surface') ===
    'forms-public'

  if (
    requested &&
    (
      import.meta.env.DEV ||
      hostname.endsWith(
        '.ra-workspace.pages.dev',
      )
    )
  ) {
    return true
  }

  return false
}

function isPublicRoom7Surface() {
  if (
    window.location.hostname
      .toLowerCase() ===
    'room7.ridearrivo.com'
  ) {
    return true
  }

  if (
    import.meta.env.DEV &&
    new URLSearchParams(
      window.location.search,
    ).get('surface') ===
      'room7-public'
  ) {
    return true
  }

  return false
}

function EntryLoading({
  publicRoom7,
  publicForms,
}: {
  publicRoom7: boolean
  publicForms: boolean
}) {
  const publicSurface =
    publicRoom7 ||
    publicForms

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background:
          publicSurface
            ? '#07111f'
            : '#0b1411',
        color: '#f5f7fa',
        fontFamily:
          'Inter, system-ui, sans-serif',
        fontSize: '12px',
        letterSpacing: '.12em',
        textTransform: 'uppercase',
      }}
    >
      {publicForms
        ? 'Opening RideArrivo Forms'
        : publicRoom7
          ? 'Opening RideArrivo ROOM 7'
          : 'Opening RideArrivo Workspace'}
    </div>
  )
}

const publicForms =
  isPublicFormsSurface()

const publicRoom7 =
  !publicForms &&
  isPublicRoom7Surface()

ReactDOM.createRoot(
  document.getElementById('root')!,
).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <EntryLoading
          publicRoom7={publicRoom7}
          publicForms={publicForms}
        />
      }
    >
      {publicForms
        ? <FormsApp />
        : publicRoom7
          ? <ExternalRoom7App />
          : <InternalApp />}
    </Suspense>
  </React.StrictMode>,
)
