import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImuReportPace,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { TILE, TITLE_H, TITLE_W, tile, title, type Icon } from './art.ts'
import { Tilt } from './tilt.ts'

interface Brief { company: string; match: number; role: string; rep: string; points: string[] }
interface Followup { phase: string; heard: string; rep: string; matched: boolean; to?: string; sendAt?: number; error?: string }
interface State { briefs: Brief[]; prep?: { endedAt?: number; error?: string }; followups: Record<string, Followup>; now: number }
interface View { icon: Icon; title: string; sub: string; detail?: string; hint?: string }

const LISTEN_MS = 5000
const CANCEL_GAP_MS = 2500
const COUNTDOWN_S = 8
const $ = (id: string) => document.getElementById(id)!
const warn = (what: string) => (err: unknown) => console.warn(`${what} failed`, err)

let state: State = { briefs: [], followups: {}, now: Date.now() }
let skew = 0
let screen: 'list' | 'brief' | 'listen' = 'list'
let cursor = 0
let point = 0
let pcm: Uint8Array[] = []
let listenTimer = 0
let leftAt = 0

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)
const brief = () => state.briefs[cursor]
const followup = () => (brief() ? state.followups[brief().company] : undefined)
const BASE = (import.meta.env.VITE_BOOTH_URL as string | undefined) ?? ''
const TOKEN = (import.meta.env.VITE_BOOTH_TOKEN as string | undefined) ?? ''
const call = (path: string, init?: RequestInit) =>
  fetch(`${BASE}/api${path}`, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(TOKEN ? { 'x-booth-token': TOKEN } : {}) } })
const api = (path: string, init?: RequestInit) => call(`${path}?company=${encodeURIComponent(brief().company)}`, { method: 'POST', ...init })
const person = (rep: string) => (/^unknown$/i.test(rep.trim()) ? '' : rep.split(',')[0].trim())
const first = (rep: string) => person(rep).split(/\s+/)[0] ?? ''
const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase()

function prepView(): View {
  const p = state.prep
  if (!p) return { icon: { kind: 'idle' }, title: 'Booth Brief', sub: 'No briefs yet', detail: 'Start prep on the laptop' }
  if (p.error) return { icon: { kind: 'failed', letter: 'C' }, title: 'Prep failed', sub: 'CREAO run', detail: cut(p.error, 44) }
  if (p.endedAt) return { icon: { kind: 'idle' }, title: 'No matches', sub: 'Rerun prep on the laptop' }
  return { icon: { kind: 'research' }, title: 'Researching', sub: 'LA Hacks sponsors', detail: 'CREAO is ranking fit' }
}

function listView(b: Brief): View {
  const rep = person(b.rep)
  const sent = state.followups[b.company]?.phase === 'sent'
  return {
    icon: { kind: 'fit', match: b.match },
    title: b.company,
    sub: cut(b.role, 26),
    detail: [rep ? `Ask for ${cut(rep, 18)}` : '', sent ? 'Follow-up sent' : `${cursor + 1} of ${state.briefs.length}`].filter(Boolean).join('\n'),
    hint: 'tap  brief        swipe  next',
  }
}

function followupView(b: Brief, f: Followup): View {
  const who = first(f.rep) || first(f.heard) || 'them'
  switch (f.phase) {
    case 'drafting':
      return { icon: { kind: 'search' }, title: `Finding ${who}`, sub: 'Apollo + CREAO draft', detail: f.matched ? cut(person(f.rep), 24) : cut(`heard "${f.heard}"`, 26) }
    case 'countdown': {
      const s = Math.max(0, Math.min(COUNTDOWN_S, Math.ceil(((f.sendAt ?? 0) - (Date.now() + skew)) / 1000)))
      const tilted = Date.now() - leftAt < CANCEL_GAP_MS
      return {
        icon: { kind: 'countdown', secs: s, total: COUNTDOWN_S },
        title: `Sending to ${who}`,
        sub: tilted ? 'now tilt right' : `in ${s}s`,
        detail: f.to ? cut(f.to, 26) : undefined,
        hint: 'tilt  left, right   cancel',
      }
    }
    case 'sending': return { icon: { kind: 'sending' }, title: 'Sending', sub: `CREAO is emailing ${cut(who, 10)}`, detail: f.to ? cut(f.to, 26) : undefined }
    case 'sent': return { icon: { kind: 'sent' }, title: 'Sent', sub: cut(person(f.rep) || who, 24), detail: f.to ? cut(f.to, 26) : undefined, hint: 'double tap  back' }
    case 'cancelled': return { icon: { kind: 'moon' }, title: 'Not sent', sub: 'Cancelled', detail: `${cut(who, 12)} gets nothing`, hint: 'tap  redo' }
    default: return { icon: { kind: 'failed', letter: initial(who) }, title: "Didn't send", sub: cut(b.company, 24), detail: cut(f.error ?? 'Unknown error', 44), hint: 'tap  retry' }
  }
}

function briefView(b: Brief): View {
  if (screen === 'listen') return { icon: { kind: 'mic' }, title: 'Say their name', sub: 'Listening', detail: cut(b.company, 24), hint: 'tap  done' }
  const f = followup()
  if (f) return followupView(b, f)
  const rep = person(b.rep)
  const n = b.points.length
  return {
    icon: { kind: 'rep', letter: initial(rep || b.company) },
    title: b.company,
    sub: rep ? `Ask for ${cut(rep, 18)}` : cut(b.role, 26),
    detail: n ? `${(point % n) + 1}/${n}  ${cut(b.points[point % n], 40)}` : undefined,
    hint: 'swipe  point      tap  met them',
  }
}

const view = (): View => (!brief() ? prepView() : screen === 'list' ? listView(brief()) : briefView(brief()))

// Fixed layout after the Figma lens cards: 144 tile on the left, big title, then
// three dimming levels of firmware text.
const IMG = {
  tile: { id: 1, name: 'tile', x: 16, y: 72, w: TILE, h: TILE },
  titleA: { id: 2, name: 'titleA', x: 184, y: 58, w: 288, h: TITLE_H },
  titleB: { id: 3, name: 'titleB', x: 472, y: 58, w: TITLE_W - 288, h: TITLE_H },
}
const TXT = {
  sub: { id: 4, name: 'sub', x: 180, y: 110, w: 392, h: 44, color: 4 },
  detail: { id: 5, name: 'detail', x: 180, y: 142, w: 392, h: 66, color: 2 },
  hint: { id: 6, name: 'hint', x: 180, y: 222, w: 360, h: 44, color: 1 },
}

const bridge = await waitForEvenAppBridge()
await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 6,
    imageObject: Object.values(IMG).map(b => new ImageContainerProperty({ xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, containerID: b.id, containerName: b.name })),
    textObject: Object.values(TXT).map(
      b =>
        new TextContainerProperty({
          xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, borderWidth: 0, paddingLength: 4, textColor: b.color,
          containerID: b.id, containerName: b.name, content: ' ', isEventCapture: b.name === 'sub' ? 1 : 0,
        }),
    ),
  }),
)

// One writer at a time (concurrent BLE writes break the link); each container keeps only its latest frame.
const sent = new Map<string, string>()
const queue = new Map<string, () => Promise<unknown>>()
let draining = false
async function drain() {
  draining = true
  while (queue.size) {
    const [key, job] = queue.entries().next().value!
    queue.delete(key)
    await job().catch(warn(`draw ${key}`))
  }
  draining = false
}
function put(key: string, value: string, job: () => Promise<unknown>) {
  if (sent.get(key) === value) return
  sent.set(key, value)
  queue.set(key, job)
  if (!draining) void drain()
}

async function render() {
  const v = view()
  $('lens').textContent = [v.title, v.sub, v.detail, v.hint].filter(Boolean).join('\n')
  put('tile', JSON.stringify(v.icon), async () =>
    bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: IMG.tile.id, containerName: IMG.tile.name, imageData: await tile(v.icon) })),
  )
  put('title', v.title, async () => {
    const [a, b] = await title(v.title, [IMG.titleA.w, IMG.titleB.w])
    await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: IMG.titleA.id, containerName: IMG.titleA.name, imageData: a }))
    await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: IMG.titleB.id, containerName: IMG.titleB.name, imageData: b }))
  })
  for (const k of ['sub', 'detail', 'hint'] as const) {
    const content = v[k] || ' '
    put(k, content, () => bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: TXT[k].id, containerName: TXT[k].name, content })))
  }
}

async function poll() {
  try {
    state = await (await call('/state')).json()
    skew = state.now - Date.now()
    cursor = Math.min(cursor, Math.max(0, state.briefs.length - 1))
  } catch {}
  if (followup()?.phase === 'countdown') tilt.arm()
  await render()
}

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
    if (dir === -1) {
      leftAt = Date.now()
      void render()
    }
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
  } else if (txt === OsEventTypeList.SCROLL_TOP_EVENT || txt === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    const step = txt === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1
    if (screen === 'list') {
      cursor = Math.min(Math.max(0, cursor + step), Math.max(0, state.briefs.length - 1))
      point = 0
    } else if (screen === 'brief' && !followup()) point = Math.max(0, point + step)
  }
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
