// Lens art drawn on a canvas and sent as PNG tiles. The G2 shows luminance as
// green, so everything here is white on black with two dimmer levels.

export type Icon =
  | { kind: 'idle' }
  | { kind: 'research' }
  | { kind: 'fit'; match: number }
  | { kind: 'rep'; letter: string }
  | { kind: 'mic' }
  | { kind: 'search' }
  | { kind: 'countdown'; secs: number; total: number }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'moon' }
  | { kind: 'failed'; letter: string }

export const TILE = 144
export const TITLE_W = 376
export const TITLE_H = 56

const FULL = '#ffffff'
const DIM = '#999999'
const FAINT = '#666666'
const FONT = 'Inter, "SF Pro Display", system-ui, -apple-system, sans-serif'
const C = TILE / 2

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  return [c, g] as const
}

function ring(g: CanvasRenderingContext2D, r: number, width: number, color: string, from = 0, to = Math.PI * 2) {
  g.beginPath()
  g.arc(C, C, r, from, to)
  g.lineWidth = width
  g.strokeStyle = color
  g.stroke()
}

function label(g: CanvasRenderingContext2D, s: string, size: number, color: string, y = C) {
  g.font = `700 ${size}px ${FONT}`
  g.fillStyle = color
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(s, C, y)
}

function line(g: CanvasRenderingContext2D, pts: number[], width: number, color: string) {
  g.beginPath()
  g.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
  g.lineWidth = width
  g.strokeStyle = color
  g.stroke()
}

const TOP = -Math.PI / 2

function draw(g: CanvasRenderingContext2D, icon: Icon) {
  switch (icon.kind) {
    case 'idle': {
      g.strokeStyle = FULL
      g.lineWidth = 5
      g.beginPath()
      g.roundRect(40, 30, 64, 88, 10)
      g.stroke()
      line(g, [62, 30, 62, 14, 82, 14, 82, 30], 4, DIM)
      g.beginPath()
      g.arc(C, 62, 13, 0, Math.PI * 2)
      g.fillStyle = FULL
      g.fill()
      line(g, [56, 92, 88, 92], 4, DIM)
      line(g, [60, 104, 84, 104], 4, FAINT)
      break
    }
    case 'research':
      ring(g, 64, 2, FAINT)
      ring(g, 46, 3, DIM)
      ring(g, 28, 4, FULL, TOP, TOP + Math.PI * 1.4)
      g.beginPath()
      g.arc(C, C, 9, 0, Math.PI * 2)
      g.fillStyle = FULL
      g.fill()
      break
    case 'fit':
      ring(g, 62, 3, FAINT)
      ring(g, 62, 9, FULL, TOP, TOP + (Math.PI * 2 * Math.max(0, Math.min(100, icon.match))) / 100)
      label(g, String(icon.match), 46, FULL, C - 4)
      label(g, 'fit', 18, DIM, C + 30)
      break
    case 'rep':
      ring(g, 66, 2, FAINT)
      ring(g, 52, 2, DIM)
      g.beginPath()
      g.arc(C, C, 36, 0, Math.PI * 2)
      g.fillStyle = FULL
      g.fill()
      label(g, icon.letter, 36, '#000', C + 2)
      break
    case 'mic': {
      g.strokeStyle = FULL
      g.lineWidth = 6
      g.beginPath()
      g.roundRect(C - 14, 30, 28, 52, 14)
      g.stroke()
      g.beginPath()
      g.arc(C, 70, 28, 0, Math.PI)
      g.stroke()
      line(g, [C, 98, C, 114], 6, FULL)
      line(g, [C - 18, 114, C + 18, 114], 6, FULL)
      for (const [r, color] of [[44, DIM], [58, FAINT]] as const) {
        g.beginPath()
        g.arc(C, 62, r, -0.45, 0.45)
        g.lineWidth = 4
        g.strokeStyle = color
        g.stroke()
        g.beginPath()
        g.arc(C, 62, r, Math.PI - 0.45, Math.PI + 0.45)
        g.stroke()
      }
      break
    }
    case 'search':
      ring(g, 66, 2, FAINT)
      g.beginPath()
      g.arc(62, 62, 28, 0, Math.PI * 2)
      g.lineWidth = 7
      g.strokeStyle = FULL
      g.stroke()
      line(g, [83, 83, 106, 106], 10, FULL)
      line(g, [50, 54, 50, 54], 6, DIM)
      break
    case 'countdown':
      ring(g, 62, 3, FAINT)
      ring(g, 62, 9, FULL, TOP, TOP + (Math.PI * 2 * icon.secs) / icon.total)
      label(g, String(icon.secs), 58, FULL, C + 2)
      break
    case 'sending':
      ring(g, 62, 9, DIM)
      envelope(g)
      break
    case 'sent': {
      ring(g, 34, 5, FULL)
      line(g, [C - 16, C + 1, C - 4, C + 13, C + 18, C - 12], 7, FULL)
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i - Math.PI / 8
        line(g, [C + Math.cos(a) * 48, C + Math.sin(a) * 48, C + Math.cos(a) * 62, C + Math.sin(a) * 62], 4, i % 2 ? DIM : FULL)
      }
      break
    }
    case 'moon': {
      g.beginPath()
      g.arc(C - 4, C + 4, 40, 0, Math.PI * 2)
      g.fillStyle = FULL
      g.fill()
      g.beginPath()
      g.arc(C + 18, C - 12, 36, 0, Math.PI * 2)
      g.fillStyle = '#000'
      g.fill()
      for (const [x, y, r] of [[104, 40, 4], [118, 70, 3], [96, 104, 3]]) {
        g.beginPath()
        g.arc(x, y, r, 0, Math.PI * 2)
        g.fillStyle = DIM
        g.fill()
      }
      break
    }
    case 'failed':
      ring(g, 40, 4, DIM)
      label(g, icon.letter, 40, DIM, C + 2)
      line(g, [22, 22, 122, 122], 5, FULL)
      break
  }
}

function envelope(g: CanvasRenderingContext2D) {
  g.strokeStyle = FULL
  g.lineWidth = 6
  g.beginPath()
  g.roundRect(C - 34, C - 24, 68, 48, 6)
  g.stroke()
  line(g, [C - 30, C - 18, C, C + 4, C + 30, C - 18], 6, FULL)
}

async function png(c: HTMLCanvasElement): Promise<number[]> {
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob(b => (b ? ok(b) : fail(new Error('toBlob'))), 'image/png'))
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

export function tile(icon: Icon): Promise<number[]> {
  const [c, g] = canvas(TILE, TILE)
  draw(g, icon)
  return png(c)
}

/** The title, shrunk to fit, cut into `widths` strips (image containers max out at 288 wide). */
export function titleOverflows(text: string) {
  const [, g] = canvas(1, 1)
  g.font = `700 26px ${FONT}`
  return g.measureText(text).width > TITLE_W - 4
}

/** Bold title; if it still overflows at the smallest size it pans left by `tick`. */
export function title(text: string, widths: number[], tick = 0): Promise<number[][]> {
  const [c, g] = canvas(TITLE_W, TITLE_H)
  let size = 40
  do g.font = `700 ${size}px ${FONT}`
  while (g.measureText(text).width > TITLE_W - 4 && --size > 26)
  const over = g.measureText(text).width - (TITLE_W - 4)
  const steps = Math.ceil(over / 24)
  const off = over > 0 ? Math.min(over, Math.max(0, (tick % (steps + 6)) - 3) * 24) : 0
  g.fillStyle = FULL
  g.textBaseline = 'alphabetic'
  g.fillText(text, -off, 42)
  let x = 0
  return Promise.all(
    widths.map(w => {
      const [s, sg] = canvas(w, TITLE_H)
      sg.drawImage(c, x, 0, w, TITLE_H, 0, 0, w, TITLE_H)
      x += w
      return png(s)
    }),
  )
}

export const HINT_W = 288
export const HINT_H = 64

/** Action hints as outlined buttons: bold gesture, dim action. Wraps to a second row. */
export function hints(items: [string, string][]): Promise<number[]> {
  const [c, g] = canvas(HINT_W, HINT_H)
  const H = 26
  const PAD = 9
  let x = 1
  let y = 2
  for (const [gesture, action] of items) {
    g.font = `700 15px ${FONT}`
    const gw = g.measureText(gesture).width
    g.font = `500 15px ${FONT}`
    const aw = g.measureText(action).width
    const w = Math.ceil(PAD + gw + 6 + aw + PAD)
    if (x > 1 && x + w > HINT_W - 1) {
      x = 1
      y += H + 8
    }
    g.beginPath()
    g.roundRect(x, y, w, H, H / 2)
    g.lineWidth = 2
    g.strokeStyle = DIM
    g.stroke()
    g.textBaseline = 'middle'
    g.textAlign = 'left'
    g.font = `700 15px ${FONT}`
    g.fillStyle = FULL
    g.fillText(gesture, x + PAD, y + H / 2 + 1)
    g.font = `500 15px ${FONT}`
    g.fillStyle = DIM
    g.fillText(action, x + PAD + gw + 6, y + H / 2 + 1)
    x += w + 8
  }
  return png(c)
}
