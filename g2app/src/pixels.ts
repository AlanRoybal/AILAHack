// Pixel art for the lens tiles. Sprites are drawn at whole-pixel scales and
// auto-centred on their lit area, so each one only needs to be drawn once.

import { Framebuffer, fillCircle, fillSector, strokeCircle } from 'g2-kit/core'

type Sprite = readonly string[]

export const SPRITES = {
  table: [
    '..#.#.#....##...',
    '..#.#.#...###...',
    '..#.#.#...###...',
    '..#.#.#...###...',
    '..#####...###...',
    '..#####...###...',
    '...###....###...',
    '....#.....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
  ],
  meet: [
    '...##....##...',
    '##############',
    '##############',
    '#............#',
    '#.##.##.##.#.#',
    '#.##.##.##...#',
    '#............#',
    '#.##.##.##.#.#',
    '#.##.##.##...#',
    '#............#',
    '#.##.##......#',
    '#.##.##......#',
    '#............#',
    '##############',
  ],
  slides: [
    '################',
    '#..............#',
    '#..........##..#',
    '#......##..##..#',
    '#..##..##..##..#',
    '#..##..##..##..#',
    '#..##..##..##..#',
    '#..............#',
    '################',
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##....##....',
  ],
  send: [
    '################',
    '##............##',
    '#.#..........#.#',
    '#..#........#..#',
    '#...#......#...#',
    '#....#....#....#',
    '#.....#..#.....#',
    '#......##......#',
    '#..............#',
    '#..............#',
    '################',
  ],
  web: [
    '......####',
    '.....####.',
    '....####..',
    '...####...',
    '..########',
    '......###.',
    '.....###..',
    '....###...',
    '...###....',
    '..##......',
  ],
  check: [
    '.............##',
    '............###',
    '...........###.',
    '..........###..',
    '.........###...',
    '##......###....',
    '###....###.....',
    '.###..###......',
    '..######.......',
    '...####........',
    '....##.........',
  ],
  cross: [
    '##......##',
    '###....###',
    '.###..###.',
    '..######..',
    '...####...',
    '..######..',
    '.###..###.',
    '###....###',
    '##......##',
  ],
  ask: [
    '..####..',
    '.##..##.',
    '.....##.',
    '....##..',
    '...##...',
    '...##...',
    '........',
    '...##...',
    '...##...',
  ],
  right: ['##......', '####....', '######..', '########', '######..', '####....', '##......'],
} satisfies Record<string, Sprite>

export type SpriteName = keyof typeof SPRITES | 'left'

const mirror = (s: Sprite) => s.map(r => [...r].reverse().join(''))

/** Draws a sprite centred on (cx, cy) at an integer scale. */
export function sprite(fb: Framebuffer, name: SpriteName, cx: number, cy: number, scale: number, level: number) {
  const s = name === 'left' ? mirror(SPRITES.right) : SPRITES[name]
  const w = Math.max(...s.map(r => r.length))
  const x0 = Math.round(cx - (w * scale) / 2)
  const y0 = Math.round(cy - (s.length * scale) / 2)
  s.forEach((row, y) => [...row].forEach((c, x) => c === '#' && fb.fillRect(x0 + x * scale, y0 + y * scale, scale, scale, level)))
}

const lv = (n: number, k: number) => (k >= 1 ? n : Math.max(1, Math.round(n * k)))

export const ICON_W = 112
export const ICON_H = 96
const RING = 12

/**
 * Task icon with an optional ring of 12 segments around it. `ring.lit` segments
 * are full; `ring.head` (if set) is the segment the sweep is on, with a fading trail.
 */
export function icon(name: SpriteName, o: { ring?: { lit: number; head?: number }; k?: number } = {}) {
  const k = o.k ?? 1
  const fb = new Framebuffer(ICON_W, ICON_H)
  const cx = 48
  const cy = 48
  if (o.ring) {
    for (let i = 0; i < RING; i++) {
      let level = i < o.ring.lit ? 15 : 3
      const h = o.ring.head
      if (h !== undefined) {
        const back = (h - i + RING) % RING
        if (back < 3 && i >= o.ring.lit) level = [15, 9, 5][back]
      }
      fillSector(fb, cx, cy, 39, 46, i * 30 + 4, i * 30 + 26, lv(level, k))
    }
    sprite(fb, name, cx, cy, 3, lv(15, k))
  } else sprite(fb, name, cx, cy, 4, lv(15, k))
  fb.fillRect(ICON_W - 4, 8, 2, ICON_H - 16, lv(5, k))
  return fb
}

export const METER_W = 288
export const METER_H = 40
const HALF = 108

/** Tilt meter: a thick bar with a drop on its end grows from the centre toward the leaned side. */
export function meter(u: number, k = 1) {
  const fb = new Framebuffer(METER_W, METER_H)
  const c = METER_W / 2
  const y = METER_H / 2
  fb.fillRect(c - HALF, y - 1, HALF * 2, 2, lv(4, k))
  fb.fillRect(c - 1, y - 11, 2, 22, lv(8, k))
  const len = Math.round(Math.abs(u) * HALF)
  if (len > 0) {
    const x = u > 0 ? c : c - len
    fb.fillRect(x, y - 4, len, 8, lv(15, k))
    fillCircle(fb, u > 0 ? c + len : c - len, y, 8, lv(15, k))
  }
  const side = (dir: number) => (Math.sign(u) === dir ? (Math.abs(u) >= 1 ? 15 : 10) : 5)
  sprite(fb, 'left', 14, y, 3, lv(side(-1), k))
  sprite(fb, 'right', METER_W - 14, y, 3, lv(side(1), k))
  return fb
}

export const ROW = 27
export const MARKS_W = 24

/** One status mark per checklist row, on the native text line pitch. */
export function marks(states: ('done' | 'pending' | 'fail')[]) {
  const fb = new Framebuffer(MARKS_W, Math.max(20, states.length * ROW))
  states.forEach((s, i) => {
    const cy = i * ROW + 14
    if (s === 'done') fillCircle(fb, 12, cy, 7, 15)
    else if (s === 'fail') sprite(fb, 'cross', 12, cy, 1, 15)
    else strokeCircle(fb, 12, cy, 6, 6, 2)
  })
  return fb
}
