import { AudioInputSource, AudioSpeakerRole, ImuReportPace, OsEventTypeList, waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { ServerMessage } from '../../shared/protocol.ts'
import { Lens } from './display.ts'
import { Link } from './link.ts'
import { Tilt } from './tilt.ts'

const $ = (id: string) => document.getElementById(id)!
const RESULT_MS = 4500
const CARD_MS = Number(import.meta.env.VITE_CARD_MS ?? 6500)
const FADE_MS = 1500

// Which voices reach the transcriber. 'other' = only frames the SDK tags as someone
// else; 'notself' also lets untagged frames through, for when tagging is unreliable.
type Listen = 'other' | 'notself' | 'all'
let listen = (localStorage.getItem('listen') ?? (import.meta.env.VITE_LISTEN as string | undefined) ?? 'other') as Listen
let worn: boolean | undefined

type Mode = 'idle' | 'calib' | 'card' | 'choice' | 'working' | 'result'
let mode: Mode = 'idle'
let pending: string | null = null
let timer = 0
/** The card itself is a two-way choice (e.g. lunch times), so a tilt both accepts and picks. */
let cardChoice = false

const bridge = await waitForEvenAppBridge()
const lens = new Lens(bridge)
lens.onMirror = s => ($('lens').textContent = s)

const tilt = new Tilt(
  dir => void commit(dir),
  lean => {
    if (mode === 'card' || mode === 'choice') lens.lean(lean)
    $('needle').style.left = `${50 + Math.max(-50, Math.min(50, lean * 2.5))}%`
  },
)

function later(ms: number, f: () => void) {
  clearTimeout(timer)
  timer = window.setTimeout(f, ms)
}

async function commit(dir: 1 | -1) {
  if (mode === 'card') return decide(dir === 1)
  if (mode === 'choice') return choose(dir === 1 ? 1 : 0)
  if (mode === 'working' && pending) {
    if (dir === 1) return tilt.arm()
    link.send({ type: 'cancel', id: pending })
    pending = null
    mode = 'result'
    await lens.result('  Cancelled')
    later(1500, () => void toIdle())
  }
}

async function decide(accept: boolean) {
  if (mode !== 'card' || !pending) return
  const id = pending
  clearTimeout(timer)
  link.send({ type: 'decide', id, accept })
  await lens.release(accept ? 1 : -1)
  if (accept) {
    mode = 'working'
    await lens.working('On it')
    tilt.arm()
  } else await toIdle()
}

async function choose(pick: 0 | 1 | null) {
  if (mode !== 'choice' || !pending) return
  clearTimeout(timer)
  if (cardChoice) {
    link.send(pick === null ? { type: 'decide', id: pending, accept: false } : { type: 'decide', id: pending, accept: true, pick })
    if (pick === null) return toIdle()
  } else link.send({ type: 'choose', id: pending, pick })
  if (pick !== null) await lens.release(pick === 1 ? 1 : -1)
  mode = 'working'
  await lens.working(pick === null ? 'Skipping' : 'On it')
  tilt.arm()
}

async function toIdle() {
  mode = 'idle'
  pending = null
  tilt.disarm()
  await lens.idle()
}

/** Ignoring a card or a choice is a no: it dims, then goes. The bridge times out on its own clock too. */
function fadeAfter(onGone: () => void) {
  later(CARD_MS - FADE_MS, () => {
    void lens.fade()
    later(FADE_MS, onGone)
  })
}

function onServer(m: ServerMessage) {
  if (mode === 'calib') return
  if (m.type === 'card' && m.task.options) {
    pending = m.task.id
    cardChoice = true
    mode = 'choice'
    void lens.choice(m.task.title, m.task.options)
    tilt.arm()
    fadeAfter(() => void choose(null))
  } else if (m.type === 'card') {
    pending = m.task.id
    cardChoice = false
    mode = 'card'
    void lens.card(m.task.title)
    tilt.arm()
    fadeAfter(() => void (mode === 'card' && toIdle()))
  } else if (m.type === 'checks' && m.id === pending) {
    void lens.checks(m.items)
  } else if (m.type === 'choice' && m.id === pending) {
    cardChoice = false
    mode = 'choice'
    void lens.choice(m.prompt, m.options)
    tilt.arm()
    fadeAfter(() => void choose(null))
  } else if (m.type === 'step' && m.id === pending && mode === 'working') {
    void lens.step(m.index, m.total, m.label)
  } else if (m.type === 'status' && m.id === pending) {
    if (m.phase === 'working') {
      if (mode === 'working') void lens.working(m.text)
      return
    }
    const mark = m.phase === 'done' ? '✓' : m.phase === 'needs' ? '?' : 'x'
    mode = 'result'
    pending = null
    tilt.disarm()
    void lens.result(`  ${mark} ${m.text.replace(/\n/g, '\n    ')}`)
    later(RESULT_MS, () => void toIdle())
  } else if (m.type === 'clear' && m.id === pending && mode !== 'result') {
    clearTimeout(timer)
    void toIdle()
  }
}

const link = new Link(onServer, s => ($('status').textContent = `bridge ${s}`))

async function calibrate() {
  mode = 'calib'
  clearTimeout(timer)
  await lens.result('  Lean your head right\n  and hold')
  tilt.calibrate(async () => {
    $('axis').textContent = `axis ${'xyz'[tilt.axis]} ${tilt.sign > 0 ? '+' : '-'}`
    await lens.result("  That's yes. Left is no.")
    later(1800, () => void toIdle())
  })
}

await lens.idle()
// Not awaited: with no audio device (the simulator on a headless box) these can hang, and the app must still start.
const warn = (what: string) => (err: unknown) => console.warn(`${what} failed`, err)
bridge.audioControl(true, AudioInputSource.Glasses).catch(warn('audio'))
bridge.imuControl(true, ImuReportPace.P100).catch(warn('imu'))
bridge.getDeviceInfo().then(d => {
  if (d?.status?.isWearing !== undefined) worn = d.status.isWearing
  showListen()
}, warn('device info'))
bridge.onDeviceStatusChanged(s => {
  if (s.isWearing !== undefined) worn = s.isWearing
  showListen()
})
if (!tilt.calibrated) setTimeout(() => void calibrate(), 600)

const passes = (role: AudioSpeakerRole | undefined) =>
  worn !== false && (listen === 'all' || (listen === 'other' ? role === AudioSpeakerRole.Other : role !== AudioSpeakerRole.Self))

let lastImuUi = 0
bridge.onEvenHubEvent((e: EvenHubEvent) => {
  const a = e.audioEvent
  if (a?.audioPcm) {
    if (passes(a.speakerRole)) link.sendPcm(a.audioPcm)
    return
  }
  const sys = e.sysEvent
  if (sys?.eventType === OsEventTypeList.IMU_DATA_REPORT && sys.imuData) {
    const { x = 0, y = 0, z = 0 } = sys.imuData
    realImu = true
    tilt.feed(x, y, z)
    if (Date.now() - lastImuUi > 200) {
      lastImuUi = Date.now()
      $('imu').textContent = `imu ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} · lean ${tilt.lean.toFixed(0)}°`
    }
    return
  }
  // Ring or temple: tap accepts, double tap declines or cancels. A tap arrives with eventType undefined (0 is dropped).
  const env = sys ?? e.textEvent ?? e.listEvent
  if (!env) return
  const type = env.eventType ?? OsEventTypeList.CLICK_EVENT
  if (type === OsEventTypeList.CLICK_EVENT) {
    if (mode === 'card') void decide(true)
  } else if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (mode === 'card') void decide(false)
    else if (mode === 'choice') void choose(null)
    else if (mode === 'working') void commit(-1)
  } else if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) void bridge.audioControl(true, AudioInputSource.Glasses)
})

function showListen() {
  $('listenState').textContent = `listening to ${listen}${worn === false ? ' · paused, glasses off' : ''}`
}
const sel = $('listen') as HTMLSelectElement
sel.value = listen
sel.onchange = () => {
  listen = sel.value as Listen
  localStorage.setItem('listen', listen)
  showListen()
}
showListen()
$('axis').textContent = tilt.calibrated ? `axis ${'xyz'[tilt.axis]} ${tilt.sign > 0 ? '+' : '-'}` : 'not calibrated'
$('calib').onclick = () => void calibrate()

// Simulated head for the Even Hub simulator, which sends no IMU data. Stops as soon as real IMU data arrives.
let realImu = false
let headDeg = 0
const head = $('head') as HTMLInputElement
document.querySelectorAll<HTMLButtonElement>('[data-lean]').forEach(b => {
  b.onclick = () => {
    head.value = b.dataset.lean!
    if (b.dataset.flick !== undefined) setTimeout(() => (head.value = '0'), 700)
  }
})
setInterval(() => {
  if (realImu) return
  headDeg += (Number(head.value) - headDeg) * 0.25
  const r = (headDeg * Math.PI) / 180
  tilt.feed(Math.sin(r), 0, Math.cos(r))
  $('needle').style.left = `${50 + Math.max(-50, Math.min(50, tilt.lean * 2.5))}%`
}, 20)
$('yes').onclick = () => void (mode === 'choice' ? choose(1) : mode === 'working' ? undefined : decide(true))
$('no').onclick = () => void (mode === 'choice' ? choose(0) : mode === 'working' ? commit(-1) : decide(false))
