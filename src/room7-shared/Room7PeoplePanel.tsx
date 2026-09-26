import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LoaderCircle,
  Mic,
  MicOff,
  UserMinus,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react'
import type { useRealtimeKitClient } from '@cloudflare/realtimekit-react'
import './room7-people-panel.css'

/*
 * ROOM 7 people panel for the meeting creator and administrators.
 *
 * Mute and video off go through RealtimeKit directly and need the
 * "disable participant audio/video" permissions on the host preset. The
 * person can turn them back on themselves, the same as Meet and Zoom.
 *
 * Remove goes through the server (room-session "remove"): it checks that
 * the caller is the creator or an administrator, kicks the person, and
 * blocks them from rejoining until someone lets them back in.
 */

type Meeting = NonNullable<ReturnType<typeof useRealtimeKitClient>[0]>

type Peer = {
  id: string
  userId?: string
  name: string
  customParticipantId?: string
  audioEnabled: boolean
  videoEnabled: boolean
  presetName?: string
  disableAudio: () => Promise<void>
  disableVideo: () => Promise<void>
}

type Person = {
  key: string
  target: string
  name: string
  isGuest: boolean
  isCreator: boolean
  audio: boolean
  video: boolean
  peers: Peer[]
}

export type RemovedPerson = {
  target: string
  name: string
  kind: 'staff' | 'guest'
  removed_at: string
}

export type Room7Moderation = {
  remove: (target: string) => Promise<void>
  readmit: (target: string) => Promise<void>
  listRemoved: () => Promise<RemovedPerson[]>
}

function joinedPeers(meeting: Meeting): Peer[] {
  const joined = meeting.participants?.joined as unknown as {
    toArray?: () => Peer[]
    values?: () => Iterable<Peer>
  }
  if (joined?.toArray) return joined.toArray()
  if (joined?.values) return Array.from(joined.values())
  return []
}

function groupPeople(peers: Peer[], creatorId: string): Person[] {
  // One row per person. A stale second connection of the same person has
  // the same custom id, so it folds into their row instead of showing twice.
  const people = new Map<string, Person>()
  for (const peer of peers) {
    const target = peer.customParticipantId || ''
    const key = target || peer.userId || peer.id
    const existing = people.get(key)
    if (existing) {
      existing.peers.push(peer)
      existing.audio = existing.audio || peer.audioEnabled
      existing.video = existing.video || peer.videoEnabled
      continue
    }
    people.set(key, {
      key,
      target,
      name: peer.name || 'Participant',
      isGuest: target.startsWith('guest:'),
      isCreator: Boolean(target) && target === creatorId,
      audio: Boolean(peer.audioEnabled),
      video: Boolean(peer.videoEnabled),
      peers: [peer],
    })
  }
  return Array.from(people.values()).sort((a, b) =>
    Number(b.isCreator) - Number(a.isCreator) || a.name.localeCompare(b.name),
  )
}

export function Room7PeopleButton({
  open,
  count,
  onToggle,
}: {
  open: boolean
  count: number
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`r7xButton ${open ? 'active' : ''}`}
      aria-pressed={open}
      onClick={onToggle}
      title={open ? 'Close people' : 'Manage people in this call'}
    >
      <Users size={16} />
      <span>People</span>
      {count > 0 && <b className="r7pCount">{count}</b>}
    </button>
  )
}

export function useJoinedCount(meeting: Meeting | null | undefined) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!meeting) {
      setCount(0)
      return
    }
    const update = () => {
      const peers = joinedPeers(meeting)
      const keys = new Set(peers.map(peer => peer.customParticipantId || peer.id))
      setCount(keys.size + 1)
    }
    update()
    const timer = window.setInterval(update, 2000)
    return () => window.clearInterval(timer)
  }, [meeting])
  return count
}

export function Room7PeoplePanel({
  meeting,
  creatorId,
  selfTarget,
  moderation,
  onClose,
}: {
  meeting: Meeting
  creatorId: string
  selfTarget: string
  moderation: Room7Moderation
  onClose: () => void
}) {
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removed, setRemoved] = useState<RemovedPerson[]>([])

  // Peer mic/camera state changes constantly; a light poll keeps the list
  // honest without wiring a listener per participant.
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 1500)
    return () => window.clearInterval(timer)
  }, [])

  const refreshRemoved = useCallback(async () => {
    try {
      setRemoved(await moderation.listRemoved())
    } catch {
      // The live list still works; the removed list is a convenience.
    }
  }, [moderation])

  useEffect(() => {
    void refreshRemoved()
  }, [refreshRemoved])

  const people = useMemo(
    () => groupPeople(joinedPeers(meeting), creatorId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meeting, creatorId, tick],
  )

  const permissions = meeting.self?.permissions as unknown as {
    canDisableParticipantAudio?: boolean
    canDisableParticipantVideo?: boolean
  } | undefined
  const canMute = Boolean(permissions?.canDisableParticipantAudio)
  const canStopVideo = Boolean(permissions?.canDisableParticipantVideo)

  const run = async (key: string, task: () => Promise<void>, done: string) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await task()
      setNotice(done)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.')
    } finally {
      setBusy('')
    }
  }

  const muteAll = () =>
    run('mute-all', () => meeting.participants.disableAllAudio(true), 'Everyone else is muted. They can unmute themselves.')

  const stopAllVideo = () =>
    run('video-all', () => meeting.participants.disableAllVideo(), 'Everyone else has their video turned off.')

  const mute = (person: Person) =>
    run(`mute:${person.key}`, async () => {
      await Promise.all(person.peers.map(peer => peer.disableAudio()))
    }, `${person.name} is muted.`)

  const stopVideo = (person: Person) =>
    run(`video:${person.key}`, async () => {
      await Promise.all(person.peers.map(peer => peer.disableVideo()))
    }, `${person.name}'s video is off.`)

  const remove = (person: Person) =>
    run(`remove:${person.key}`, async () => {
      await moderation.remove(person.target)
      setConfirming('')
      await refreshRemoved()
    }, `${person.name} was removed and cannot rejoin until you let them back in.`)

  const readmit = (person: RemovedPerson) =>
    run(`readmit:${person.target}`, async () => {
      await moderation.readmit(person.target)
      await refreshRemoved()
    }, `${person.name} can join again.`)

  return (
    <aside className="r7pPanel" role="dialog" aria-label="People in this call">
      <header>
        <div>
          <Users size={16} />
          <strong>People ({people.length + 1})</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close people" title="Close">
          <X size={16} />
        </button>
      </header>

      {(canMute || canStopVideo) && people.length > 0 && (
        <div className="r7pBulk">
          {canMute && (
            <button type="button" disabled={Boolean(busy)} onClick={() => void muteAll()}>
              {busy === 'mute-all' ? <LoaderCircle size={14} className="r7pSpin" /> : <MicOff size={14} />}
              Mute all
            </button>
          )}
          {canStopVideo && (
            <button type="button" disabled={Boolean(busy)} onClick={() => void stopAllVideo()}>
              {busy === 'video-all' ? <LoaderCircle size={14} className="r7pSpin" /> : <VideoOff size={14} />}
              Stop all video
            </button>
          )}
        </div>
      )}

      {!canMute && !canStopVideo && (
        <p className="r7pHint">
          Muting others is switched off for your call role. Remove still works.
        </p>
      )}

      {error && <p className="r7pError" role="alert">{error}</p>}
      {notice && <p className="r7pNotice" role="status">{notice}</p>}

      <ul className="r7pList">
        <li className="r7pSelf">
          <span className="r7pName">{meeting.self?.name || 'You'} <em>(you)</em></span>
        </li>

        {people.map(person => {
          const removable = Boolean(person.target) && !person.isCreator && person.target !== selfTarget
          const askingToRemove = confirming === person.key
          return (
            <li key={person.key}>
              <span className="r7pName">
                {person.name}
                {person.isCreator && <em>Host</em>}
                {person.isGuest && <em>Guest</em>}
              </span>

              {askingToRemove ? (
                <span className="r7pConfirm">
                  <span>Remove and block from rejoining?</span>
                  <button
                    type="button"
                    className="r7pDanger"
                    disabled={Boolean(busy)}
                    onClick={() => void remove(person)}
                  >
                    {busy === `remove:${person.key}` ? <LoaderCircle size={14} className="r7pSpin" /> : null}
                    Remove
                  </button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => setConfirming('')}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="r7pActions">
                  {canMute && (
                    <button
                      type="button"
                      disabled={!person.audio || Boolean(busy)}
                      onClick={() => void mute(person)}
                      title={person.audio ? `Mute ${person.name}` : 'Already muted'}
                      aria-label={person.audio ? `Mute ${person.name}` : `${person.name} is muted`}
                    >
                      {person.audio ? <Mic size={15} /> : <MicOff size={15} />}
                    </button>
                  )}
                  {canStopVideo && (
                    <button
                      type="button"
                      disabled={!person.video || Boolean(busy)}
                      onClick={() => void stopVideo(person)}
                      title={person.video ? `Turn off ${person.name}'s video` : 'Video is off'}
                      aria-label={person.video ? `Turn off ${person.name}'s video` : `${person.name}'s video is off`}
                    >
                      {person.video ? <Video size={15} /> : <VideoOff size={15} />}
                    </button>
                  )}
                  {removable && (
                    <button
                      type="button"
                      className="r7pDanger"
                      disabled={Boolean(busy)}
                      onClick={() => setConfirming(person.key)}
                      title={`Remove ${person.name}`}
                      aria-label={`Remove ${person.name}`}
                    >
                      <UserMinus size={15} />
                    </button>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {removed.length > 0 && (
        <section className="r7pRemoved">
          <h4>Removed</h4>
          <ul className="r7pList">
            {removed.map(person => (
              <li key={person.target}>
                <span className="r7pName">
                  {person.name}
                  {person.kind === 'guest' && <em>Guest</em>}
                </span>
                <span className="r7pActions">
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void readmit(person)}
                    title={`Let ${person.name} back in`}
                  >
                    {busy === `readmit:${person.target}` ? <LoaderCircle size={14} className="r7pSpin" /> : <UserPlus size={14} />}
                    Let back in
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
