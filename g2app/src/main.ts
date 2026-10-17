import { AudioInputSource, AudioSpeakerRole, ImuReportPace, OsEventTypeList, waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { ServerMessage } from '../../shared/protocol.ts'
import { Lens } from './display.ts'
import { Link } from './link.ts'
import { Tilt } from './tilt.ts'

const $ = (id: string) => document.getElementById(id)!
// Which voices reach the transcriber. 'other' drops frames the SDK tags as the wearer.
const LISTEN = (import.meta.env.VITE_LISTEN as string | undefined) ?? 'other'
const RESULT_MS = 4500

const bridge = await waitForEvenAppBridge()
const lens = new Lens(bridge)
lens.onMirror = s => ($('lens').textContent = s)
let pending: string | null = null
let resultTimer = 0

const tilt = new Tilt(
  dir => void decide(dir === 1),
  lean => {
    lens.lean(lean)
    $('needle').style.left = `${50 + Math.max(-50, Math.min(50, lean * 2.5))}%`
  },
)

async function decide(accept: boolean) {
  if (!pending) return
  const id = pending
  pending = null
  tilt.disarm()
  link.send({ type: 'decide', id, accept })
  await lens.release(accept ? 1 : -1)
  if (accept) await lens.working('On it')
  else await lens.idle()
}

function onServer(m: ServerMessage) {
  if (m.type === 'card') {
    clearTimeout(resultTimer)
    pending = m.task.id
    void lens.card(m.task.title)
    tilt.arm()
  } else if (m.type === 'status') {
    if (m.phase === 'working') void lens.working(m.text)
    else {
      const mark = m.phase === 'done' ? '✓' : m.phase === 'needs' ? '?' : '×'
      void lens.result(`${mark} ${m.text}`)
      clearTimeout(resultTimer)
      resultTimer = window.setTimeout(() => void lens.idle(), RESULT_MS)
    }
  } else if (m.type === 'clear' && pending === m.id) {
    pending = null
    tilt.disarm()
    void lens.idle()
  }
}

const link = new Link(onServer, s => ($('status').textContent = `bridge ${s} · listening to ${LISTEN}`))

await lens.idle()
await bridge.audioControl(true, AudioInputSource.Glasses)
await bridge.imuControl(true, ImuReportPace.P100)

let lastImuUi = 0
bridge.onEvenHubEvent((e: EvenHubEvent) => {
  const a = e.audioEvent
  if (a?.audioPcm) {
    if (LISTEN === 'all' || a.speakerRole !== AudioSpeakerRole.Self) link.sendPcm(a.audioPcm)
    return
  }
  const sys = e.sysEvent
  if (sys?.eventType === OsEventTypeList.IMU_DATA_REPORT && sys.imuData) {
    const { x = 0, y = 0, z = 0 } = sys.imuData
    tilt.feed(x, y, z)
    if (Date.now() - lastImuUi > 200) {
      lastImuUi = Date.now()
      $('imu').textContent = `imu ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} · lean ${tilt.lean.toFixed(0)}°`
    }
    return
  }
  // Ring or temple: tap accepts, double tap declines. A tap arrives with eventType undefined (0 is dropped).
  const env = sys ?? e.textEvent ?? e.listEvent
  if (!env) return
  const type = env.eventType ?? OsEventTypeList.CLICK_EVENT
  if (type === OsEventTypeList.CLICK_EVENT) void decide(true)
  else if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) void decide(false)
  else if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) void bridge.audioControl(true, AudioInputSource.Glasses)
})

const axis = $('axis') as HTMLSelectElement
axis.value = String(tilt.axis)
axis.onchange = () => tilt.setAxis(Number(axis.value))
$('flip').onclick = () => tilt.flip()
$('zero').onclick = () => tilt.arm()
$('yes').onclick = () => void decide(true)
$('no').onclick = () => void decide(false)
