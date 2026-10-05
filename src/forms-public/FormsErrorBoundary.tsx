import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { failed: boolean }

/*
 * Last line of defence for the public forms surfaces. Without it, one
 * render error leaves a visitor on a blank page with no way forward.
 * Deliberately dependency free: it must still render if a form chunk or
 * the icon library is what failed.
 */
export default class FormsErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RideArrivo Forms] render failure', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="formsPage">
        <section className="formsShell formsSuccessShell">
          <div className="formsSuccess" role="alert">
            <span className="formsEyebrow">SOMETHING WENT WRONG</span>
            <h1>This page could not be displayed.</h1>
            <p>Nothing you typed has been sent. Reload the page and try again.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </section>
      </main>
    )
  }
}
