// The lens. Words are native text (crisp, ~60 ms per update); everything else is
// pixel art on image tiles (~300-500 ms per send on glasses). Each tile keeps only
// its latest frame, so a fast head lean costs a few sends, never a backlog.
// Every write goes through one queue because concurrent writes break the BLE link.

import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { encodeTile, type Framebuffer } from 'g2-kit/core'
import { COMMIT_DEG } from './tilt.ts'
import { ICON_H, ICON_W, MARKS_W, METER_H, METER_W, ROW, icon, marks, meter, type SpriteName } from './pixels.ts'
import type { Check } from '../../shared/protocol.ts'

type Layout = 'idle' | 'card' | 'choice' | 'working' | 'result'
interface Box { id: number; name: string; x: number; y: number; w: number; h: number }
type TextOpts = { border?: number; color?: number }

// A strip along the bottom of the 576x288 canvas keeps the centre of view clear.
const X = 40
const W = 496
const TX = X + ICON_W + 8
const TW = X + W - TX
const Y = 104
const HEAD: Box = { id: 2, name: 'head', x: TX, y: Y, w: TW, h: 34 }
const TITLE: Box = { id: 3, name: 'title', x: TX, y: Y + 32, w: TW, h: 62 }
const LABEL: Box = { id: 3, name: 'label', x: TX, y: Y + 32, w: TW, h: 34 }
const NO: Box = { id: 4, name: 'no', x: X + 50, y: 236, w: 52, h: 34 }
const YES: Box = { id: 5, name: 'yes', x: X + W - 92, y: 236, w: 60, h: 34 }
const CHEAD: Box = { id: 2, name: 'head', x: X, y: Y, w: W, h: 34 }
const LEFT: Box = { id: 4, name: 'left', x: X, y: Y + 40, w: 236, h: 76 }
const RIGHT: Box = { id: 5, name: 'right', x: X + W - 236, y: Y + 40, w: 236, h: 76 }
const ROWS = (y: number, n: number): Box => ({ id: 6, name: 'rows', x: TX + MARKS_W + 6, y, w: TW - MARKS_W - 6, h: n * ROW + 4 })

const ICON: Box = { id: 10, name: 'icon', x: X, y: Y + 8, w: ICON_W, h: ICON_H }
const METER: Box = { id: 11, name: 'meter', x: 288 - METER_W / 2, y: 232, w: METER_W, h: METER_H }
const MARKS = (y: number, n: number): Box => ({ id: 12, name: 'marks', x: TX, y, w: MARKS_W, h: Math.max(20, n * ROW) })

const text = (b: Box, content: string, o: TextOpts = {}) =>
  new TextContainerProperty({
    xPosition: b.x,
    yPosition: b.y,
    width: b.w,
    height: b.h,
    borderWidth: o.border ?? 0,
    borderColor: 10,
    borderRadius: 8,
    paddingLength: o.border ? 10 : 0,
    containerID: b.id,
    containerName: b.name,
    content: content || ' ',
    isEventCapture: 0,
    textColor: o.color ?? 4,
  })

const image = (b: Box) =>
  new ImageContainerProperty({ xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, containerID: b.id, containerName: b.name })

const unit = (lean: number) => Math.max(-1, Math.min(1, lean / COMMIT_DEG))
/** Meter position in sixths, so small IMU jitter never costs an image send. */
const notch = (lean: number) => Math.round(unit(lean) * 6) / 6

const KINDS: Record<string, SpriteName> = { TABLE: 'table', LUNCH: 'meet', COFFEE: 'meet', DINNER: 'meet', CALL: 'meet', SLIDES: 'slides', SEND: 'send' }

/** "Table · 2 · 7:00 · Italian" -> ["TABLE", "2 · 7:00 · Italian"]. */
function split(title: string): [string, string] {
  const i = title.indexOf(' · ')
  return i < 0 ? ['HANDOFF', title] : [title.slice(0, i).toUpperCase(), title.slice(i + 3)]
}

export class Lens {
  private layout: Layout | null = null
  private q: Promise<unknown> = Promise.resolve()
  private shown = new Map<number, { box: Box; content: string; color: number }>()
  private tiles = new Map<number, Box>()
  private frames = new Map<number, Framebuffer>()
  private sent = new Map<number, number>()
  private pumping = false
  private kind = 'HANDOFF'
  private what = ''
  private steps: { done: number; total: number } | null = null
  private label = ''
  private items: Check[] = []
  private anim = 0
  private fading = false
  private notch = 0
  /** Mirror for the phone page. */
  onMirror: (s: string) => void = () => {}

  constructor(private readonly bridge: EvenAppBridge) {}

  private get sprite(): SpriteName {
    return KINDS[this.kind] ?? 'web'
  }

  private run<T>(f: () => Promise<T>): Promise<T> {
    const p = this.q.then(f, f)
    this.q = p.catch(() => {})
    return p
  }

  private mirror() {
    this.onMirror([...this.shown.values()].map(s => s.content).join('\n'))
  }

  /** Rebuild into a new layout. A blank full-screen box takes input so text boxes never scroll. */
  private go(layout: Layout, boxes: [Box, string, TextOpts?][], tiles: [Box, Framebuffer][] = []) {
    this.anim++
    this.fading = false
    this.notch = 0
    this.shown = new Map(boxes.map(([b, c, o]) => [b.id, { box: b, content: c, color: o?.color ?? 4 }]))
    this.tiles = new Map(tiles.map(([b]) => [b.id, b]))
    this.frames.clear()
    this.sent.clear()
    this.mirror()
    const capture = new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, paddingLength: 0,
      containerID: 1, containerName: 'input', content: ' ', isEventCapture: 1,
    })
    const textObject = [capture, ...boxes.map(([b, c, o]) => text(b, c, o))]
    const imageObject = tiles.map(([b]) => image(b))
    const page = { containerTotalNum: textObject.length + imageObject.length, textObject, imageObject }
    const built = this.run(async () => {
      if (this.layout === null) {
        const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
        if (r !== 0) await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))
      } else await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))
      this.layout = layout
    })
    for (const [b, fb] of tiles) this.paint(b, fb)
    return built
  }

  /** In-place text update; skipped when nothing changed so the link stays free. */
  private set(b: Box, content: string, color?: number) {
    const cur = this.shown.get(b.id)
    if (!cur) return
    const c = color ?? cur.color
    if (cur.content === content && cur.color === c) return
    this.shown.set(b.id, { box: b, content, color: c })
    this.mirror()
    return this.run(() =>
      this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: b.id, containerName: b.name, contentOffset: 0, contentLength: content.length, content, textColor: c }),
      ),
    )
  }

  /** Queues a tile frame. Only the newest frame per tile is ever sent. */
  private paint(b: Box, fb: Framebuffer) {
    if (!this.tiles.has(b.id)) return
    this.frames.set(b.id, fb)
    if (!this.pumping) void this.pump()
  }

  private async pump() {
    this.pumping = true
    try {
      while (this.frames.size) {
        const [id, fb] = this.frames.entries().next().value as [number, Framebuffer]
        this.frames.delete(id)
        const b = this.tiles.get(id)
        const h = fb.hash()
        if (!b || this.sent.get(id) === h) continue
        const gen = this.anim
        await this.run(async () => {
          if (gen !== this.anim) return
          await this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: id, containerName: b.name, imageData: encodeTile(fb, 'png') }))
          if (gen === this.anim) this.sent.set(id, h)
        })
      }
    } finally {
      this.pumping = false
    }
  }

  idle() {
    this.steps = null
    this.items = []
    return this.go('idle', [])
  }

  async card(title: string) {
    ;[this.kind, this.what] = split(title)
    this.items = []
    await this.go(
      'card',
      [
        [HEAD, `${this.kind}  ·  THEY ASKED`, { color: 2 }],
        [TITLE, this.what],
        [NO, 'no', { color: 2 }],
        [YES, 'yes', { color: 2 }],
      ],
      [
        [ICON, icon(this.sprite)],
        [METER, meter(0)],
      ],
    )
  }

  async choice(prompt: string, options: [string, string]) {
    // A card that is itself a choice carries the task title; a choice mid-task keeps the task's kind.
    const midTask = this.layout === 'working' || this.layout === 'card'
    if (!midTask) [this.kind, this.what] = split(prompt)
    const sub = midTask && split(prompt)[0] !== this.kind ? prompt.toUpperCase().slice(0, 28) : 'PICK ONE'
    await this.go(
      'choice',
      [
        [CHEAD, `${this.kind}  ·  ${sub}`, { color: 2 }],
        [LEFT, options[0], { border: 2, color: 3 }],
        [RIGHT, options[1], { border: 2, color: 3 }],
      ],
      [[METER, meter(0)]],
    )
  }

  /** Ignored: everything dims in two steps, then the caller clears it. */
  async fade() {
    if (this.layout !== 'card' && this.layout !== 'choice') return
    this.fading = true
    const gen = this.anim
    for (const [level, k] of [[2, 0.5], [1, 0.2]] as const) {
      if (this.anim !== gen) return
      if (this.layout === 'card') this.paint(ICON, icon(this.sprite, { k }))
      this.paint(METER, meter(0, k))
      await Promise.all([...this.shown.values()].map(s => this.set(s.box, s.content, Math.min(s.color, level))))
      await new Promise(r => setTimeout(r, 450))
    }
  }

  /** Tracks the head every IMU sample: the bar grows toward the lean and that side brightens. */
  lean(deg: number) {
    if (this.fading || (this.layout !== 'card' && this.layout !== 'choice')) return
    const n = notch(deg)
    if (n === this.notch) return
    this.notch = n
    this.paint(METER, meter(n))
    if (this.layout === 'card') {
      void this.set(NO, 'no', n <= -0.5 ? 4 : 2)
      void this.set(YES, 'yes', n >= 0.5 ? 4 : 2)
      void this.set(TITLE, this.what, n <= -0.5 ? 2 : 4)
    } else {
      void this.set(LEFT, this.shown.get(LEFT.id)!.content, n <= -0.34 ? 4 : n >= 0.34 ? 1 : 3)
      void this.set(RIGHT, this.shown.get(RIGHT.id)!.content, n >= 0.34 ? 4 : n <= -0.34 ? 1 : 3)
    }
  }

  /** Commit: the bar snaps full, the icon becomes the answer, then the next state takes over. */
  async release(dir: 1 | -1) {
    if (this.layout !== 'card' && this.layout !== 'choice') return
    const gen = this.anim
    this.notch = dir
    this.paint(METER, meter(dir))
    if (this.layout === 'card') {
      this.paint(ICON, icon(dir === 1 ? 'check' : 'cross'))
      await Promise.all([
        this.set(dir === 1 ? YES : NO, dir === 1 ? 'yes' : 'no', 4),
        this.set(TITLE, dir === 1 ? this.what : 'Not now', dir === 1 ? 4 : 2),
      ])
    } else {
      const [on, off] = dir === 1 ? [RIGHT, LEFT] : [LEFT, RIGHT]
      await this.set(on, this.shown.get(on.id)!.content, 4)
      if (this.anim !== gen) return
      await this.set(off, this.shown.get(off.id)!.content, 0)
    }
    await new Promise(r => setTimeout(r, 260))
  }

  private headText() {
    return `${this.kind}  ·  ${this.steps ? `STEP ${this.steps.done} OF ${this.steps.total}` : 'WORKING'}`
  }
  private rows(): [string, ('done' | 'pending' | 'fail')[]] {
    if (!this.items.length) return ['lean left to undo', ['pending']]
    return [this.items.map(i => i.label).join('\n'), this.items.map(i => i.state as 'done' | 'pending' | 'fail')]
  }

  async working(label: string) {
    this.label = label
    const [rowText, states] = this.rows()
    const y = LABEL.y + LABEL.h + 6
    if (this.layout !== 'working' || this.shown.get(6)?.content.split('\n').length !== states.length) {
      await this.go(
        'working',
        [
          [HEAD, this.headText(), { color: 2 }],
          [LABEL, label, { color: 4 }],
          [ROWS(y, states.length), rowText, { color: this.items.length ? 3 : 2 }],
        ],
        [
          [ICON, this.ring(0)],
          [MARKS(y, states.length), marks(this.items.length ? states : [])],
        ],
      )
      this.animate()
    } else {
      this.paint(MARKS(y, states.length), marks(this.items.length ? states : []))
      await Promise.all([this.set(HEAD, this.headText()), this.set(LABEL, label), this.set(ROWS(y, states.length), rowText, 3)])
    }
  }

  /** A real agent step finished: its share of the ring fills and the label swaps in place. */
  async step(done: number, total: number, label: string) {
    this.steps = { done, total }
    await this.working(label)
  }

  /** Each result of the one tilt, checked off in place. */
  async checks(items: Check[]) {
    this.items = items
    if (this.layout === 'working') await this.working(this.label)
  }

  async result(label: string) {
    this.steps = null
    const t = label.trim().replace(/\n\s*/g, '\n')
    const mark = t[0]
    const body = '●?x'.includes(mark) && t[1] === ' ' ? t.slice(2) : t
    const [head, glyph]: [string, SpriteName] =
      mark === '●' ? ['DONE', 'check'] : mark === '?' && t[1] === ' ' ? ['NEEDS YOU', 'ask'] : mark === 'x' && t[1] === ' ' ? ['DID NOT FINISH', 'cross'] : ['', 'right']
    const states = this.items.map(i => i.state as 'done' | 'pending' | 'fail')
    const y = TITLE.y + TITLE.h + 2
    await this.go(
      'result',
      [
        [HEAD, head ? `${this.kind}  ·  ${head}` : this.kind === 'HANDOFF' ? 'HANDOFF' : this.kind, { color: 2 }],
        [TITLE, body],
        ...(states.length ? [[ROWS(y, states.length), this.items.map(i => i.label).join('\n'), { color: 3 }] as [Box, string, TextOpts]] : []),
      ],
      [[ICON, icon(glyph, head === 'DONE' ? { ring: { lit: 12 } } : {})], ...(states.length ? [[MARKS(y, states.length), marks(states)] as [Box, Framebuffer]] : [])],
    )
  }

  /** Ring around the task icon: a sweep before the first step, then one share per real step. */
  private ring(t: number) {
    const s = this.steps
    const lit = s ? Math.round((s.done / s.total) * 12) : 0
    return icon(this.sprite, { ring: { lit, head: lit < 12 ? (s ? lit + (t % 2) : t % 12) : undefined } })
  }

  private animate() {
    const id = this.anim
    let t = 0
    const tick = () => {
      if (this.anim !== id || this.layout !== 'working') return
      this.paint(ICON, this.ring(t++))
      setTimeout(tick, 250)
    }
    tick()
  }
}
