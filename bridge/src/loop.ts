import type { Page } from 'playwright-core'
import { config } from './config.ts'
import { geminiJson } from './gemini.ts'

// Numbers every visible interactive element and returns a compact list for the model.
const OBSERVE = `() => {
  const sel = 'a,button,input,select,textarea,[role=button],[role=option],[role=tab],[role=menuitem],[role=link],[role=combobox],[role=checkbox],[contenteditable=true]'
  const out = []; let i = 0
  document.querySelectorAll('[data-aid]').forEach(e => e.removeAttribute('data-aid'))
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
    const st = getComputedStyle(e); if (st.visibility === 'hidden' || st.display === 'none') continue
    const label = (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || '').trim().replace(/\\s+/g, ' ').slice(0, 70)
    if (!label && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)) continue
    e.setAttribute('data-aid', i)
    let extra = e.tagName === 'INPUT' ? ' type=' + e.type + ' value="' + (e.value || '').slice(0, 30) + '"' : ''
    if (e.tagName === 'SELECT') extra = ' options=' + [...e.options].slice(0, 25).map(o => o.text).join('|')
    out.push('[' + i + '] ' + e.tagName.toLowerCase() + (e.getAttribute('role') ? ' role=' + e.getAttribute('role') : '') + ' "' + label + '"' + extra)
    if (++i >= 150) break
  }
  return { url: location.href, title: document.title, els: out.join('\\n'), text: document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 1500) }
}`

const SYSTEM = `You operate a web browser to finish one task for the user. Each turn you get the page's interactive elements as [id] tag "label", plus some visible text.
Return JSON: {"actions":[...],"status":"continue"|"done"|"need_user","message":"<=40 chars for smart glasses"}.
Actions: {"a":"click","id":N} | {"a":"type","id":N,"text":"...","enter":bool} | {"a":"select","id":N,"value":"option text"} | {"a":"key","key":"Enter|Escape|Tab"} | {"a":"scroll","dy":600} | {"a":"goto","url":"..."}
Batch several actions per turn when confident. Be fast. If an action fails twice, try another way (Escape closes overlays).
Never submit a payment or the final reservation button; stop with need_user right before it.
Today is ${new Date().toLocaleDateString('en-US', { timeZone: config.tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}.`

type Action = { a: string; id?: number; text?: string; enter?: boolean; value?: string; key?: string; dy?: number; url?: string }
interface Reply {
  actions?: Action[]
  status: 'continue' | 'done' | 'need_user'
  message?: string
}

async function act(page: Page, a: Action) {
  const loc = page.locator(`[data-aid="${a.id}"]`).first()
  switch (a.a) {
    case 'click':
      try {
        await loc.click({ timeout: 2000 })
      } catch {
        await loc.evaluate((e: HTMLElement) => (e.scrollIntoView({ block: 'center' }), e.click()), undefined, { timeout: 2000 })
      }
      break
    case 'type':
      if (await loc.evaluate((e: Element) => e.tagName === 'INPUT' || e.tagName === 'TEXTAREA', undefined, { timeout: 2000 })) await loc.fill(a.text ?? '', { timeout: 3000 })
      else {
        await loc.click({ timeout: 2000 })
        await page.keyboard.type(a.text ?? '')
      }
      if (a.enter) await page.keyboard.press('Enter')
      break
    case 'select':
      await loc.selectOption({ label: a.value ?? '' }, { timeout: 3000 })
      break
    case 'key':
      await page.keyboard.press(a.key ?? 'Escape')
      break
    case 'scroll':
      await page.mouse.wheel(0, a.dy ?? 600)
      break
    case 'goto':
      await page.goto(a.url ?? '', { waitUntil: 'domcontentloaded', timeout: 20000 })
      break
  }
}

export interface LoopResult {
  status: 'done' | 'need_user' | 'gave_up'
  message: string
  steps: number
}

/** Generic observe -> Gemini -> act loop. Used when a site recipe misses. */
export async function runLoop(page: Page, task: string, opts: { maxSteps?: number; signal?: AbortSignal; onStep?: (msg: string) => void } = {}): Promise<LoopResult> {
  const history: { role: 'user' | 'model'; text: string }[] = []
  const max = opts.maxSteps ?? 15
  let lastErr = ''
  for (let step = 0; step < max; step++) {
    if (opts.signal?.aborted) return { status: 'gave_up', message: 'Cancelled', steps: step }
    let obs: { url: string; title: string; els: string; text: string } | null = null
    for (let i = 0; i < 10 && !obs; i++) {
      try {
        obs = await page.evaluate(`(${OBSERVE})()`)
      } catch {
        await page.waitForTimeout(250)
      }
    }
    if (!obs) return { status: 'gave_up', message: 'Page never settled', steps: step }
    history.push({ role: 'user', text: `${step === 0 ? `TASK: ${task}\n` : ''}${lastErr ? `LAST ERROR: ${lastErr}\n` : ''}URL: ${obs.url}\nTITLE: ${obs.title}\nELEMENTS:\n${obs.els}\nTEXT:\n${obs.text}` })
    // Only the latest page matters; older observations are trimmed to keep calls fast.
    const turns = history.map((h, i) => (h.role === 'user' && i < history.length - 1 ? { ...h, text: h.text.split('\nELEMENTS:')[0] } : h))
    const reply = await geminiJson<Reply>(config.agentModel, SYSTEM, turns, opts.signal)
    history.push({ role: 'model', text: JSON.stringify(reply) })
    if (reply.message) opts.onStep?.(reply.message)
    if (reply.status !== 'continue') return { status: reply.status, message: reply.message ?? '', steps: step + 1 }
    lastErr = ''
    for (const a of reply.actions ?? []) {
      try {
        await act(page, a)
      } catch (err) {
        lastErr = `${JSON.stringify(a)} failed: ${(err as Error).message.split('\n')[0]}`
        break
      }
    }
    await page.waitForTimeout(300)
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {})
  }
  return { status: 'gave_up', message: 'Ran out of steps', steps: max }
}
