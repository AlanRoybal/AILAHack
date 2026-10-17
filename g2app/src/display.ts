// The lens. Each state is one page of text containers; inside a state every change
// is an in-place text update (~60 ms on glasses), which is why all motion here is
// text: image frames cost 150-500 ms each and look choppy. Every write goes through
// one queue because concurrent writes break the BLE link.

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { COMMIT_DEG } from './tilt.ts'
import type { Check } from '../../shared/protocol.ts'

type Layout = 'idle' | 'card' | 'choice' | 'working' | 'result'
interface Box { id: number; name: string; x: number; y: number; w: number; h: number }

// A HUD strip along the bottom of the 576x288 canvas keeps the centre of view clear.
const X = 40
const W = 496
const HEAD: Box = { id: 2, name: 'head', x: X + 6, y: 122, w: W - 12, h: 38 }
const BOX: Box = { id: 3, name: 'box', x: X, y: 160, w: W, h: 86 }
const LEFT: Box = { id: 4, name: 'left', x: X, y: 160, w: 240, h: 86 }
const RIGHT: Box = { id: 5, name: 'right', x: X + W - 240, y: 160, w: 240, h: 86 }
const METER: Box = { id: 6, name: 'meter', x: X + 6, y: 248, w: W - 12, h: 38 }
const CELLS = 6
const BAR = 18

const text = (b: Box, content: string, o: { border?: number; color?: number } = {}) =>
  new TextContainerProperty({
    xPosition: b.x,
    yPosition: b.y,
    width: b.w,
    height: b.h,
    borderWidth: o.border ?? 0,
    borderColor: 10,
    borderRadius: 8,
    paddingLength: o.border ? 8 : 2,
    containerID: b.id,
    containerName: b.name,
    content: content || ' ',
    isEventCapture: 0,
    textColor: o.color ?? 4,
  })

const unit = (lean: number) => Math.max(-1, Math.min(1, lean / COMMIT_DEG))
const fill = (n: number, of: number) => '━'.repeat(n) + '─'.repeat(of - n)

/** `◁ no  ──────━━┃────────  yes ▷`: the bar grows toward the side the head leans. */
function meter(lean: number, words = true) {
  const u = unit(lean)
  const l = u < 0 ? Math.round(-u * CELLS) : 0
  const r = u > 0 ? Math.round(u * CELLS) : 0
  const [no, yes] = words ? [' no', 'yes '] : ['', '']
  return `${l === CELLS ? '◀' : '◁'}${no}   ${'─'.repeat(CELLS - l)}${'━'.repeat(l)}┃${fill(r, CELLS)}   ${yes}${r === CELLS ? '▶' : '▷'}`
}

/** "Table · 2 · 7:00 · Italian" -> ["TABLE", "2 · 7:00 · Italian"]. */
function split(title: string): [string, string] {
  const i = title.indexOf(' · ')
  return i < 0 ? ['HANDOFF', title] : [title.slice(0, i).toUpperCase(), title.slice(i + 3)]
}

export class Lens {
  private layout: Layout | null = null
  private q: Promise<unknown> = Promise.resolve()
  private shown = new Map<number, { content: string; color: number }>()
  private kind = 'HANDOFF'
  private what = ''
  private choiceOf: { prompt: string; options: [string, string] } | null = null
  private steps: { done: number; total: number } | null = null
  private label = ''
  private checksLine = ''
  private anim = 0
  /** Mirror for the phone page. */
  onMirror: (s: string) => void = () => {}

  constructor(private readonly bridge: EvenAppBridge) {}

  private run<T>(f: () => Promise<T>): Promise<T> {
    const p = this.q.then(f, f)
    this.q = p.catch(() => {})
    return p
  }

  private mirror() {
    this.onMirror([...this.shown.values()].map(s => s.content).join('\n'))
  }

  /** Rebuild into a new layout. A blank full-screen box takes input so text boxes never scroll. */
  private go(layout: Layout, boxes: [Box, string, { border?: number; color?: number }?][]) {
    this.anim++
    this.shown = new Map(boxes.map(([b, c, o]) => [b.id, { content: c, color: o?.color ?? 4 }]))
    this.mirror()
    const capture = new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, paddingLength: 0,
      containerID: 1, containerName: 'input', content: ' ', isEventCapture: 1,
    })
    const textObject = [capture, ...boxes.map(([b, c, o]) => text(b, c, o))]
    const page = { containerTotalNum: textObject.length, textObject }
    return this.run(async () => {
      if (this.layout === null) {
        const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
        if (r !== 0) await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))
      } else await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))
      this.layout = layout
    })
  }

  /** In-place update; skipped when nothing changed so the link stays free. */
  private set(b: Box, content: string, color?: number) {
    const cur = this.shown.get(b.id)
    if (!cur) return
    const c = color ?? cur.color
    if (cur.content === content && cur.color === c) return
    this.shown.set(b.id, { content, color: c })
    this.mirror()
    return this.run(() =>
      this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: b.id, containerName: b.name, contentOffset: 0, contentLength: content.length, content, textColor: c }),
      ),
    )
  }

  idle() {
    this.choiceOf = null
    this.steps = null
    this.checksLine = ''
    return this.go('idle', [])
  }

  async card(title: string) {
    ;[this.kind, this.what] = split(title)
    this.choiceOf = null
    this.checksLine = ''
    await this.go('card', [
      [HEAD, `${this.kind}  //  THEY ASKED`, { color: 2 }],
      [BOX, this.what, { border: 2 }],
      [METER, meter(0), { color: 2 }],
    ])
  }

  async choice(prompt: string, options: [string, string]) {
    // A card that is itself a choice carries the task title; a choice mid-task keeps the task's kind.
    const midTask = this.layout === 'working' || this.layout === 'card'
    if (!midTask) [this.kind, this.what] = split(prompt)
    this.choiceOf = { prompt, options }
    await this.go('choice', [
      [HEAD, `${this.kind}  //  ${midTask && split(prompt)[0] !== this.kind ? prompt.toUpperCase().slice(0, 24) : 'PICK ONE'}`, { color: 2 }],
      [LEFT, `◀\n${options[0]}`, { border: 2, color: 3 }],
      [RIGHT, `▶\n${options[1]}`, { border: 2, color: 3 }],
      [METER, meter(0, false), { color: 2 }],
    ])
  }

  /** Ignored: everything dims in two steps, then the caller clears it. */
  async fade() {
    if (this.layout !== 'card' && this.layout !== 'choice') return
    for (const level of [2, 1]) {
      for (const [id, s] of this.shown) {
        const b = [HEAD, BOX, LEFT, RIGHT, METER].find(x => x.id === id)!
        await this.set(b, s.content, Math.min(s.color, level))
      }
      await new Promise(r => setTimeout(r, 450))
    }
  }

  /** Tracks the head every IMU sample: the meter fills and the leaned side brightens. */
  lean(deg: number) {
    const u = unit(deg)
    if (this.layout === 'card') {
      void this.set(METER, meter(deg), Math.abs(u) > 0.25 ? 4 : 2)
      void this.set(BOX, this.what, u < -0.25 ? 2 : 4)
    } else if (this.layout === 'choice') {
      void this.set(METER, meter(deg, false), Math.abs(u) > 0.25 ? 4 : 2)
      void this.set(LEFT, this.shown.get(LEFT.id)!.content, u < -0.25 ? 4 : u > 0.25 ? 1 : 3)
      void this.set(RIGHT, this.shown.get(RIGHT.id)!.content, u > 0.25 ? 4 : u < -0.25 ? 1 : 3)
    }
  }

  /** Commit: the meter snaps full, the answer lands in the card, then the next state takes over. */
  async release(dir: 1 | -1) {
    if (this.layout !== 'card' && this.layout !== 'choice') return
    await this.set(METER, meter(dir * COMMIT_DEG, this.layout === 'card'), 4)
    if (this.layout === 'card') await this.set(BOX, dir === 1 ? `▶  ${this.what}` : `◀  Not now`, dir === 1 ? 4 : 2)
    else {
      await this.set(dir === 1 ? RIGHT : LEFT, this.shown.get((dir === 1 ? RIGHT : LEFT).id)!.content, 4)
      await this.set(dir === 1 ? LEFT : RIGHT, this.shown.get((dir === 1 ? LEFT : RIGHT).id)!.content, 0)
    }
    await new Promise(r => setTimeout(r, 260))
  }

  private boxText() {
    return `${this.label}\n${this.checksLine || '◁ lean left to undo'}`
  }
  private headText() {
    return `${this.kind}  //  ${this.steps ? `STEP ${this.steps.done} OF ${this.steps.total}` : 'WORKING'}`
  }

  async working(label: string) {
    this.label = label
    if (this.layout !== 'working') {
      await this.go('working', [
        [HEAD, this.headText(), { color: 2 }],
        [BOX, this.boxText(), { border: 2, color: 3 }],
        [METER, fill(0, BAR), { color: 3 }],
      ])
      this.animate()
    } else {
      await this.set(HEAD, this.headText())
      await this.set(BOX, this.boxText())
    }
  }

  /** A real agent step finished: the bar eases to its share and the label swaps in place. */
  async step(done: number, total: number, label: string) {
    this.steps = { done, total }
    await this.working(label)
  }

  /** Each result of the one tilt, checked off in place: "● Table   ● Invite   ○ Text". */
  async checks(items: Check[]) {
    this.checksLine = items.map(i => `${i.state === 'done' ? '●' : i.state === 'fail' ? '!' : '○'} ${i.label}`).join('    ')
    if (this.layout === 'working') await this.set(BOX, this.boxText())
  }

  async result(label: string) {
    this.steps = null
    const t = label.trim()
    const head = t.startsWith('●') ? 'DONE' : t.startsWith('?') ? 'NEEDS YOU' : t.startsWith('x') ? 'DID NOT FINISH' : ''
    await this.go('result', [
      [HEAD, head ? `${this.kind}  //  ${head}` : this.kind, { color: 2 }],
      [BOX, this.checksLine ? `${t}\n${this.checksLine}` : t, { border: 2 }],
      ...(head === 'DONE' ? [[METER, fill(BAR, BAR), { color: 2 }] as [Box, string, { color: number }]] : []),
    ])
  }

  /**
   * Working bar, one text update per tick. Before the first step a short thick
   * segment sweeps back and forth; after that the fill eases toward done/total.
   */
  private animate() {
    const id = this.anim
    let shown = 0
    let t = 0
    const tick = async () => {
      if (this.anim !== id || this.layout !== 'working') return
      const s = this.steps
      let bar: string
      if (!s) {
        const span = BAR - 5
        const p = t % (span * 2)
        const at = p < span ? p : span * 2 - p
        bar = '─'.repeat(at) + '━'.repeat(5) + '─'.repeat(BAR - at - 5)
        t++
      } else {
        shown += (s.done / s.total - shown) * 0.35
        bar = fill(Math.min(BAR, Math.round(shown * BAR)), BAR)
      }
      const started = Date.now()
      await this.set(METER, bar)
      setTimeout(() => void tick(), Math.max(0, 90 - (Date.now() - started)))
    }
    void tick()
  }
}
