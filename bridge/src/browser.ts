import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core'
import { config } from './config.ts'

let browser: Promise<Browser> | null = null

function connect(): Promise<Browser> {
  browser ??= chromium.connectOverCDP(config.cdpUrl).then(b => {
    b.on('disconnected', () => (browser = null))
    return b
  })
  return browser
}

/**
 * Reuses the already-open, logged-in tab for a site. Opening tabs and logging in
 * is the slow part, so the demo browser keeps one tab per site open all day.
 */
export async function tabFor(host: string, url: string): Promise<Page> {
  const b = await connect()
  const ctx = b.contexts()[0] ?? (await b.newContext())
  let page = ctx.pages().find(p => p.url().includes(host))
  if (page) await page.bringToFront()
  else {
    page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  }
  void watch(page)
  return page
}

// Live view: CDP screencast of whichever tab the agent is driving.
let onFrame: ((jpeg: string) => void) | null = null
let watching: { page: Page; cdp: CDPSession } | null = null

export function streamFrames(cb: (jpeg: string) => void) {
  onFrame = cb
}

async function watch(page: Page) {
  if (!onFrame || watching?.page === page) return
  const prev = watching
  const cdp = await page.context().newCDPSession(page)
  watching = { page, cdp }
  cdp.on('Page.screencastFrame', f => {
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    onFrame?.(f.data)
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 1100, maxHeight: 800 })
  if (prev) await prev.cdp.detach().catch(() => {})
}

export async function warmBrowser(host = 'opentable.com', url = 'https://www.opentable.com/') {
  try {
    await connect()
    console.log(`[browser] connected to ${config.cdpUrl}`)
    await tabFor(host, url)
  } catch (err) {
    console.warn(`[browser] no Chrome at ${config.cdpUrl}: ${(err as Error).message}`)
    browser = null
  }
}
