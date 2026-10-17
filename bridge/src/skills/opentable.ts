import type { Page } from 'playwright-core'
import { tabFor } from '../browser.ts'
import { config } from '../config.ts'
import { getGuest, sendInvite, zoned } from '../invite.ts'
import { canText, sendText } from '../text.ts'
import { deliver } from './deliver.ts'
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
const STEPS = 4 // found restaurant, picked slot, at checkout, results sent

const minutes = (when: string) => Number(when.slice(11, 13)) * 60 + Number(when.slice(14, 16))
function slotLabel(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const short = (label: string) => label.replace(/ [AP]M$/, '')
const atMinutes = (when: string, min: number) => `${when.slice(0, 11)}${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function searchUrl(p: BookingParams) {
  // The term alone is ignored without coordinates; OpenTable falls back to the browser's region.
  const q = new URLSearchParams({ dateTime: `${p.when}:00`, covers: String(p.party), term: p.query, latitude: String(config.lat), longitude: String(config.lng) })
  return `${HOME}s?${q}`
}

async function clickText(page: Page, re: RegExp, timeout = 4000) {
  const el = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first()
  await el.waitFor({ state: 'visible', timeout })
  await el.click({ timeout: 2000 }).catch(() => el.evaluate((e: HTMLElement) => e.click()))
}

/** Slot links are `a[role=button]` labelled "7:00 PM Reserve table at <name> restaurant". */
const slotLink = (page: Page, slot: string, place = '') => page.locator(`a[role=button][aria-label^="${slot} Reserve table at ${place}"]`).first()
const cleanPlace = (s: string) => s.split(/ [-–] /)[0].trim().slice(0, 24)

/** Street address from the restaurant's profile page (JSON-LD), fetched inside the logged-in tab. */
async function address(page: Page) {
  const href = await page.locator('a[href*="opentable.com/r/"], a[href^="/r/"]').first().getAttribute('href', { timeout: 1500 }).catch(() => null)
  if (!href) return ''
  return page
    .evaluate(async url => {
      const h = await (await fetch(url)).text()
      const m = h.match(/"streetAddress":"([^"]+)","addressLocality":"([^"]+)"/)
      return m ? `${m[1]}, ${m[2]}` : ''
    }, new URL(href, 'https://www.opentable.com').href)
    .catch(() => '')
}

/** Every open slot on the results page, in page order. */
async function openSlots(page: Page) {
  const labels = await page.locator('a[role=button][aria-label*=" Reserve table at "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? ''))
  return labels.flatMap(l => {
    const m = l.match(/^(\d+):(\d\d) ([AP]M) Reserve table at (.*) restaurant$/)
    if (!m) return []
    const min = ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2])
    return [{ min, label: `${m[1]}:${m[2]} ${m[3]}`, rawPlace: m[4] }]
  })
}

export function bookingJob(id: string, title: string, p: BookingParams): Job {
  let page: Page | null = null
  let place = ''
  let rawPlace = ''
  let slots: Awaited<ReturnType<typeof openSlots>> = []
  const want = minutes(p.when)
  return {
    card: { id, kind: 'booking', title },
    // Loading results is the slowest step (2-5 s) and changes nothing, so it starts
    // while the card is still on the lens.
    async prepare(ctx) {
      page = await tabFor('opentable.com', HOME)
      await page.goto(searchUrl(p), { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.locator('a[role=button][aria-label*=" Reserve table at "]').first().waitFor({ timeout: 8000 }).catch(() => {})
      slots = await openSlots(page)
      const exact = slots.find(s => s.min === want)
      rawPlace = (exact ?? slots[0])?.rawPlace ?? ''
      place = cleanPlace(rawPlace)
      if (place) ctx.step(1, STEPS, 'Found')
    },
    async commit(ctx: SkillCtx): Promise<Outcome> {
      page ??= await tabFor('opentable.com', HOME)
      let min = want
      try {
        if (!slots.length) throw new Error('no slots')
        if (!slots.some(s => s.min === want)) {
          // The asked-for time is gone: offer the two closest times at the first restaurant.
          const near = slots
            .filter((s, i, all) => s.rawPlace === rawPlace && all.findIndex(o => o.rawPlace === rawPlace && o.min === s.min) === i)
            .sort((a, b) => Math.abs(a.min - want) - Math.abs(b.min - want))
            .slice(0, 2)
            .sort((a, b) => a.min - b.min)
          if (near.length < 2) throw new Error('no alternatives')
          ctx.progress(`${short(slotLabel(want))} is full`)
          const pick = await ctx.choose(`${short(slotLabel(want))} full · ${place}`, [short(near[0].label), short(near[1].label)])
          if (pick === null) return { phase: 'failed', text: 'Not booked' }
          min = near[pick].min
        }
        if (ctx.signal.aborted) return { phase: 'failed', text: 'Cancelled' }
        const slot = slotLabel(min)
        ctx.step(1, STEPS, 'Found')
        await slotLink(page, slot, rawPlace).click({ timeout: 3000 })
        ctx.step(2, STEPS, short(slot))
        // Some restaurants ask for a seating area first.
        await Promise.race([
          page.waitForURL(/booking\/details/, { timeout: 8000 }),
          clickText(page, /^(standard|indoor|dining room|select)/i, 8000).then(() => page!.waitForURL(/booking\/details/, { timeout: 8000 })),
        ])
      } catch {
        if (ctx.signal.aborted) return { phase: 'failed', text: 'Cancelled' }
        ctx.progress('Finding a table')
        const r = await runLoop(page, `On OpenTable, reserve ${p.party} people at ${slotLabel(min)} on ${p.when.slice(0, 10)} for "${p.query}" near ${p.area ?? config.city}. Stop on the "Complete reservation" page.`, { signal: ctx.signal, onStep: ctx.progress })
        if (r.status === 'gave_up') return { phase: 'failed', text: r.message }
      }
      const shown = await page.locator('[data-test="restaurantName"]').first().innerText({ timeout: 1500 }).catch(() => '')
      place = cleanPlace(shown) || place
      const time = short(slotLabel(min))
      ctx.step(3, STEPS, 'Checkout')
      const where = address(page)
      // Point of no return: a tilt-left before here leaves nothing behind.
      if (ctx.signal.aborted) return { phase: 'failed', text: 'Cancelled' }
      if (config.openTableSubmit) await clickText(page, /complete reservation/i, 5000)
      const head = `${config.openTableSubmit ? 'Booked' : 'Held'} ${place} ${time}`
      const addr = await where
      console.log(`[booking] ${place}: ${addr || 'no address found'}`)
      const day = new Date(`${p.when.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
      await deliver(ctx, ['Table'], [
        ...(getGuest()
          ? [{ label: 'Invite', run: () => sendInvite({ title: `Table for ${p.party}, ${place}`, start: zoned(atMinutes(p.when, min)), location: addr || place, description: config.openTableSubmit ? 'Booked on OpenTable by Handoff.' : 'Held at OpenTable checkout by Handoff (demo, not submitted).' }, ctx.signal) }]
          : []),
        ...(canText() ? [{ label: 'Text', run: () => sendText(`Table for ${p.party}, ${place}, ${day} ${time}.${addr ? ` ${addr}` : ''}`, ctx.signal) }] : []),
      ])
      ctx.step(4, STEPS, 'Sent')
      return { phase: 'done', text: head }
    },
    async cancel() {
      await page?.goto(HOME, { waitUntil: 'domcontentloaded' }).catch(() => {})
    },
  }
}
