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

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
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
          <button
            type="button"
            className="glassButton"
            onClick={()=>this.setState({error:null})}
          >
            <RotateCcw size={15}/>
            Retry section
          </button>
        </div>
      </section>
    )
  }
}
