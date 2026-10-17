# Handoff

Someone across the table asks you for something ("can you book us a table for two at 7?"). A one-line card appears on your Even Realities G2 lens. Tilt your head right to accept or left to skip. An agent on your laptop does it in an already-open, logged-in browser, and the lens shows `✓ Held House Of Meatballs 7:00 PM · 2`. You never speak to the glasses.

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
- `bridge/src/skills/` `opentable.ts` (deterministic recipe with an LLM loop fallback), `slides.ts` (Apps Script edits with a browser fallback), `web.ts` (generic loop).
- `slides/Code.gs` Apps Script web app bound to the demo deck.
- `shared/protocol.ts` messages between lens, dashboard and bridge.

## Run

1. Start Chrome with a persistent profile and log into OpenTable and Google:
   `google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.handoff-chrome`
   Leave an OpenTable tab and the demo deck open.
2. Bridge: `cd bridge && cp .env.example .env` (fill in keys), `npm install`, `npm start`.
3. Lens app: `cd g2app && npm install && npm run dev`, then `npm run qr` and scan it in the Even Realities app.
4. Open `http://localhost:8787` on the laptop for the transcript, live timer and timing table. Typing a request there runs the same path as speech.

`npm run bench -- "book us a table for two tomorrow at 7, Italian"` in `bridge/` times the whole path without glasses.

## Controls

- Tilt right and hold (~14°, 0.2 s): accept. Tilt left: skip. The card text slides with your head, then leaves as a drop.
- Ring or temple tap: accept. Double tap: skip.
- The phone page shows raw IMU values. Pick the lateral axis and flip direction there once per headset.

## Speed choices

- Detection runs on Deepgram interim results with `endpointing=200`, so the card can appear before the speaker finishes.
- One Deepgram socket and one CDP connection stay open all session.
- Each skill splits into `prepare` (safe, runs while the card is up) and `commit` (runs on accept). For OpenTable the slow results-page load happens before you tilt.
- OpenTable uses a prefilled search URL and clicks the slot by its aria label. The LLM browser loop only runs if that misses.
- Slides edits go through Apps Script, not the Slides UI. The deck outline is cached and the edit is planned while the card is up.
- Lens writes go through one queue, only changed text is sent, and the loading ring never queues more than one frame.

`OPENTABLE_SUBMIT=0` (default) stops on OpenTable's "Complete your reservation" page.
