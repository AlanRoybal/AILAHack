// Head tilt from the raw accelerometer. Units and axes are undocumented, so it
// works on the normalised gravity vector (unit-free) and the lateral axis is
// picked on the phone page. A lean only counts once it is held, so ordinary
// nods and glances don't fire.

export const COMMIT_DEG = 14
const HOLD_MS = 220
const DEADZONE_DEG = 3

export class Tilt {
  axis = Number(localStorage.getItem('tilt.axis') ?? 0)
  sign = Number(localStorage.getItem('tilt.sign') ?? 1)
  raw: [number, number, number] = [0, 0, 0]
  /** Signed lean in degrees, positive = right. */
  lean = 0
  private base: [number, number, number] | null = null
  private recent: [number, number, number][] = []
  private heldSince = 0
  private armed = false

  constructor(private readonly onCommit: (dir: 1 | -1) => void, private readonly onLean: (lean: number) => void) {}

  setAxis(axis: number) {
    this.axis = axis
    localStorage.setItem('tilt.axis', String(axis))
  }
  flip() {
    this.sign = -this.sign
    localStorage.setItem('tilt.sign', String(this.sign))
  }

  /** Takes the current head pose as neutral and starts listening for a lean. */
  arm() {
    if (this.recent.length) {
      const n = this.recent.length
      this.base = this.recent.reduce((a, v) => [a[0] + v[0] / n, a[1] + v[1] / n, a[2] + v[2] / n], [0, 0, 0])
    }
    this.armed = true
    this.heldSince = 0
  }
  disarm() {
    this.armed = false
    this.lean = 0
  }

  feed(x: number, y: number, z: number, now = Date.now()) {
    const len = Math.hypot(x, y, z) || 1
    const g: [number, number, number] = [x / len, y / len, z / len]
    this.raw = [x, y, z]
    this.recent.push(g)
    if (this.recent.length > 6) this.recent.shift()
    if (!this.base) this.base = g
    const d = Math.max(-1, Math.min(1, g[this.axis] - this.base[this.axis]))
    const lean = this.sign * Math.asin(d) * (180 / Math.PI)
    this.lean = Math.abs(lean) < DEADZONE_DEG ? 0 : lean
    if (!this.armed) return
    this.onLean(this.lean)
    if (Math.abs(this.lean) >= COMMIT_DEG) {
      this.heldSince ||= now
      if (now - this.heldSince >= HOLD_MS) {
        this.disarm()
        this.onCommit(lean > 0 ? 1 : -1)
      }
    } else this.heldSince = 0
  }
}
