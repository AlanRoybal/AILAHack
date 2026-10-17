const env = process.env

export const config = {
  port: Number(env.PORT ?? 8787),
  token: env.HANDOFF_TOKEN ?? '',
  geminiKey: env.GEMINI_API_KEY ?? '',
  detectModel: env.DETECT_MODEL || 'gemini-3.5-flash-lite',
  agentModel: env.AGENT_MODEL || 'gemini-3.5-flash',
  deepgramKey: env.DEEPGRAM_API_KEY ?? '',
  cdpUrl: env.CDP_URL || 'http://localhost:9222',
  slidesUrl: env.SLIDES_URL ?? '',
  slidesScriptUrl: env.SLIDES_SCRIPT_URL ?? '',
  city: env.CITY || 'Westwood, Los Angeles',
  lat: Number(env.CITY_LAT || 34.0635),
  lng: Number(env.CITY_LNG || -118.4455),
  openTableSubmit: env.OPENTABLE_SUBMIT === '1',
}
