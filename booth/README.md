# Booth Brief

Walk a career fair with your G2 on. A CREAO agent reads your resume, researches every LA Hacks AI Hackathon sponsor (open roles that fit you, recent news, who is at the booth), and ranks them by fit. The lens shows the ranked list and, for the booth in front of you, the role to ask about, who to ask for, and three talking points. After the conversation, tap and say the rep's name. It is matched against the known booth staff, CREAO finds their email with Apollo.io and writes the follow-up, and the lens counts down before CREAO sends it. Tilt your head left then right during the countdown to cancel.

Without the CREAO agent there are no briefs, no ranking and no email.

```
resume + sponsor list ──▶ server ──▶ CREAO agent (research, rank, brief) ──▶ briefs
lens (ring/temple) ◀──── /api/state ◀───────────────────────────────────────┘
tap, say name ──▶ /api/name (Deepgram, match reps.json) ──▶ CREAO (Apollo lookup + draft)
lens countdown, tilt left-right cancels ──▶ CREAO (calls the AWS mailer) ──▶ inbox
```

## CREAO agent

- Agent ID: `f98b8927-e54e-4c80-baa1-2183e197d417`
- Agent link: https://agent.creao.ai/install/f98b8927-e54e-4c80-baa1-2183e197d417?version=a08e7bc0-7160-42c2-8eef-56d08867e200
- Run link (sponsor research run that ranked CREAO AI first): https://agent.creao.ai/share/43936a05a4fa907a77314e5a20d85570

## Layout

- `server/` Node server. Starts CREAO runs, polls them, keeps state, serves the dashboard at `http://localhost:8790`.
- `server/data/` `resume.txt` (your resume as plain text, gitignored), `sponsors.json` (LA Hacks AI Hackathon 2026 sponsors), `reps.json` (known booth staff per sponsor; spoken names are matched against it).
- `lens/` Even Hub app. Each screen is a 144px icon tile and a bold title drawn as images (`src/art.ts`) plus three text containers for detail and hints (`src/main.ts`); the dev server proxies `/api` to the server.

## CREAO agent setup

The agent is **Booth Brief** on agent.creao.ai (agent ID `f98b8927-e54e-4c80-baa1-2183e197d417`), with one text input `request` and autonomy set to Auto, since API runs cannot stop for approval. The server runs it through the agent's API Trigger (`capi_` key) and sends a `MODE: PREP_BRIEFS`, `MODE: FIND_AND_DRAFT` or `MODE: SEND_EMAIL` request, then reads the JSON block from the reply. For `SEND_EMAIL` the agent calls the Booth Brief mailer (below) from its sandbox. Runs show up under the agent's Recent runs.

`npm run setup` instead creates an equivalent hosted agent on the CREAO Developer Platform when `CREAO_API_KEY` is a `cr_sk_` project key.

## Run

1. `cd server && cp .env.example .env`, set `CREAO_AGENT_ID` to the agent ID, `CREAO_API_KEY` to a key from the agent's API Trigger panel, and `APOLLO_API_KEY`. Deploy the mailer and set `MAILER_URL` and `MAILER_TOKEN`. The Apollo key is passed to CREAO in each lookup request. Also fill `TEST_EMAIL`, `DEEPGRAM_API_KEY`, then `npm install && npm start`.
2. `cd lens && npm install && npm run dev`, then `npm run qr` and scan it in the Even Realities app (or `npm run simulate`).
3. Open `http://localhost:8790` and press "Research sponsors with CREAO". Briefs appear on the dashboard and lens when the run finishes.

## Lens controls

- Ring scroll: move through sponsors.
- Tap: open the brief. Tap again after meeting them, then say the rep's name (tap to finish early). The phone page has a typed fallback.
- During "Sending in Ns": tilt left, then right within 2.5 s to cancel. The phone page has lean buttons for the simulator.
- Double tap: back to the list (exits from the list).

## Mailer (AWS Lambda + Gmail OAuth)

`mailer/` is a Lambda Function URL with one route, `POST /send` (`{to, subject, body}`, `Authorization: Bearer $SEND_TOKEN`). It sends through the Gmail API with a stored refresh token and only to addresses in `ALLOWED_TO`.

1. In Google Cloud, enable the Gmail API, set up the OAuth consent screen (External, Testing, sending address as a test user) and create a Desktop OAuth client.
2. `GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node mailer/oauth.mjs` prints a sign-in URL. After consent the browser lands on a `127.0.0.1:8765` page that fails to load; run `node mailer/oauth.mjs "<that URL>"` to print the refresh token.
3. With AWS CLI v2 credentials, `GMAIL_REFRESH_TOKEN=... SEND_TOKEN=$(openssl rand -hex 32) ALLOWED_TO=you@example.com mailer/deploy.sh` prints the Function URL. Put it in `MAILER_URL` and the token in `MAILER_TOKEN`.

Refresh tokens from a Testing-mode OAuth app expire after 7 days.

## Email safety

Follow-ups go to `TEST_EMAIL` and are addressed to the rep by name. They only go to the address Apollo found when `SEND_TO_REP=1`.
