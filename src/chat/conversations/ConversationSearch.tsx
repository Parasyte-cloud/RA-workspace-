import {
  Search,
} from 'lucide-react'

type ConversationSearchProps = {
  value: string
  onChange: (
    value: string,
  ) => void
  placeholder?: string
}

export function ConversationSearch({
  value,
  onChange,
  placeholder =
    'Search conversations',
}: ConversationSearchProps) {
  return (
    <label className="cmSearch">
      <Search size={16} />

      <input
        value={value}
        onChange={event =>
          onChange(
            event.target.value,
          )
        }
        placeholder={placeholder}
        aria-label={
          placeholder
        }
      />
    </label>
  )
}
