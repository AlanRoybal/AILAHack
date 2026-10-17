// The lens. Each state is one page layout; switching state rebuilds the page,
// and everything inside a state is an in-place text or image update. Every
// write goes through one queue because concurrent writes break the BLE link.

import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { DROP_FRAMES, DROP_H, DROP_W, RING, RING_FRAMES, blank, drop, ring, stepRing } from './art.ts'
import { COMMIT_DEG } from './tilt.ts'
import type { Check } from '../../shared/protocol.ts'

type Layout = 'idle' | 'card' | 'dim' | 'choice' | 'working' | 'result'

// Two firmware lines are ~54 px; 84 px leaves room for padding and the border without a scrollbar.
const CARD = { x: 88, y: 176, w: 400, h: 84 }
const COLS = 30
const DROP_L = { id: 3, name: 'dropL', x: 0, y: CARD.y - 6, w: DROP_W, h: DROP_H }
const DROP_R = { id: 4, name: 'dropR', x: CARD.x + CARD.w, y: CARD.y - 6, w: DROP_W, h: DROP_H }
const RING_BOX = { id: 5, name: 'ring', x: CARD.x + 8, y: CARD.y + 18, w: RING, h: RING }

const text = (o: { id: number; name: string; x: number; y: number; w: number; h: number; content: string; border?: number; borderColor?: number; color?: number; capture?: boolean }) =>
  new TextContainerProperty({
    xPosition: o.x,
    yPosition: o.y,
    width: o.w,
    height: o.h,
    borderWidth: o.border ?? 0,
    borderColor: o.borderColor ?? 12,
    borderRadius: 10,
    paddingLength: 8,
    containerID: o.id,
    containerName: o.name,
    content: o.content || ' ',
    isEventCapture: o.capture ? 1 : 0,
    textColor: o.color ?? 4,
  })
const image = (o: { id: number; name: string; x: number; y: number; w: number; h: number }) =>
  new ImageContainerProperty({ xPosition: o.x, yPosition: o.y, width: o.w, height: o.h, containerID: o.id, containerName: o.name })

function page(layout: Layout, content: string) {
  const textObject: TextContainerProperty[] = []
  const imageObject: ImageContainerProperty[] = []
  const main = { id: 1, name: 'main', capture: true, content }
  if (layout === 'idle') textObject.push(text({ ...main, x: 0, y: 0, w: 576, h: 288, content: ' ' }))
  if (layout === 'card' || layout === 'choice') {
    textObject.push(text({ ...main, ...CARD, border: 2 }))
    imageObject.push(image(DROP_L), image(DROP_R))
  }
  // Last 1.5 s of an ignored card: same card, dimmer, so it fades instead of vanishing.
  if (layout === 'dim') textObject.push(text({ ...main, ...CARD, border: 1, borderColor: 5, color: 2 }))
  if (layout === 'working') {
    textObject.push(text({ ...main, x: RING_BOX.x + RING + 10, y: CARD.y, w: CARD.w - RING - 18, h: CARD.h, color: 3 }))
    imageObject.push(image(RING_BOX))
  }
  if (layout === 'result') textObject.push(text({ ...main, ...CARD, border: 2 }))
  return { containerTotalNum: textObject.length + imageObject.length, textObject, imageObject }
}

const unit = (lean: number) => Math.max(-1, Math.min(1, lean / COMMIT_DEG))

/** Left-aligned card: what the agent understood, then the gesture hint. The text leans with the head. */
function cardText(title: string, lean: number) {
  const pad = ' '.repeat(Math.max(0, Math.round(2 + unit(lean) * 3)))
  const u = unit(lean)
  const hint = u > 0.3 ? `           yes ${'›'.repeat(Math.ceil(u * 3))}` : u < -0.3 ? `${'‹'.repeat(Math.ceil(-u * 3))} no` : '← no      yes →'
  return `${pad}${title.slice(0, COLS)}\n${pad}${hint}`
}

/** "6:45 ←  → 7:30": tilt toward the time you want. The leaned side brightens with arrows. */
function choiceText(prompt: string, options: [string, string], lean: number) {
  const u = unit(lean)
  const left = u < -0.3 ? `${options[0]} ◀━` : `${options[0]} ←`
  const right = u > 0.3 ? `━▶ ${options[1]}` : `→ ${options[1]}`
  return `  ${prompt.slice(0, COLS)}\n  ${left}    ${right}`
}

export class Lens {
  private layout: Layout | null = null
  private q: Promise<unknown> = Promise.resolve()
  private spin = 0
  private title = ''
  private choiceOf: { prompt: string; options: [string, string] } | null = null
  private steps: { done: number; total: number } | null = null
  private label = ''
  private lastText = ''
  private checksLine = ''
  /** Mirror for the phone page. */
  onMirror: (s: string) => void = () => {}

  constructor(private readonly bridge: EvenAppBridge) {}

  private run<T>(f: () => Promise<T>): Promise<T> {
    const p = this.q.then(f, f)
    this.q = p.catch(() => {})
    return p
  }

  private go(layout: Layout, content: string) {
    this.stopSpin()
    this.lastText = content
    this.onMirror(content)
    return this.run(async () => {
      if (this.layout === null) {
        const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page(layout, content)))
        if (r !== 0) await this.bridge.rebuildPageContainer(new RebuildPageContainer(page(layout, content)))
      } else await this.bridge.rebuildPageContainer(new RebuildPageContainer(page(layout, content)))
      this.layout = layout
    })
  }

  private setText(content: string) {
    if (content === this.lastText) return
    this.lastText = content
    this.onMirror(content)
    return this.run(() => this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', contentOffset: 0, contentLength: content.length, content })))
  }

  private img(box: { id: number; name: string }, bytes: Uint8Array) {
    return this.run(() => this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: box.id, containerName: box.name, imageData: bytes })))
  }

  private async clearDrops() {
    await this.img(DROP_L, await blank(DROP_W, DROP_H))
    await this.img(DROP_R, await blank(DROP_W, DROP_H))
  }

  idle() {
    this.choiceOf = null
    this.steps = null
    this.checksLine = ''
    return this.go('idle', ' ')
  }

  async card(title: string) {
    this.title = title
    this.choiceOf = null
    this.checksLine = ''
    await this.go('card', cardText(title, 0))
    await this.clearDrops()
  }

  async fade() {
    if (this.layout === 'card') await this.go('dim', cardText(this.title, 0))
    else if (this.layout === 'choice' && this.choiceOf) await this.go('dim', choiceText(this.choiceOf.prompt, this.choiceOf.options, 0))
  }

  async choice(prompt: string, options: [string, string]) {
    this.choiceOf = { prompt, options }
    await this.go('choice', choiceText(prompt, options, 0))
    await this.clearDrops()
  }

  /** The card follows the head; cheap text updates, so it can track the lean before the commit. */
  lean(deg: number) {
    if (this.layout === 'card') void this.setText(cardText(this.title, deg))
    else if (this.layout === 'choice' && this.choiceOf) void this.setText(choiceText(this.choiceOf.prompt, this.choiceOf.options, deg))
  }

  /** The card pinches off into a drop and leaves through the side it was tilted to. */
  async release(dir: 1 | -1) {
    if (this.layout !== 'card' && this.layout !== 'choice') return
    const box = dir === 1 ? DROP_R : DROP_L
    for (let f = 0; f < DROP_FRAMES; f++) {
      if (f === 1) void this.setText(' ')
      const t = Date.now()
      await this.img(box, await drop(dir, f))
      const left = 140 - (Date.now() - t)
      if (left > 0) await new Promise(r => setTimeout(r, left))
    }
  }

  private workingText() {
    return `${this.label}\n${this.checksLine || '← undo'}`
  }

  async working(label: string) {
    this.label = label
    if (this.layout !== 'working') {
      await this.go('working', this.workingText())
      this.startSpin()
    } else await this.setText(this.workingText())
  }

  /** A real agent step finished: fill its segment and swap the one-word label in place. */
  async step(done: number, total: number, label: string) {
    this.steps = { done, total }
    await this.working(label)
  }

  /** Each result of the one tilt, checked off in place: "● Table   ● Invite   ○ Text". */
  async checks(items: Check[]) {
    this.checksLine = items.map(i => `${i.state === 'done' ? '●' : i.state === 'fail' ? '!' : '○'} ${i.label}`).join('   ')
    if (this.layout === 'working') await this.setText(this.workingText())
  }

  async result(label: string) {
    this.steps = null
    await this.go('result', this.checksLine ? `${label}\n  ${this.checksLine}` : label)
  }

  private startSpin() {
    const tick = async () => {
      const id = this.spin
      if (!id || this.layout !== 'working') return
      const t = Date.now()
      const s = this.steps
      await this.img(RING_BOX, await (s ? stepRing(s.done, s.total, id % 2 === 0) : ring(id % RING_FRAMES)))
      if (this.spin !== id) return
      this.spin = id + 1
      // Image writes take ~300-600 ms on hardware; never queue more than one.
      // The step ring only pulses, so it can tick slower.
      setTimeout(tick, Math.max(0, (s ? 400 : 120) - (Date.now() - t)))
    }
    this.spin = 1
    void tick()
  }
  private stopSpin() {
    this.spin = 0
  }
}
