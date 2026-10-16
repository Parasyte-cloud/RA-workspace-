export type MentionSuggestionPerson = {
  userId: string
  name: string
  email?: string
}

type MentionSuggestionsProps = {
  members: MentionSuggestionPerson[]
  activeIndex: number
  onSelect: (
    member: MentionSuggestionPerson,
  ) => void
}

export function MentionSuggestions({
  members,
  activeIndex,
  onSelect,
}: MentionSuggestionsProps) {
  if (!members.length) {
    return null
  }

  return (
    <div
      className="cmMentionSuggestions"
      role="listbox"
      aria-label="Mention a room member"
    >
      {members.map((member, index) => (
        <button
          key={member.userId}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={
            index === activeIndex
              ? 'active'
              : ''
          }
          onMouseDown={event => {
            event.preventDefault()
            onSelect(member)
          }}
        >
          <span className={`cmMentionAvatar${member.userId.startsWith('*') ? ' broadcast' : ''}`}>
            {member.name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map(part =>
                part[0]?.toUpperCase(),
              )
              .join('') || 'RA'}
          </span>

          <span className="cmMentionPerson">
            <strong>{member.name}</strong>

            {member.email && (
              <small>{member.email}</small>
            )}
          </span>

          <span className="cmMentionAt">
            @
          </span>
        </button>
      ))}
    </div>
  )
}
