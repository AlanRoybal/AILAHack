# Booth Brief

Walk a career fair with your G2 on. A CREAO agent reads your resume, researches every LA Hacks AI Hackathon sponsor (open roles that fit you, recent news, who is at the booth), and ranks them by fit. The lens shows the ranked list and, for the booth in front of you, the role to ask about, who to ask for, and three talking points. After the conversation, tap and say the rep's name. It is matched against the known booth staff, CREAO finds their email with Apollo.io and writes the follow-up, and the lens counts down before CREAO sends it. Tilt your head left then right during the countdown to cancel.

Without the CREAO agent there are no briefs, no ranking and no email.

```
resume + sponsor list ──▶ server ──▶ CREAO agent (research, rank, brief) ──▶ briefs
lens (ring/temple) ◀──── /api/state ◀───────────────────────────────────────┘
tap, say name ──▶ /api/name (Deepgram, match reps.json) ──▶ CREAO (Apollo lookup + draft)
lens countdown, tilt left-right cancels ──▶ CREAO (send via Gmail) ──▶ inbox
```

## Layout

- `server/` Node server. Starts CREAO runs, polls them, keeps state, serves the dashboard at `http://localhost:8790`.
- `server/data/` `resume.txt` (your resume as plain text, gitignored), `sponsors.json` (LA Hacks AI Hackathon 2026 sponsors), `reps.json` (known booth staff per sponsor; spoken names are matched against it).
- `lens/` Even Hub app. One text container; the dev server proxies `/api` to the server.

## CREAO agent setup

On agent.creao.ai create one agent with a single text input named `request`, connect Gmail, add an Apollo.io API key as the secret `APOLLO_API_KEY`, and set write actions to Auto (API runs cannot stop for approval). The server sends it a `MODE: PREP_BRIEFS`, `MODE: FIND_AND_DRAFT` or `MODE: SEND_EMAIL` request and reads the JSON block from the reply. Copy the agent id and an API Trigger key (`capi_...`).

## Run

1. `cd server && cp .env.example .env`, fill in `CREAO_API_KEY`, `CREAO_APP_ID`, `TEST_EMAIL`, `DEEPGRAM_API_KEY`, then `npm install && npm start`.
2. `cd lens && npm install && npm run dev`, then `npm run qr` and scan it in the Even Realities app (or `npm run simulate`).
3. Open `http://localhost:8790` and press "Research sponsors with CREAO". Briefs appear on the dashboard and lens when the run finishes.

## Lens controls

- Ring scroll: move through sponsors.
- Tap: open the brief. Tap again after meeting them, then say the rep's name (tap to finish early). The phone page has a typed fallback.
- During "Sending in Ns": tilt left, then right within 2.5 s to cancel. The phone page has lean buttons for the simulator.
- Double tap: back to the list (exits from the list).

## Email safety

Follow-ups go to `TEST_EMAIL` and are addressed to the rep by name. They only go to the address Apollo found when `SEND_TO_REP=1`.
