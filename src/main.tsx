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

function isPublicRoom7Surface() {
  if (
    window.location.hostname.toLowerCase() ===
    'room7.ridearrivo.com'
  ) {
    return true
  }

  if (
    import.meta.env.DEV &&
    new URLSearchParams(
      window.location.search,
    ).get('surface') === 'room7-public'
  ) {
    return true
  }

  return false
}

function EntryLoading({
  publicRoom7,
}: {
  publicRoom7: boolean
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background:
          publicRoom7
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
      {publicRoom7
        ? 'Opening RideArrivo ROOM 7'
        : 'Opening RideArrivo Workspace'}
    </div>
  )
}

const publicRoom7 =
  isPublicRoom7Surface()

ReactDOM.createRoot(
  document.getElementById('root')!,
).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <EntryLoading
          publicRoom7={publicRoom7}
        />
      }
    >
      {publicRoom7
        ? <ExternalRoom7App />
        : <InternalApp />}
    </Suspense>
  </React.StrictMode>,
)
