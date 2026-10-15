import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

type Props = {
  children: ReactNode
  resetKey: string
}

type State = {
  error: Error | null
}

export function isStaleBuildError(error: unknown) {
  const text = `${(error as Error)?.name || ''} ${(error as Error)?.message || ''}`
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed/i.test(text)
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A page that was deployed after this tab loaded points at files that no
    // longer exist. Reloading once picks up the new build. The flag stops a
    // reload loop if the problem is something else.
    if (isStaleBuildError(error)) {
      try {
        const key = 'ra-stale-build-reload'
        const last = Number(sessionStorage.getItem(key) || 0)
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem(key, String(Date.now()))
          window.location.reload()
          return
        }
      } catch (_) { /* storage blocked: fall through to the retry card */ }
    }
    console.error(
      '[RideArrivo Route] workspace module crashed',
      error,
      info.componentStack
    )
  }

  componentDidUpdate(previousProps: Props) {
    if (
      this.state.error &&
      previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <section className="routeFailure glassCard" role="alert">
        <AlertTriangle size={22}/>
        <div>
          <strong>This workspace section could not be displayed.</strong>
          <p>
            The RideArrivo shell is still running. Retry this section; if the
            problem continues, Support can use the browser console error and
            timestamp to investigate without losing the rest of the workspace.
          </p>
          <p className="routeFailureDetail">
            {this.state.error.name}: {this.state.error.message.slice(0, 240)}
          </p>
          <button
            type="button"
            className="glassButton"
            onClick={()=>this.setState({error:null})}
          >
            <RotateCcw size={15}/>
            Retry section
          </button>
          <button
            type="button"
            className="glassButton"
            onClick={()=>window.location.reload()}
          >
            Reload app
          </button>
        </div>
      </section>
    )
  }
}
