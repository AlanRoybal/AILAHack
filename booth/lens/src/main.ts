import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ImuReportPace,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { Tilt } from './tilt.ts'

interface Brief { company: string; match: number; role: string; rep: string; points: string[] }
interface Followup { phase: string; heard: string; rep: string; matched: boolean; to?: string; sendAt?: number; error?: string }
interface State { briefs: Brief[]; prep?: { endedAt?: number; error?: string }; followups: Record<string, Followup>; now: number }

const ROWS = 6
const LISTEN_MS = 5000
const CANCEL_GAP_MS = 2500
const $ = (id: string) => document.getElementById(id)!

let state: State = { briefs: [], followups: {}, now: Date.now() }
let skew = 0
let screen: 'list' | 'brief' | 'listen' = 'list'
let cursor = 0
let shown = ''
let pcm: Uint8Array[] = []
let listenTimer = 0
let leftAt = 0

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)
const brief = () => state.briefs[cursor]
const followup = () => (brief() ? state.followups[brief().company] : undefined)
const api = (path: string, init?: RequestInit) => fetch(`/api${path}?company=${encodeURIComponent(brief().company)}`, { method: 'POST', ...init })

function listText() {
  if (!state.briefs.length) {
    const p = state.prep
    if (!p) return 'BOOTH BRIEF\n\nNo briefs yet.\nStart prep on the laptop.'
    if (p.error) return `BOOTH BRIEF\n\nCREAO run failed:\n${cut(p.error, 60)}`
    return p.endedAt ? 'BOOTH BRIEF\n\nNo sponsors matched.' : 'BOOTH BRIEF\n\nCREAO is researching\nthe LA Hacks sponsors...'
  }
  const top = Math.min(Math.max(0, cursor - ROWS + 1), Math.max(0, state.briefs.length - ROWS))
  const rows = state.briefs.slice(top, top + ROWS).map((b, i) => {
    const sent = state.followups[b.company]?.phase === 'sent' ? ' +' : ''
    return `${top + i === cursor ? '>' : ' '} ${String(b.match).padStart(2)}  ${cut(b.company, 22)}${sent}`
  })
  return `SPONSORS BY FIT  ${cursor + 1}/${state.briefs.length}\n${rows.join('\n')}`
}

function footer(f?: Followup): string[] {
  if (!f) return ['Tap after you meet them']
  const who = cut(f.rep, 20)
  switch (f.phase) {
    case 'drafting': return [`Rep: ${who}${f.matched ? '' : ' (?)'}`, 'CREAO: Apollo + draft...']
    case 'countdown': {
      const s = Math.max(0, Math.ceil(((f.sendAt ?? 0) - (Date.now() + skew)) / 1000))
      return [`Sending to ${who} in ${s}s`, 'Tilt left, then right: cancel']
    }
    case 'sending': return [`CREAO sending to ${who}...`]
    case 'sent': return [`Sent: ${cut(f.to ?? '', 26)}`]
    case 'cancelled': return ['Cancelled. Tap to redo']
    default: return [cut(`Failed: ${f.error ?? ''}`, 34), 'Tap to retry']
  }
}

function briefText() {
  const b = brief()
  if (screen === 'listen') return `${cut(b.company, 24)}\n\nSay their name now\n\nTap when done`
  return [
    `${cut(b.company, 20)}  fit ${b.match}`,
    cut(b.role, 34),
    cut(`Ask for: ${b.rep}`, 34),
    ...b.points.slice(0, 3).map(p => `- ${cut(p, 32)}`),
    ...footer(followup()),
  ].join('\n')
}

const text = () => (screen !== 'list' && brief() ? briefText() : listText())

const bridge = await waitForEvenAppBridge()
await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 288,
        borderWidth: 0, borderColor: 5, paddingLength: 6,
        containerID: 1, containerName: 'body', content: text(), isEventCapture: 1,
      }),
    ],
  }),
)

async function render() {
  const t = text()
  $('lens').textContent = t
  if (t === shown) return
  shown = t
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'body', content: t }))
}

async function poll() {
  try {
    state = await (await fetch('/api/state')).json()
    skew = state.now - Date.now()
    cursor = Math.min(cursor, Math.max(0, state.briefs.length - 1))
  } catch {}
  if (followup()?.phase === 'countdown') tilt.arm()
  await render()
}

const warn = (what: string) => (err: unknown) => console.warn(`${what} failed`, err)

function startListen() {
  screen = 'listen'
  pcm = []
  bridge.audioControl(true, AudioInputSource.Glasses).catch(warn('audio'))
  listenTimer = window.setTimeout(() => void stopListen(), LISTEN_MS)
}

async function stopListen() {
  clearTimeout(listenTimer)
  bridge.audioControl(false, AudioInputSource.Glasses).catch(warn('audio'))
  screen = 'brief'
  const len = pcm.reduce((n, c) => n + c.length, 0)
  const body = new Uint8Array(len)
  pcm.reduce((o, c) => (body.set(c, o), o + c.length), 0)
  await render()
  if (len) await api('/name', { body, headers: { 'content-type': 'application/octet-stream' } })
}

async function sendTypedName(name: string) {
  if (!brief() || !name.trim()) return
  clearTimeout(listenTimer)
  bridge.audioControl(false, AudioInputSource.Glasses).catch(warn('audio'))
  screen = 'brief'
  await api('/name', { body: JSON.stringify({ text: name }), headers: { 'content-type': 'application/json' } })
  await poll()
}

// Left then right within CANCEL_GAP_MS cancels a pending send.
const tilt = new Tilt(
  dir => {
    if (dir === -1) leftAt = Date.now()
    else if (Date.now() - leftAt < CANCEL_GAP_MS && followup()?.phase === 'countdown') {
      leftAt = 0
      void api('/cancel').then(poll)
    }
    tilt.arm()
  },
  lean => ($('lean').textContent = `lean ${lean.toFixed(0)}°`),
)
if (!tilt.calibrated) tilt.calibrate(() => ($('lean').textContent = 'calibrated'))

bridge.imuControl(true, ImuReportPace.P100).catch(warn('imu'))
let realImu = false

const typeOf = (e?: { eventType?: OsEventTypeList }) => (e ? (e.eventType ?? OsEventTypeList.CLICK_EVENT) : null)

bridge.onEvenHubEvent(event => {
  if (event.audioEvent?.audioPcm) {
    if (screen === 'listen') pcm.push(event.audioEvent.audioPcm)
    return
  }
  const sysEv = event.sysEvent
  if (sysEv?.eventType === OsEventTypeList.IMU_DATA_REPORT && sysEv.imuData) {
    realImu = true
    const { x = 0, y = 0, z = 0 } = sysEv.imuData
    tilt.feed(x, y, z)
    return
  }
  const sys = typeOf(sysEv)
  const txt = typeOf(event.textEvent)
  const is = (t: OsEventTypeList) => sys === t || txt === t
  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    if (screen === 'listen') return void stopListen()
    if (screen === 'brief') screen = 'list'
    else bridge.shutDownPageContainer(1)
  } else if (txt === OsEventTypeList.SCROLL_TOP_EVENT && screen === 'list') cursor = Math.max(0, cursor - 1)
  else if (txt === OsEventTypeList.SCROLL_BOTTOM_EVENT && screen === 'list') cursor = Math.min(state.briefs.length - 1, cursor + 1)
  else if (is(OsEventTypeList.CLICK_EVENT)) {
    if (screen === 'list' && state.briefs.length) screen = 'brief'
    else if (screen === 'listen') return void stopListen()
    else if (screen === 'brief') {
      const f = followup()
      if (!f || f.phase === 'cancelled' || f.phase === 'failed') startListen()
    }
  } else return
  void render()
})

// Phone page: typed name when the mic is unavailable, simulated head for the simulator (no IMU there).
const name = $('name') as HTMLInputElement
$('nameGo').onclick = () => void sendTypedName(name.value)
let headTarget = 0
let headDeg = 0
document.querySelectorAll<HTMLButtonElement>('[data-lean]').forEach(b => {
  b.onclick = () => {
    headTarget = Number(b.dataset.lean)
    setTimeout(() => (headTarget = 0), 600)
  }
})
setInterval(() => {
  if (realImu) return
  headDeg += (headTarget - headDeg) * 0.25
  const r = (headDeg * Math.PI) / 180
  tilt.feed(Math.sin(r), 0, Math.cos(r))
}, 20)

await poll()
setInterval(poll, 1000)
