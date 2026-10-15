export type SenderGroupingKind =
  | 'message'
  | 'day'
  | 'call'
  | 'system'
  | null

export type SenderGroupingInput = {
  isRoom: boolean
  isOwn: boolean
  senderId: string
  previousKind: SenderGroupingKind
  previousSenderId: string | null
}

export function shouldShowRoomSenderLabel({
  isRoom,
  isOwn,
  senderId,
  previousKind,
  previousSenderId,
}: SenderGroupingInput) {
  return (
    isRoom &&
    !isOwn &&
    (
      previousKind !== 'message' ||
      previousSenderId !== senderId
    )
  )
}
