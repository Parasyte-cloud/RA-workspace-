import { useEffect, useRef, useState } from 'react'
import { BellRing, Eye, KeyRound, Lock, ShieldAlert, Trash2 } from 'lucide-react'
import ConfidentialViewer from './ConfidentialViewer'
import { callVault, requestAccess } from './vaultApi'
import type { Opened, VaultReply } from './vaultApi'
import { VIEWED_NOTE, cardState, formatKey, normalizeKeyInput, viewLabel, KEY_LENGTH } from './vaultFormat'
import type { VaultItem } from './vaultFormat'

type Props = {
  item: VaultItem | undefined
  me: string
  nameOf: (id: string) => string
  onDelete: () => void
  onNotice: (text: string) => void
}

function clock(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// The locked card that stands in the chat for a confidential message. The
// blurred block is a drawing, not the message: the content is not in the page.
export default function ConfidentialCard({ item, me, nameOf, onDelete, onNotice }: Props) {
  const [entryOpen, setEntryOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [asked, setAsked] = useState(false)
  const [viewing, setViewing] = useState<Opened | null>(null)
  const [ended, setEnded] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const state = cardState(item, me)
  const noun = item?.kind === 'file' ? 'document' : 'message'

  useEffect(() => { if (entryOpen) inputRef.current?.focus() }, [entryOpen])

  const deliver = async (reply: VaultReply<Opened>, itemId: string): Promise<boolean> => {
    if (reply.ok) {
      setViewing(reply)
      setEntryOpen(false)
      setTyped('')
      setProblem('')
      return true
    }
    // The key worked but the content did not come through: the window is still
    // open on the server, so carry on with it instead of losing the view.
    if (reply.code === 'deliver_failed') {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 900))
        const again = await callVault<Opened>('resume', { item_id: itemId })
        if (again.ok) {
          setViewing(again)
          setEntryOpen(false)
          setTyped('')
          return true
        }
      }
    }
    setProblem(reply.error)
    return false
  }

  const submitKey = async () => {
    if (!item || busy) return
    if (typed.length < KEY_LENGTH) { setProblem(`Enter all ${KEY_LENGTH} characters of the key.`); return }
    setBusy(true)
    setProblem('')
    const reply = await callVault<Opened>('reveal', { item_id: item.id, key: typed })
    await deliver(reply, item.id)
    setBusy(false)
  }

  const resume = async () => {
    if (!item || busy) return
    setBusy(true)
    const reply = await callVault<Opened>('resume', { item_id: item.id })
    if (!reply.ok) onNotice(reply.error)
    else setViewing(reply)
    setBusy(false)
  }

  const ask = async () => {
    if (!item || busy) return
    setBusy(true)
    const failure = await requestAccess(item.id)
    setBusy(false)
    if (failure) onNotice(failure)
    else setAsked(true)
  }

  const decoy = (
    <div className="vcDecoy" aria-hidden="true">
      <i /><i /><i /><i />
    </div>
  )

  const opener = item?.opened_by ? nameOf(item.opened_by) : 'someone'

  return (
    <div className={`vcCard ${state}`}>
      <div className="vcTop">
        <span className="vcBadge"><Lock size={14} /> Confidential {noun}</span>
        {item && state !== 'loading' && <span className="vcTime">{viewLabel(item.view_seconds)} once opened</span>}
      </div>
      {decoy}

      {state === 'loading' && <p className="vcNote">Checking...</p>}
      {state === 'pending' && <p className="vcNote">Uploading securely...</p>}

      {state === 'sealed' && (
        <>
          <p className="vcNote">Locked. It opens once, with a key from the sender.</p>
          <div className="vcActions">
            <button type="button" className="vcPrimary" onClick={() => { setEntryOpen(open => !open); setProblem('') }}>
              <KeyRound size={15} /> Enter key
            </button>
            <button type="button" className="vcGhost" disabled={busy || asked} onClick={() => void ask()}>
              <BellRing size={15} /> {asked ? 'Requested' : 'Request key'}
            </button>
          </div>
          {asked && <p className="vcSmall">The sender and the administrators were told.</p>}
        </>
      )}

      {state === 'window' && (
        <>
          <p className="vcNote">Your view time is still running.</p>
          <div className="vcActions">
            <button type="button" className="vcPrimary" disabled={busy} onClick={() => void resume()}>
              <Eye size={15} /> Continue viewing
            </button>
          </div>
        </>
      )}

      {state === 'viewed' && (
        <>
          <p className="vcNote">
            {item?.opened_at ? `Viewed by ${opener} at ${clock(item.opened_at)}. ` : 'Already viewed. '}
            {VIEWED_NOTE}
          </p>
          <div className="vcActions">
            <button type="button" className="vcGhost" disabled={busy || asked} onClick={() => void ask()}>
              <BellRing size={15} /> {asked ? 'Administrators told' : 'Ask an administrator'}
            </button>
          </div>
        </>
      )}

      {state === 'blocked' && (
        <>
          <p className="vcNote vcWarn"><ShieldAlert size={14} /> Locked after too many wrong keys. Contact an administrator.</p>
          <div className="vcActions">
            <button type="button" className="vcGhost" disabled={busy || asked} onClick={() => void ask()}>
              <BellRing size={15} /> {asked ? 'Administrators told' : 'Ask an administrator'}
            </button>
          </div>
        </>
      )}

      {state === 'mine-sealed' && <p className="vcNote">Sent. Waiting to be opened. Give them the key you were shown.</p>}
      {state === 'mine-viewed' && (
        <p className="vcNote">
          Viewed by {opener}{item?.opened_at ? ` at ${clock(item.opened_at)}` : ''}. It is locked again. Only an administrator can unblock it.
        </p>
      )}
      {state === 'mine-blocked' && <p className="vcNote vcWarn"><ShieldAlert size={14} /> Locked after too many wrong keys. An administrator can unblock it.</p>}
      {(state === 'mine-sealed' || state === 'mine-viewed' || state === 'mine-blocked') && (
        <div className="vcActions">
          <button type="button" className="vcGhost" onClick={onDelete}><Trash2 size={15} /> Delete for everyone</button>
        </div>
      )}

      {ended && <p className="vcEnded">{ended}</p>}

      {entryOpen && state === 'sealed' && (
        <form
          className="vcEntry"
          onSubmit={event => { event.preventDefault(); void submitKey() }}
        >
          <label htmlFor={`vc-key-${item?.id}`}>Key</label>
          <input
            id={`vc-key-${item?.id}`}
            ref={inputRef}
            value={formatKey(typed)}
            onChange={event => { setTyped(normalizeKeyInput(event.target.value)); setProblem('') }}
            onPaste={event => {
              event.preventDefault()
              setTyped(normalizeKeyInput(event.clipboardData.getData('text')))
            }}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={KEY_LENGTH + 2}
            aria-invalid={problem ? true : undefined}
          />
          <button type="submit" className="vcPrimary" disabled={busy || typed.length < KEY_LENGTH}>
            {busy ? 'Checking...' : `Open for ${viewLabel(item?.view_seconds || 60)}`}
          </button>
          {problem && <p className="vcProblem" role="alert">{problem}</p>}
          <p className="vcSmall">It opens once. The time starts when you press Open.</p>
        </form>
      )}

      {viewing && (
        <ConfidentialViewer
          opened={viewing}
          onClose={reason => {
            setViewing(null)
            setEnded(reason === 'expired' ? 'Time is up. It is locked again.' : 'Closed. It is locked again.')
          }}
        />
      )}
    </div>
  )
}
