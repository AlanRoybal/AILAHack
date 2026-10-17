import { chromium, type Browser, type Page } from 'playwright-core'
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
  const existing = ctx.pages().find(p => p.url().includes(host))
  if (existing) {
    await existing.bringToFront()
    return existing
  }
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}

export async function warmBrowser() {
  try {
    await connect()
    console.log(`[browser] connected to ${config.cdpUrl}`)
  } catch (err) {
    console.warn(`[browser] no Chrome at ${config.cdpUrl}: ${(err as Error).message}`)
    browser = null
  }
}
