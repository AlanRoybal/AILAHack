# Handoff

Someone across the table asks you for something ("can you book us a table for two at 7?"). A one-line card appears on your Even Realities G2 lens. The card shows what was understood (`Table · 2 · 7:00 · Italian`). Tilt your head right to accept or left to skip. An agent on your laptop does it in an already-open, logged-in browser while people at the table watch it live on the dashboard. If 7:00 is full the lens offers `6:45 ←  → 7:30` and you tilt to pick. One tilt gets the person who asked several results: the table, a calendar invite with the address, and an iMessage. The lens checks each one off (`✓ Table   ✓ Invite   · Text`). "We should get lunch next week" reads your Google Calendar and shows two free times (`Mon 11:30 ←  → Wed 11:30`), and the tilt that picks one sends the invite. You never speak to the glasses.

```
G2 mic (other speaker only) ──PCM──▶ bridge ──▶ Deepgram live STT
                                        │          │ interim + final text
                                        │          ▼
lens card ◀── card ── Gemini flash-lite task detect (runs on interim text)
   │                                    │
   │ tilt / tap                         ├─ prepare() starts now (search page loads)
   └──────── decide ──────────────────▶ └─ commit() on accept ──▶ persistent Chrome (CDP)
lens ✓ / ? / × ◀──────────── status ───────────────────────────────┘
```

## Layout

- `g2app/` Even Hub app (Vite + `@evenrealities/even_hub_sdk`). Lens states, tilt detection, mic forwarding, phone control page.
- `bridge/` Node server. STT, task detection, skills, dashboard at `http://localhost:8787`.
- `bridge/src/skills/` `opentable.ts` (deterministic recipe with an LLM loop fallback), `web.ts` (generic loop).
- `appscript/Code.gs` Apps Script web app that sends the requester a calendar invite and returns the wearer's busy times.
- `bridge/src/text.ts` iMessage to the requester through the Messages app (bridge must run on a Mac, phone number set on the dashboard).
- `shared/protocol.ts` messages between lens, dashboard and bridge.

## Run

1. Start Chrome with a persistent profile and log into OpenTable:
   `google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.handoff-chrome`
   Leave an OpenTable tab open.
   Paste `appscript/Code.gs` into a new project at script.google.com, run `authorize`, deploy it as a web app (execute as you, access Anyone) and put the URL in `INVITE_SCRIPT_URL`.
2. Bridge: `cd bridge && cp .env.example .env` (fill in keys), `npm install`, `npm start`.
3. Lens app: `cd g2app && npm install && npm run dev`, then `npm run qr` and scan it in the Even Realities app.
4. Open `http://localhost:8787` on the laptop for the live browser view, transcript, timer and timing table. Enter the requester's email there. Typing a request runs the same path as speech.

`npm run bench -- "book us a table for two tomorrow at 7, Italian"` in `bridge/` times the whole path without glasses.

## Controls

- First launch: the lens says "lean right" once. That sets the tilt axis and direction and is saved on the phone.
- Tilt right and hold (~14°, 0.2 s): accept. Tilt left: skip. The card follows your head, then leaves as a drop. Ignoring it for 6.5 s is a skip.
- Tilt left while the ring runs: cancel before the final step.
- Ring or temple tap: accept. Double tap: skip.
- Cards only show when the speaker is tagged as someone else, the request is addressed to you, the detector is confident, and the glasses are on.

## Speed choices

- Detection runs on Deepgram interim results with `endpointing=200`, so the card can appear before the speaker finishes.
- One Deepgram socket and one CDP connection stay open all session.
- Each skill splits into `prepare` (safe, runs while the card is up) and `commit` (runs on accept). For OpenTable the slow results-page load happens before you tilt.
- OpenTable uses a prefilled search URL and clicks the slot by its aria label. The LLM browser loop only runs if that misses.
- Lens writes go through one queue, only changed text is sent, and the loading ring never queues more than one frame.

`OPENTABLE_SUBMIT=0` (default) stops on OpenTable's "Complete your reservation" page.
