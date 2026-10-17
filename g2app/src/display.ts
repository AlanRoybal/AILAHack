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
import { DROP_FRAMES, DROP_H, DROP_W, RING, RING_FRAMES, blank, drop, ring } from './art.ts'
import { COMMIT_DEG } from './tilt.ts'

type Layout = 'idle' | 'card' | 'working' | 'result'

const CARD = { x: 88, y: 180, w: 400, h: 72 }
const CARD_COLS = 30
const DROP_L = { id: 3, name: 'dropL', x: 0, y: CARD.y - 12, w: DROP_W, h: DROP_H }
const DROP_R = { id: 4, name: 'dropR', x: CARD.x + CARD.w, y: CARD.y - 12, w: DROP_W, h: DROP_H }
const RING_BOX = { id: 5, name: 'ring', x: CARD.x, y: CARD.y + 12, w: RING, h: RING }

const text = (o: { id: number; name: string; x: number; y: number; w: number; h: number; content: string; border?: number; color?: number; capture?: boolean }) =>
  new TextContainerProperty({
    xPosition: o.x,
    yPosition: o.y,
    width: o.w,
    height: o.h,
    borderWidth: o.border ?? 0,
    borderColor: 12,
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
  if (layout === 'idle') textObject.push(text({ id: 1, name: 'main', x: 0, y: 0, w: 576, h: 288, content: ' ', capture: true }))
  if (layout === 'card') {
    textObject.push(text({ id: 1, name: 'main', ...CARD, content, border: 2, capture: true }))
    imageObject.push(image(DROP_L), image(DROP_R))
  }
  if (layout === 'working') {
    textObject.push(text({ id: 1, name: 'main', x: CARD.x + RING + 8, y: CARD.y + 12, w: CARD.w - RING - 8, h: 48, content, color: 3, capture: true }))
    imageObject.push(image(RING_BOX))
  }
  if (layout === 'result') textObject.push(text({ id: 1, name: 'main', ...CARD, content, border: 2, capture: true }))
  return { containerTotalNum: textObject.length + imageObject.length, textObject, imageObject }
}

/** Two card lines, padded so the text can slide inside the border as the head leans. */
function cardText(title: string, lean: number) {
  const shift = Math.round((Math.max(-1, Math.min(1, lean / COMMIT_DEG)) * 6))
  const center = (s: string) => {
    const pad = Math.max(0, CARD_COLS - s.length)
    const left = Math.max(0, Math.floor(pad / 2) + shift)
    return ' '.repeat(left) + s
  }
  const hint = lean > 2 ? 'accept  ›››' : lean < -2 ? '‹‹‹  skip' : '‹ skip      accept ›'
  return `${center(title.slice(0, CARD_COLS))}\n${center(hint)}`
}

export class Lens {
  private layout: Layout | null = null
  private q: Promise<unknown> = Promise.resolve()
  private spin = 0
  private title = ''
  private lastText = ''
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

  idle() {
    return this.go('idle', ' ')
  }

  async card(title: string) {
    this.title = title
    await this.go('card', cardText(title, 0))
    await this.img(DROP_L, await blank(DROP_W, DROP_H))
    await this.img(DROP_R, await blank(DROP_W, DROP_H))
  }

  /** Card text slides toward the lean; cheap text updates, so it can follow the head. */
  lean(deg: number) {
    if (this.layout === 'card') void this.setText(cardText(this.title, deg))
  }

  /** The card pinches off into a drop and leaves through the side it was tilted to. */
  async release(dir: 1 | -1) {
    const box = dir === 1 ? DROP_R : DROP_L
    void this.setText(cardText(this.title, dir * COMMIT_DEG * 1.6))
    for (let f = 0; f < DROP_FRAMES; f++) {
      if (f === 1) void this.setText(' ')
      const t = Date.now()
      await this.img(box, await drop(dir, f))
      const left = 140 - (Date.now() - t)
      if (left > 0) await new Promise(r => setTimeout(r, left))
    }
  }

  async working(label: string) {
    if (this.layout !== 'working') {
      await this.go('working', label)
      this.startSpin()
    } else await this.setText(label)
  }

  async result(label: string) {
    await this.go('result', label)
  }

  private startSpin() {
    const tick = async () => {
      const id = this.spin
      if (!id || this.layout !== 'working') return
      const t = Date.now()
      await this.img(RING_BOX, await ring(id % RING_FRAMES))
      if (this.spin !== id) return
      this.spin = id + 1
      // Image writes take ~300-600 ms on hardware; never queue more than one.
      setTimeout(tick, Math.max(0, 120 - (Date.now() - t)))
    }
    this.spin = 1
    void tick()
  }
  private stopSpin() {
    this.spin = 0
  }
}
