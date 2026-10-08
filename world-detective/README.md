# LingBot World 2

A Next.js + TypeScript frontend for **Wizard: Ring Flying Trial**, powered by the LingBot World 2 real-time world model. Start the trial, then fly through the generated rings with WASD and manual arrow or mouse controls, or enable Gemini autopilot for automatic movement and left/right turns.

Everything runs through the strongly-typed
[`@reactor-models/lingbot-world-2`](https://www.npmjs.com/package/@reactor-models/lingbot-world-2)
package, which wraps the base
[`@reactor-team/js-sdk`](https://www.npmjs.com/package/@reactor-team/js-sdk)
with typed commands, message hooks, and the `main_video` track view.

```
┌──────────────────────┬─────────────────────────────────────┐
│  Status  ▸ ready     │                                     │
│                      │                                     │
│  Quick Start         │                                     │
│  ┌────────────┬───┐  │        live video output            │
│  │ Ring Trial │ ✎ │  │    (LingbotWorld2MainVideoView)     │
│  └────────────┴───┘  │                                     │
│                      ├─────────────────────────────────────┤
│                      │   Gemini trial autopilot            │
│                      │   WASD  ◯ joystick  ←↑↓→  ◉ mouse   │
│  Custom scene        │   jump / crouch / orbit switches    │
└──────────────────────┴─────────────────────────────────────┘
```

## Quick start

> **Start a standalone project:** `npx create-reactor-app my-app --model=lingbot-world-2` scaffolds this example into a fresh app — no clone needed. The steps below are for running it in-place from a monorepo checkout.

You'll need a Reactor API key — grab one at [reactor.inc/account/api-keys](https://www.reactor.inc/account/api-keys). It starts with `rk_`.

```bash
cp .env.example .env.local
# add your key: REACTOR_API_KEY=rk_...

pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), click **Connect**, then click **Wizard: Ring Flying Trial** under Quick Start. It uploads the scene's starting image, sends its composed prompt, and starts generating; from there the controls are live.

The API key never reaches the browser: the server route [`app/api/reactor/token/route.ts`](app/api/reactor/token/route.ts) exchanges it for a short-lived JWT scoped to `reactor/lingbot-world-2` sessions (via `authorization_details` — the token can only create sessions for that model and act on the sessions it created), and the SDK re-fetches it (via the browser's HTTP cache) on every API call through the `getJwt` resolver.

## What you can do with it

- **Quick Start.** Wizard: Ring Flying Trial is the only built-in case. One click uploads its image, sends the prompt, and starts.
- **Wizard: Ring Flying Trial.** Uses the supplied rocky-valley reference image. Steer the broom with WASD and left/right turns through successive rings. Gemini can climb and descend to align with openings; manual jump/crouch stays disabled for the trial. Ring passage is described to the world model, without a separate scoring system.
- **Drive the world.** WASD (or the joystick) moves via `set_move_longitudinal` / `set_move_lateral`; arrows and click-to-engage mouse-look rotate via per-latent `set_camera_pose` deltas; Q/E roll; O toggles orbit (circle a point ahead instead of turning in place).
- **Trigger world events.** Scenes with events bind detail clauses to hold-keys 1–9 — hold to weave the event into the prompt, release to revert.
- **Jump and crouch** with selectable modes, from a simple prompt swap up to hand-editable per-step motion arcs (charge levels, dip patterns). The motion system is documented in [`skill/SKILL.md`](skill/SKILL.md).
- **Edit prompts live.** Click ✎ on any example to open the layered scene editor (base / camera / movement / events / vertical) — editing the running scene re-sends the prompt on the fly, and edits persist in `localStorage` until you press ↺. The **Show prompt** inspector (under Advanced) shows exactly what composed prompt the model is seeing and why.
- **Bring your own scene.** The Custom scene card takes your image plus a from-scratch layered prompt.
- **Backend knobs** (under Advanced): seed, rotation speed, DiT attention window, and KV-cache reset mode.
- **Snap a clip.** A "Capture" panel sits at the bottom of the sidebar. Click once and the SDK grabs the last 10 seconds of the live stream, opens a preview modal, and offers an MP4 download — no recording stack to wire up, no extra services.

## How the prompt is built

The model only ever sees a single prose string (`set_prompt`), but the app authors it in layers (`lib/lingbot-world-prompts.ts`):

- **base** — world identity: subject, environment, style
- **camera / movement** — each with `static` and `dynamic` variants, selected by whether you're currently moving
- **events** — hold-key detail clauses that stack while held
- **vertical** — the jump / crouch / stand sentence while those controls are engaged

`composePrompt()` flattens the active selection to prose and the controller re-sends it whenever the input state changes — so the text always matches the motion. The inspector panel visualizes this composition live.

## Configuration

### PS5 pickup counter

Set `GEMINI_API_KEY` in `.env` or `.env.local` (a server-only key from [Google AI Studio](https://aistudio.google.com/apikey)), then restart the app. `GOOGLE_API_KEY` is also accepted. `GEMINI_MODEL` optionally overrides `gemini-3.8-flash`. If Google rejects a request, the counter displays its error detail; retired model overrides must be updated to an available model.

Custom scenes show a PS5 counter in the top-left corner. While generation is running and the tab is visible, it captures one JPEG snapshot per second at up to 640 pixels wide. The server sends a rolling sequence of 2–5 frames to Gemini to distinguish walking over a console from seeing it, passing beside it, turning away, or the console vanishing. Frames go to Google for inference; the app does not persist them. Each confirmed crossing increments the count by one. Confidence filtering, timestamp checks and rearming prevent repeated awards from overlapping windows. Resetting, changing scenes or disconnecting clears the count; pausing preserves it and stops sampling.

In a custom broom scene, Gemini looks for the rider flying through a floating console's position. Blue sparks alone do not award a pickup; the image sequence must show the approach and crossing.

Only one inference request runs at a time. Slow inference keeps the latest five snapshots rather than building an unbounded queue. Failed requests back off; a missing key appears directly in the counter with a Retry button. This is visual inference, not a game collision engine: ambiguous crossings, very close successive consoles, or crossings missed between snapshots may not count. Count updates follow Gemini's response latency. Run `pnpm test` for request validation, Gemini response handling and pickup deduplication tests.

### Gemini broom autopilot

Start **Wizard: Ring Flying Trial**, then select **Start Autopilot** in the controls rail. The game fills the available desktop viewport; **Hide controls** expands it further without stopping generation or autopilot, and **Show controls** restores the rail. On small screens, controls stack below the video. Autopilot is available only for this scene and targets its weathered tan hoops with red banners. The browser samples two or three consecutive live frames (at most 640 pixels wide) and sends them to the server-side Gemini integration. Validated `WASD` and arrow-key intents enter the main controller: movement updates the live scene prompt and the displayed controls, and arrows use its single camera-pose sender on each generated chunk. Sampling continues during inference; only one request runs at a time, with no queue. Low-confidence or missing targets hold position. Errors, a hidden tab, frozen video, stale decisions, pausing, changing scenes, resetting, disconnecting, or stopping autopilot release movement. Starting a new run requires enabling autopilot again. Frames are not persisted.

Gemini uses `WASD` for movement, `Space` to ascend, `c` to descend, and `ArrowLeft` / `ArrowRight` for gentle turns (0.015 radians per latent). Altitude inputs translate the rider and trailing camera without tilting it. `ArrowUp` / `ArrowDown` remain excluded and rejected; pitch and roll stay zero. Altitude holds until released, with no jump arc or automatic return. The scene's climb/descend prompts are used when available, with concise fallback prompts otherwise. The SDK has no fixed movement-speed setting; generated speed and ring placement remain model-guided. Your scene JSON and saved edits are preserved.

Gemini 3 uses low reasoning effort with a 2,048-token response budget. The budget includes reasoning, so the former 512-token limit could truncate the JSON decision. If Gemini reports `MAX_TOKENS`, the server retries once with 4,096 tokens; incomplete or blocked replies never execute controls. Gemini 2.5 Flash overrides disable reasoning instead. Provider failures appear in the panel; use **Retry Autopilot** after fixing missing configuration.

Autopilot is intentionally opt-in and uses the `GEMINI_API_KEY` already required by the pickup counter. Because the generated world is probabilistic and Gemini sees compressed snapshots rather than game geometry, it is a visual controller, not a deterministic collision solver. Manual movement is superseded while it is enabled; turn it off to take over instantly.

| Env var                       | Required | What it does                                                                    |
| ----------------------------- | -------- | ------------------------------------------------------------------------------- |
| `REACTOR_API_KEY`             | yes      | Server-side key exchanged for session JWTs by `app/api/reactor/token/route.ts`. |
| `NEXT_PUBLIC_REACTOR_API_URL` | no       | Reactor API base URL. Defaults to `https://api.reactor.inc`.                    |

If `REACTOR_API_KEY` is missing, the app renders a friendly setup landing instead of erroring — see [`app/SetupRequired.tsx`](app/SetupRequired.tsx).

## Code tour

The interesting bits, in roughly the order you'd read them:

| File                                                                                                             | What's in it                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`app/page.tsx`](app/page.tsx)                                                                                   | Server Component gate: renders the app when `REACTOR_API_KEY` is set, the setup landing when it isn't.                                                                                                   |
| [`app/LingbotWorld2App.tsx`](app/LingbotWorld2App.tsx)                                                           | Client tree: the `getJwt` resolver, `<LingbotWorld2Provider>`, connection status bar, page layout.                                                                                                       |
| [`app/api/reactor/token/route.ts`](app/api/reactor/token/route.ts)                                               | Cacheable GET route that exchanges `REACTOR_API_KEY` for a short-lived, session-scoped JWT (pinned to the model via `authorization_details`).                                                            |
| [`components/lingbot-world-2/LingbotWorldController.tsx`](components/lingbot-world-2/LingbotWorldController.tsx) | The heart of the app: message handling, WASD/look/jump/crouch input → typed SDK commands, prompt recomposition, the sidebar and control surfaces.                                                        |
| [`lib/lingbot-world-prompts.ts`](lib/lingbot-world-prompts.ts)                                                   | The layered `StructuredScene` model and the pure `composePrompt()`.                                                                                                                                      |
| [`lib/lingbot-cases-examples.ts`](lib/lingbot-cases-examples.ts) + [`lib/lingbot-cases/`](lib/lingbot-cases)     | The example scenes, one JSON per scene.                                                                                                                                                                  |
| [`components/lingbot-world-2/LayeredSceneEditor.tsx`](components/lingbot-world-2/LayeredSceneEditor.tsx)         | The full-screen layered prompt editor behind every ✎ button.                                                                                                                                             |
| [`components/lingbot-world-2/LivePromptInspector.tsx`](components/lingbot-world-2/LivePromptInspector.tsx)       | Read-only live view of the composed prompt with per-layer breakdown.                                                                                                                                     |
| [`components/lingbot-world-2/prompt-segments.ts`](components/lingbot-world-2/prompt-segments.ts)                 | Segment-level composition mirror that powers the inspector and editor preview.                                                                                                                           |
| [`components/SnapClip.tsx`](components/SnapClip.tsx)                                                             | Model-agnostic. Captures the last N seconds of the live stream via the SDK's `requestClip(...)` and opens a preview modal with `<ClipPlayer>` + `<ClipDownloadButton>`. Drop-in for any Reactor example. |
| [`skill/SKILL.md`](skill/SKILL.md)                                                                               | The extension guide, including the motion-system deep dive: the `camera_pose` contract, per-step arcs, symmetry, trigger semantics.                                                                      |

## Going further

[`skill/SKILL.md`](skill/SKILL.md) is the deep dive for extending this app — the SDK's connection / events / messages model, the camera-pose channel rules, the layered prompt system and its override store, auth, and clip capture. Read it before adding controls or scenes.

Deferred features you could add next: a gamepad binding, free-text mid-stream prompt entry, multi-clip capture galleries, scheduled world events.

## Learn more

- [Reactor Docs](https://docs.reactor.inc/overview)
- [`skill/SKILL.md`](skill/SKILL.md) — how input becomes motion, and every extension pattern, in depth

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · [`@reactor-models/lingbot-world-2`](https://www.npmjs.com/package/@reactor-models/lingbot-world-2) · [`@reactor-team/js-sdk`](https://www.npmjs.com/package/@reactor-team/js-sdk) (recording primitives) · [`hls.js`](https://www.npmjs.com/package/hls.js) (clip preview) · [`@reactor-team/ui`](https://www.npmjs.com/package/@reactor-team/ui) (design tokens)
