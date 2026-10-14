import type {
  FormEventHandler,
  ReactNode,
} from 'react'

export type MessageSendState =
  | 'sending'
  | 'sent'
  | 'failed'

type MessageComposerProps = {
  children: ReactNode
  sendState: MessageSendState
  onRetry: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  hidden?: boolean
  showRetry?: boolean
}

export function MessageComposer({
  children,
  sendState,
  onRetry,
  onSubmit,
  hidden,
  showRetry = false,
}: MessageComposerProps) {
  return (
    <form
      className="cmComposer"
      data-send-state={sendState}
      onSubmit={onSubmit}
      hidden={hidden}
    >
      {children}

      {showRetry &&
        sendState === 'failed' && (
          <button
            type="button"
            className="cmRetry"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
    </form>
  )
}
