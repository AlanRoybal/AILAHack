// Line art for the lens, drawn on a canvas and sent as PNG. Black is see-through
// on the G2, so everything is thin bright strokes on black.

type Ctx = CanvasRenderingContext2D
const cache = new Map<string, Promise<Uint8Array>>()

function png(key: string, w: number, h: number, draw: (c: Ctx) => void): Promise<Uint8Array> {
  let p = cache.get(key)
  if (!p) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const c = canvas.getContext('2d')!
    c.fillStyle = '#000'
    c.fillRect(0, 0, w, h)
    draw(c)
    p = new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png')).then(async b => new Uint8Array(await b.arrayBuffer()))
    cache.set(key, p)
  }
  return p
}

const g = (v: number) => `rgb(${v},${v},${v})`

export const RING = 48
export const RING_FRAMES = 8

/** Segmented spinner: 8 ticks, a bright head with a fading tail. */
export function ring(frame: number) {
  return png(`ring${frame}`, RING, RING, c => {
    const r = RING / 2
    c.lineCap = 'round'
    c.lineWidth = 4
    for (let i = 0; i < RING_FRAMES; i++) {
      const age = (frame - i + RING_FRAMES) % RING_FRAMES
      const a = (i / RING_FRAMES) * Math.PI * 2 - Math.PI / 2
      c.strokeStyle = g([255, 170, 110, 70, 45, 45, 45, 45][age])
      c.beginPath()
      c.moveTo(r + Math.cos(a) * (r - 14), r + Math.sin(a) * (r - 14))
      c.lineTo(r + Math.cos(a) * (r - 4), r + Math.sin(a) * (r - 4))
      c.stroke()
    }
  })
}

export const DROP_W = 88
export const DROP_H = 96
export const DROP_FRAMES = 5

/**
 * Sideways water drop at the edge the card leaves through. dir 1 = right edge.
 * Frames: the card's edge bulges, necks, pinches off into a drop, the drop flies
 * outward, then a ripple where it left.
 */
export function drop(dir: 1 | -1, frame: number) {
  return png(`drop${dir}${frame}`, DROP_W, DROP_H, c => {
    c.save()
    if (dir === -1) {
      c.translate(DROP_W, 0)
      c.scale(-1, 1)
    }
    const cy = DROP_H / 2
    c.strokeStyle = g(255)
    c.lineWidth = 3
    c.beginPath()
    if (frame === 0) {
      // Bulge: a rounded lobe pushing out of the card edge.
      c.moveTo(0, cy - 26)
      c.bezierCurveTo(30, cy - 26, 40, cy - 10, 40, cy)
      c.bezierCurveTo(40, cy + 10, 30, cy + 26, 0, cy + 26)
    } else if (frame === 1) {
      // Neck: lobe stretches, waist pinches.
      c.moveTo(0, cy - 18)
      c.bezierCurveTo(16, cy - 18, 18, cy - 6, 30, cy - 14)
      c.arc(46, cy, 18, -Math.PI * 0.75, Math.PI * 0.75)
      c.bezierCurveTo(18, cy + 6, 16, cy + 18, 0, cy + 18)
    } else if (frame === 2) {
      // Pinch-off: a teardrop with its tail pointing back at the card.
      c.moveTo(30, cy)
      c.bezierCurveTo(44, cy - 4, 46, cy - 16, 60, cy - 16)
      c.arc(60, cy, 16, -Math.PI / 2, Math.PI / 2)
      c.bezierCurveTo(46, cy + 16, 44, cy + 4, 30, cy)
    } else if (frame === 3) {
      // Free drop, round, near the edge.
      c.arc(72, cy, 12, 0, Math.PI * 2)
      c.moveTo(52, cy)
      c.lineTo(46, cy)
    } else {
      // Ripple left behind.
      c.strokeStyle = g(120)
      c.arc(84, cy, 10, Math.PI * 0.6, Math.PI * 1.4)
      c.stroke()
      c.beginPath()
      c.strokeStyle = g(60)
      c.arc(84, cy, 22, Math.PI * 0.65, Math.PI * 1.35)
    }
    c.stroke()
    c.restore()
  })
}

/** Blank tile, used to clear an image slot. */
export const blank = (w: number, h: number) => png(`blank${w}x${h}`, w, h, () => {})
