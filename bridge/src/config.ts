const env = process.env

export const config = {
  port: Number(env.PORT ?? 8787),
  token: env.HANDOFF_TOKEN ?? '',
  geminiKey: env.GEMINI_API_KEY ?? '',
  detectModel: env.DETECT_MODEL || 'gemini-3.5-flash-lite',
  agentModel: env.AGENT_MODEL || 'gemini-3.5-flash',
  deepgramKey: env.DEEPGRAM_API_KEY ?? '',
  cdpUrl: env.CDP_URL || 'http://localhost:9222',
  /** Apps Script web app that sends the requester a calendar invite. */
  inviteScriptUrl: env.INVITE_SCRIPT_URL ?? '',
  /** Requester's email; can also be set from the dashboard. */
  guestEmail: env.GUEST_EMAIL ?? '',
  /** Google Slides deck the agent edits, by id. */
  slidesId: env.SLIDES_ID ?? '',
  guestPhone: env.GUEST_PHONE ?? '',
  /** Cards below this detector confidence are dropped. */
  minConfidence: Number(env.MIN_CONFIDENCE || 0.75),
  /** An unanswered card or choice counts as no after this long. */
  cardMs: Number(env.CARD_MS || 6500),
  city: env.CITY || 'Westwood, Los Angeles',
  lat: Number(env.CITY_LAT || 34.0635),
  lng: Number(env.CITY_LNG || -118.4455),
  tz: env.TZ_NAME || 'America/Los_Angeles',
  openTableSubmit: env.OPENTABLE_SUBMIT === '1',
}
