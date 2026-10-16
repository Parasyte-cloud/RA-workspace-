// Turns the AI meeting summary (markdown) into structured notes: decisions,
// action items with an owner and a due date when one is stated, and open
// questions. It works on the headings and bullets the summary already has, so
// it does not depend on one exact format. Written with plain TypeScript only so
// it runs in Deno (the webhook) and in Node (the tests).

export type ActionItem = { body: string; owner: string | null; due: string | null }
export type MeetingNotes = {
  decisions: string[]
  actions: ActionItem[]
  questions: string[]
}

const ACTION_HEAD = /(action|next step|follow[- ]?up|to[- ]?do|assigned|takeaway)/i
const DECISION_HEAD = /(decision|decided|agreed|conclusion|resolved)/i
const QUESTION_HEAD = /(open question|question|unresolved|risk|blocker|issue|concern)/i

const DUE = /\b(?:by|before|due(?: on| by)?|on or before)\s+((?:end of (?:the )?(?:day|week|month|quarter)|eod|eow|tomorrow|today|tonight|next (?:week|month|monday|tuesday|wednesday|thursday|friday)|this (?:week|friday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+[A-Za-z]{3,9}(?:\s+\d{4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?))/i

function clean(line: string): string {
  return line
    .replace(/^\s*(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isBullet(line: string): boolean {
  return /^\s*(?:[-*+•]|\d+[.)])\s+\S/.test(line)
}

function headingText(line: string): string | null {
  const hash = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
  if (hash) return hash[1].replace(/\*\*|__/g, '').trim()
  // A line that is only bold text and ends with a colon also acts as a heading.
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(line)
  if (bold) return bold[1].trim()
  const colon = /^\s*([A-Z][A-Za-z /&-]{2,40}):\s*$/.exec(line)
  if (colon) return colon[1].trim()
  return null
}

function ownerOf(text: string): { owner: string | null; body: string } {
  // "Owner: task", "Owner - task"
  let match = /^([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,2})\s*[:–-]\s+(.+)$/u.exec(text)
  if (match && match[2].length > 3 && !/^(action|note|decision|next|todo|to do|follow)/i.test(match[1])) {
    return { owner: match[1], body: match[2] }
  }
  // "(Owner: Name)" or "[Name]" or "- Name" at the end
  match = /\((?:owner|assignee|assigned to|responsible)\s*:\s*([^)]+)\)/i.exec(text)
  if (match) return { owner: match[1].trim(), body: text.replace(match[0], '').replace(/\s+/g, ' ').trim() }
  match = /@([\p{L}][\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*)?)/u.exec(text)
  if (match) return { owner: match[1], body: text }
  // "Name will/to/should/needs to/is going to ..."
  match = /^([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,2})\s+(?:will|to|should|must|needs? to|is going to|agreed to|volunteered to|has to)\s+/u.exec(text)
  if (match && !/^(The|This|That|We|They|Team|Everyone|Someone|It|There)\b/.test(match[1])) {
    return { owner: match[1], body: text }
  }
  return { owner: null, body: text }
}

export function parseMeetingNotes(markdown: string): MeetingNotes {
  const out: MeetingNotes = { decisions: [], actions: [], questions: [] }
  if (typeof markdown !== 'string' || !markdown.trim()) return out

  let mode: 'none' | 'action' | 'decision' | 'question' | 'other' = 'none'
  const lines = markdown.split(/\r?\n/)
  const seen = new Set<string>()

  for (const raw of lines) {
    if (!raw.trim()) continue
    const head = headingText(raw)
    if (head !== null && !isBullet(raw)) {
      if (ACTION_HEAD.test(head)) mode = 'action'
      else if (DECISION_HEAD.test(head)) mode = 'decision'
      else if (QUESTION_HEAD.test(head)) mode = 'question'
      else mode = 'other'
      continue
    }

    const text = clean(raw)
    if (text.length < 4) continue
    const key = `${mode}:${text.toLowerCase()}`
    if (seen.has(key)) continue

    if (mode === 'action' && (isBullet(raw) || /^\s*\[[ xX]\]/.test(raw))) {
      seen.add(key)
      const { owner, body } = ownerOf(text)
      const due = DUE.exec(body)
      out.actions.push({
        body: body.slice(0, 1000),
        owner: owner ? owner.slice(0, 120) : null,
        due: due ? due[1].slice(0, 120) : null,
      })
    } else if (mode === 'decision' && isBullet(raw)) {
      seen.add(key)
      out.decisions.push(text.slice(0, 1000))
    } else if (mode === 'question' && isBullet(raw)) {
      seen.add(key)
      out.questions.push(text.slice(0, 1000))
    } else if (mode === 'other' && isBullet(raw) && /^(?:action item|todo|to-do)\s*[:\-]/i.test(text)) {
      // An explicit "Action item:" bullet inside another section still counts.
      seen.add(key)
      const stripped = text.replace(/^(?:action item|todo|to-do)\s*[:\-]\s*/i, '')
      const { owner, body } = ownerOf(stripped)
      const due = DUE.exec(body)
      out.actions.push({ body: body.slice(0, 1000), owner, due: due ? due[1] : null })
    }
  }

  out.actions = out.actions.slice(0, 60)
  out.decisions = out.decisions.slice(0, 60)
  out.questions = out.questions.slice(0, 60)
  return out
}

// Finds who an action item belongs to among the people who were in the meeting.
// Exact full name wins; otherwise a first name only counts when exactly one
// attendee has it, so two people called Sam never get each other's tasks.
export function matchOwner(
  owner: string | null,
  attendees: { user_id: string; display_name: string }[],
): string | null {
  if (!owner) return null
  const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim()
  const wanted = norm(owner)
  if (!wanted) return null
  const exact = attendees.filter(a => norm(a.display_name) === wanted)
  if (exact.length === 1) return exact[0].user_id
  if (exact.length > 1) return null
  const first = wanted.split(' ')[0]
  const byFirst = attendees.filter(a => norm(a.display_name).split(' ')[0] === first)
  return byFirst.length === 1 ? byFirst[0].user_id : null
}
