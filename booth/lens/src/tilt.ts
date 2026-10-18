// Head tilt from the raw accelerometer. Units and axes are undocumented, so it
// works on the normalised gravity vector (unit-free). The lateral axis and its
// direction come from a one-time "lean right" calibration. A lean only counts
// once it is held, so ordinary nods and glances don't fire.

export const COMMIT_DEG = 14
const HOLD_MS = 220
const DEADZONE_DEG = 3
// After a commit the head has to come back near neutral (or 1.5 s pass) before
// leans count again, so returning from a right tilt never reads as a left one.
const SETTLE_DEG = 5
const SETTLE_MS = 1500
const CALIB_DELTA = Math.sin((COMMIT_DEG * Math.PI) / 180)

export class Tilt {
  axis = Number(localStorage.getItem('tilt.axis') ?? 0)
  sign = Number(localStorage.getItem('tilt.sign') ?? 1)
  calibrated = localStorage.getItem('tilt.calibrated') === '1'
  raw: [number, number, number] = [0, 0, 0]
  /** Signed lean in degrees, positive = right. */
  lean = 0
  private base: [number, number, number] | null = null
  private recent: [number, number, number][] = []
  private heldSince = 0
  private armed = false
  private calib: (() => void) | null = null
  private settleUntil = 0

  constructor(private readonly onCommit: (dir: 1 | -1) => void, private readonly onLean: (lean: number) => void) {}

  setAxis(axis: number) {
    this.axis = axis
    localStorage.setItem('tilt.axis', String(axis))
  }
  flip() {
    this.sign = -this.sign
    localStorage.setItem('tilt.sign', String(this.sign))
  }

  private neutral() {
    if (!this.recent.length) return
    const n = this.recent.length
    this.base = this.recent.reduce((a, v) => [a[0] + v[0] / n, a[1] + v[1] / n, a[2] + v[2] / n], [0, 0, 0])
  }

  /** Takes the current head pose as neutral and starts listening for a lean. */
  arm() {
    if (!this.settleUntil) this.neutral()
    this.armed = true
    this.heldSince = 0
  }
  disarm() {
    this.armed = false
    this.lean = 0
  }

  /** Waits for one held lean to the right and learns which axis and sign that is. */
  calibrate(done: () => void) {
    this.disarm()
    this.settleUntil = 0
    this.neutral()
    this.heldSince = 0
    this.calib = done
  }

  feed(x: number, y: number, z: number, now = Date.now()) {
    const len = Math.hypot(x, y, z) || 1
    const g: [number, number, number] = [x / len, y / len, z / len]
    this.raw = [x, y, z]
    this.recent.push(g)
    if (this.recent.length > 6) this.recent.shift()
    if (!this.base) this.base = g
    if (this.calib) return this.feedCalib(g, now)
    const d = Math.max(-1, Math.min(1, g[this.axis] - this.base[this.axis]))
    const lean = this.sign * Math.asin(d) * (180 / Math.PI)
    if (this.settleUntil) {
      if (Math.abs(lean) > SETTLE_DEG && now < this.settleUntil) return void (this.lean = 0)
      this.settleUntil = 0
      this.base = g
      return void (this.lean = 0)
    }
    this.lean = Math.abs(lean) < DEADZONE_DEG ? 0 : lean
    if (!this.armed) return
    this.onLean(this.lean)
    if (Math.abs(this.lean) >= COMMIT_DEG) {
      this.heldSince ||= now
      if (now - this.heldSince >= HOLD_MS) {
        this.disarm()
        this.settleUntil = now + SETTLE_MS
        this.onCommit(lean > 0 ? 1 : -1)
      }
    } else this.heldSince = 0
  }

  private feedCalib(g: [number, number, number], now: number) {
    const d = g.map((v, i) => v - this.base![i])
    const axis = d.reduce((best, v, i) => (Math.abs(v) > Math.abs(d[best]) ? i : best), 0)
    if (Math.abs(d[axis]) < CALIB_DELTA) return void (this.heldSince = 0)
    this.heldSince ||= now
    if (now - this.heldSince < HOLD_MS + 100) return
    this.setAxis(axis)
    this.sign = d[axis] > 0 ? 1 : -1
    localStorage.setItem('tilt.sign', String(this.sign))
    localStorage.setItem('tilt.calibrated', '1')
    this.calibrated = true
    const done = this.calib!
    this.calib = null
    this.heldSince = 0
    done()
  }
}
