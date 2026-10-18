import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

interface Brief { company: string; match: number; role: string; rep: string; points: string[] }
interface Run { status: string; error?: string; to?: string }
interface State { briefs: Brief[]; prep?: Run; followups: Record<string, Run> }

const ROWS = 6
let state: State = { briefs: [], followups: {} }
let screen: 'list' | 'brief' = 'list'
let cursor = 0
let shown = ''

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)

function listText() {
  if (!state.briefs.length) {
    const p = state.prep
    if (!p) return 'BOOTH BRIEF\n\nNo briefs yet.\nStart prep on the laptop.'
    if (p.status === 'completed' && !p.error) return 'BOOTH BRIEF\n\nNo sponsors matched.'
    return p.error ? `BOOTH BRIEF\n\nCREAO run failed:\n${cut(p.error, 60)}` : 'BOOTH BRIEF\n\nCREAO is researching\nthe LA Hacks sponsors...'
  }
  const top = Math.min(Math.max(0, cursor - ROWS + 1), Math.max(0, state.briefs.length - ROWS))
  const rows = state.briefs.slice(top, top + ROWS).map((b, i) => {
    const sent = state.followups[b.company]?.status === 'completed' ? ' +' : ''
    return `${top + i === cursor ? '>' : ' '} ${String(b.match).padStart(2)}  ${cut(b.company, 22)}${sent}`
  })
  return `SPONSORS BY FIT  ${cursor + 1}/${state.briefs.length}\n${rows.join('\n')}`
}

function briefText() {
  const b = state.briefs[cursor]
  const f = state.followups[b.company]
  const foot = !f
    ? 'Tap after you meet them'
    : f.status === 'completed' && !f.error
      ? `Follow-up sent: ${cut(f.to ?? '', 22)}`
      : f.error
        ? 'Follow-up failed. Tap to retry'
        : 'CREAO writing follow-up...'
  return [
    `${cut(b.company, 20)}  fit ${b.match}`,
    cut(b.role, 34),
    cut(`Ask for: ${b.rep}`, 34),
    ...b.points.slice(0, 3).map(p => `- ${cut(p, 32)}`),
    foot,
  ].join('\n')
}

const text = () => (screen === 'brief' && state.briefs[cursor] ? briefText() : listText())

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
  document.getElementById('app')!.textContent = t
  if (t === shown) return
  shown = t
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'body', content: t }))
}

async function poll() {
  try {
    state = await (await fetch('/api/state')).json()
    cursor = Math.min(cursor, Math.max(0, state.briefs.length - 1))
  } catch {}
  await render()
}

async function markMet() {
  const b = state.briefs[cursor]
  const f = state.followups[b.company]
  if (f && !f.error) return
  state.followups[b.company] = { status: 'running' }
  await render()
  await fetch('/api/followup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: b.company }) })
}

const typeOf = (e?: { eventType?: OsEventTypeList }) => (e ? (e.eventType ?? OsEventTypeList.CLICK_EVENT) : null)

bridge.onEvenHubEvent(event => {
  const sys = typeOf(event.sysEvent)
  const txt = typeOf(event.textEvent)
  const is = (t: OsEventTypeList) => sys === t || txt === t
  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    if (screen === 'brief') screen = 'list'
    else bridge.shutDownPageContainer(1)
  } else if (txt === OsEventTypeList.SCROLL_TOP_EVENT && screen === 'list') cursor = Math.max(0, cursor - 1)
  else if (txt === OsEventTypeList.SCROLL_BOTTOM_EVENT && screen === 'list') cursor = Math.min(state.briefs.length - 1, cursor + 1)
  else if (is(OsEventTypeList.CLICK_EVENT)) {
    if (screen === 'list' && state.briefs.length) screen = 'brief'
    else if (screen === 'brief') void markMet()
  } else return
  void render()
})

await poll()
setInterval(poll, 3000)
