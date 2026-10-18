// node oauth.mjs            -> prints the Google sign-in URL (gmail.send only)
// node oauth.mjs "<url>"    -> exchanges the code in the pasted localhost URL and prints the refresh token
const { GMAIL_CLIENT_ID: id, GMAIL_CLIENT_SECRET: secret } = process.env
const redirect = 'http://127.0.0.1:8765'
const pasted = process.argv[2]
if (!pasted) {
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/gmail.send' })
  console.log(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
} else {
  const code = new URL(pasted).searchParams.get('code')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }) })
  const j = await r.json()
  if (!j.refresh_token) throw new Error(`no refresh token: ${j.error ?? r.status}`)
  process.stdout.write(j.refresh_token)
}
