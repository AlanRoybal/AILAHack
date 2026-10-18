export interface Rep { name: string; title?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean)

function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}

const wordSim = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length)

/** Best rep for what was heard: each name word takes its closest heard word. */
export function matchRep(heard: string, reps: Rep[]): { rep: Rep; score: number } | null {
  const words = norm(heard)
  if (!words.length) return null
  let best: { rep: Rep; score: number } | null = null
  for (const rep of reps) {
    const parts = norm(rep.name)
    const score = parts.reduce((s, p) => s + Math.max(...words.map(w => wordSim(w, p))), 0) / parts.length
    if (!best || score > best.score) best = { rep, score }
  }
  return best && best.score >= 0.6 ? best : null
}
