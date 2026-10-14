import { useState } from 'react'

export function useMessages<T>() {
  const [
    messages,
    setMessages,
  ] = useState<T[]>([])

  return {
    messages,
    setMessages,
  }
}
