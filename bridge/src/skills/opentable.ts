import type { Page } from 'playwright-core'
import { tabFor } from '../browser.ts'
import { config } from '../config.ts'
import { runLoop } from '../loop.ts'
import type { Job, Outcome, SkillCtx } from './types.ts'

export interface BookingParams {
  /** Cuisine or restaurant name, e.g. "italian" or "Napa Valley Grille". */
  query: string
  /** Local date-time, "YYYY-MM-DDTHH:MM". */
  when: string
  party: number
  area?: string
}

const HOME = 'https://www.opentable.com/'

function slotLabel(when: string) {
  const [h, m] = when.slice(11, 16).split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function searchUrl(p: BookingParams) {
  // The term alone is ignored without coordinates; OpenTable falls back to the browser's region.
  const q = new URLSearchParams({ dateTime: `${p.when}:00`, covers: String(p.party), term: p.query, latitude: String(config.lat), longitude: String(config.lng) })
  return `${HOME}s?${q}`
}

async function clickText(page: Page, re: RegExp, timeout = 4000) {
  const el = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first()
  await el.waitFor({ state: 'visible', timeout })
  const name = (await el.innerText().catch(() => '')).trim()
  await el.click({ timeout: 2000 }).catch(() => el.evaluate((e: HTMLElement) => e.click()))
  return name
}

/** Slot links are `a[role=button]` labelled "7:00 PM Reserve table at <name> restaurant". */
const slotLink = (page: Page, slot: string) => page.locator(`a[role=button][aria-label^="${slot} Reserve table at"]`).first()

async function placeOf(page: Page, slot: string) {
  const label = (await slotLink(page, slot).getAttribute('aria-label', { timeout: 1000 }).catch(() => '')) ?? ''
  return label.replace(/^.*Reserve table at /, '').replace(/ restaurant$/, '').split(/ [-–] /)[0].slice(0, 24)
}

export function bookingJob(id: string, title: string, p: BookingParams): Job {
  let page: Page | null = null
  let place = ''
  return {
    card: { id, kind: 'booking', title },
    // Loading results is the slowest step (2-5 s) and changes nothing, so it starts
    // while the card is still on the lens.
    async prepare() {
      page = await tabFor('opentable.com', HOME)
      await page.goto(searchUrl(p), { waitUntil: 'domcontentloaded', timeout: 20000 })
      await slotLink(page, slotLabel(p.when)).waitFor({ timeout: 8000 }).catch(() => {})
      place = await placeOf(page, slotLabel(p.when))
    },
    async commit(ctx: SkillCtx): Promise<Outcome> {
      page ??= await tabFor('opentable.com', HOME)
      const slot = slotLabel(p.when)
      try {
        ctx.progress(`Booking ${slot}`)
        place = (await placeOf(page, slot)) || place
        await slotLink(page, slot).click({ timeout: 3000 })
        // Some restaurants ask for a seating area first.
        await Promise.race([
          page.waitForURL(/booking\/details/, { timeout: 8000 }),
          clickText(page, /^(standard|indoor|dining room|select)/i, 8000).then(() => page!.waitForURL(/booking\/details/, { timeout: 8000 })),
        ])
      } catch {
        ctx.progress('Finding a table')
        const r = await runLoop(page, `On OpenTable, reserve ${p.party} people at ${slot} on ${p.when.slice(0, 10)} for "${p.query}" near ${p.area ?? config.city}. Stop on the "Complete reservation" page.`, { signal: ctx.signal, onStep: ctx.progress })
        if (r.status === 'gave_up') return { phase: 'failed', text: r.message }
      }
      const shown = await page.locator('[data-test="restaurantName"]').first().innerText({ timeout: 1500 }).catch(() => '')
      place = shown.split(/ [-–] /)[0].trim().slice(0, 24) || place
      if (config.openTableSubmit) {
        await clickText(page, /complete reservation/i, 5000)
        return { phase: 'done', text: `Booked ${place} ${slot}` }
      }
      return { phase: 'done', text: `Held ${place} ${slot} · ${p.party}` }
    },
    async cancel() {
      await page?.goto(HOME, { waitUntil: 'domcontentloaded' }).catch(() => {})
    },
  }
}
