import { uniqueOutputs } from './audioRoute'

// What the sound output sheet lists, worked out in one place so the screen
// stays simple and the rules can be tested.
export type OutputKind = 'phone' | 'speaker' | 'headset'

type Device = { deviceId: string; label?: string; groupId?: string }

export type OutputChoice = { id: string; name: string; kind: OutputKind; on: boolean }

const stripPrefix = (label: string) => label.replace(/^(default|communications)\s*-\s*/i, '').trim()

export function outputKind(label: string): OutputKind {
  if (/bluetooth|airpods|headset|headphone|buds|wired|usb|hands-?free/i.test(label)) return 'headset'
  if (/earpiece|receiver|handset/i.test(label)) return 'phone'
  return 'speaker'
}

// Real names, so a desktop with a monitor and laptop speakers shows both. Only
// the two Android phone outputs get FaceTime's words.
export function outputName(label: string, kind: OutputKind): string {
  const clean = stripPrefix(label)
  if (kind === 'phone') return 'Phone'
  if (/speakerphone/i.test(clean)) return 'Speaker'
  return clean || (kind === 'headset' ? 'Headset' : 'Speaker')
}

// Which listed output is playing now. The browser often reports the "default"
// entry as current; the real device is the one that shares its group.
export function outputChoices(all: readonly Device[], current: Device | undefined): OutputChoice[] {
  const real = uniqueOutputs(all).filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications')
  if (!real.length) return []
  const isAlias = (device?: Device) => Boolean(device) && (device?.deviceId === 'default' || device?.deviceId === 'communications')
  let selected = current && !isAlias(current) ? real.find(device => device.deviceId === current.deviceId) : undefined
  if (!selected) {
    const alias = isAlias(current) ? current : all.find(device => device.deviceId === 'default')
    if (alias?.groupId) selected = real.find(device => device.groupId === alias.groupId)
  }
  if (!selected) selected = real[0]
  return real.map(device => {
    const kind = outputKind(device.label || '')
    return { id: device.deviceId, name: outputName(device.label || '', kind), kind, on: device.deviceId === selected?.deviceId }
  })
}

// The Speaker button only appears when it can do something. On iPhone the page
// toggles Phone and Speaker itself; elsewhere it needs at least one real output
// to list. Safari on a Mac lists none, so it has no button instead of a dead one.
export function outputControl(routable: boolean, choices: readonly OutputChoice[]): 'toggle' | 'list' | 'none' {
  if (routable) return 'toggle'
  return choices.length ? 'list' : 'none'
}
