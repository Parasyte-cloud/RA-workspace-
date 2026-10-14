import type {
  ReactNode,
  Ref,
  UIEventHandler,
} from 'react'

type MessageTimelineProps = {
  children: ReactNode
  scrollRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
}

export function MessageTimeline({
  children,
  scrollRef,
  onScroll,
}: MessageTimelineProps) {
  return (
    <div
      className="cmMessages"
      ref={scrollRef}
      onScroll={onScroll}
      aria-live="polite"
    >
      {children}
    </div>
  )
}
