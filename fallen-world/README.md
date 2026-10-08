# Fallen World

A standalone copy of the LingBot World 2 starter with **Fall Guys PS5 Course** and **Football Solo Drill**. The original app remains in `../world-detective`.

The platformer scene is stored in [`lib/lingbot-cases/fallguys-ps5.json`](lib/lingbot-cases/fallguys-ps5.json), with its supplied reference image in [`public/lingbot-cases/fallguys_ps5.jpg`](public/lingbot-cases/fallguys_ps5.jpg). The football scene is [`lib/lingbot-cases/football-solo-drill.json`](lib/lingbot-cases/football-solo-drill.json), with its supplied image in [`public/lingbot-cases/football-solo-drill.png`](public/lingbot-cases/football-solo-drill.png). The three original starter scenes and images are excluded from this app.

## Run

```bash
cd fallen-world
pnpm install
pnpm dev
```

Local environment configuration is copied from the original project and remains ignored by Git. For a fresh checkout, copy `.env.example` to `.env.local` and set `REACTOR_API_KEY` to your Reactor API key. `NEXT_PUBLIC_REACTOR_API_URL` is optional; it defaults to `https://api.reactor.inc`.

Open the URL printed by the development server (normally http://localhost:3000), click **Connect**, then select either scene in Quick Start. This uploads the starting image, sends the composed scene prompt, and starts streaming video.

## Controls

For **Football Solo Drill**, hold **1** to shoot toward the goal and **2** to dribble. Normal movement walks with the ball at a relaxed pace. Dribble adds close-control alternating touches while walking, or side-to-side touches in place when stationary. Shooting selects a separate movement description so the prompt does not simultaneously insist that the ball stays at the player's feet. All actions use the inherited hold/release prompt controls; the HUD remains part of generated video.

For **Fall Guys PS5 Course**:

| Key | Action |
| --- | --- |
| WASD | Move |
| Arrow keys / mouse-look | Look around |
| Hold 1 | Collect PS5 |
| Hold 2 | Belly Dive |
| Hold 3 | Celebratory Wave |
| Hold 4 | Stumble Recovery |
| Hold 5 | Speed Dash |
| Space / J | Jump |
| C | Belly slide; release to stand |
| Q / E | Camera roll |
| O | Toggle orbit |

The five number-key actions add their description to the live prompt while held and remove it on release. Multiple held actions stack. The PS5 collection, HUD counter, hazards, dash, and timer are instructions for the generated video; this app does not track score, collisions, elapsed race time, or completion. The supplied collection description asks for a 0-to-1 counter change, rather than an accumulating counter.

The inherited controller retains joystick movement, selectable jump/crouch modes, live scene editing, the prompt inspector, generation settings, and capture of the last 10 seconds as an MP4. Scene edits persist in the browser and can be reset with the scene card's reset button.

## Extend

- [`lib/lingbot-cases-examples.ts`](lib/lingbot-cases-examples.ts) registers the course. New scenes need a JSON file, an image, and a registry entry.
- [`lib/lingbot-world-prompts.ts`](lib/lingbot-world-prompts.ts) composes base, camera, movement, held actions, and vertical prompts.
- [`components/lingbot-world-2/LingbotWorldController.tsx`](components/lingbot-world-2/LingbotWorldController.tsx) owns input and model commands.
- [`app/api/reactor/token/route.ts`](app/api/reactor/token/route.ts) keeps the API key on the server and mints scoped session tokens. The client memoizes the token until near expiry.
- [`skill/SKILL.md`](skill/SKILL.md) documents the inherited controller and extension patterns.

## Verify

```bash
pnpm test
pnpm build
```

Tests verify both scene registrations and images, action order, hold/release prompt behavior, football shooting and dribbling, moving versus idle framing, and jump/slide/stand prompts. A live generation session requires a Reactor key and is separate from these local checks.

Next.js 15 · React 19 · TypeScript · Tailwind v4 · `@reactor-models/lingbot-world-2`.
