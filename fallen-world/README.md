# Fallen World

A standalone copy of the LingBot World 2 starter with **Fall Guys PS5 Course**, **Football Solo Drill**, and **Mortal Kombat Ice vs Fire**. The original app remains in `../world-detective`.

The platformer scene is stored in [`lib/lingbot-cases/fallguys-ps5.json`](lib/lingbot-cases/fallguys-ps5.json), with its supplied reference image in [`public/lingbot-cases/fallguys_ps5.jpg`](public/lingbot-cases/fallguys_ps5.jpg). The football scene is [`lib/lingbot-cases/football-solo-drill.json`](lib/lingbot-cases/football-solo-drill.json), with its supplied image in [`public/lingbot-cases/football-solo-drill.png`](public/lingbot-cases/football-solo-drill.png). The three original starter scenes and images are excluded from this app.

The fighting scene is [`lib/lingbot-cases/mortal-kombat-ice-fire.json`](lib/lingbot-cases/mortal-kombat-ice-fire.json), with the supplied JPEG reference in [`public/lingbot-cases/mortal-kombat-ice-fire.jpg`](public/lingbot-cases/mortal-kombat-ice-fire.jpg).

## Run

```bash
cd fallen-world
pnpm install
pnpm dev
```

Local environment configuration is copied from the original project and remains ignored by Git. For a fresh checkout, copy `.env.example` to `.env.local` and set `REACTOR_API_KEY` to your Reactor API key. `NEXT_PUBLIC_REACTOR_API_URL` is optional; it defaults to `https://api.reactor.inc`.

Open the URL printed by the development server (normally http://localhost:3000), click **Connect**, then select a scene in Quick Start. This uploads the starting image, sends the composed scene prompt, and starts streaming video.

The walking revision uses preset IDs `case_fallguys_ps5_walk_v2` and `case_football_solo_drill_walk_v2`. Refresh the page and select the scene again to start from the rewritten prompts and reference image. Old browser-saved edits remain stored under the previous IDs and do not override these revised presets.

Both walking scenes use Noir-style fixed rear framing and describe short grounded walking steps, upright posture, loose arms, and slowly passing ground detail. Their base descriptions frame quiet exploration or training. Fall Guys pickup leaves the walking pace unchanged; key 5 selects a separate dash gait. Dive, wave, stumble, shooting, and dribbling also select their own movement descriptions so the active action replaces conflicting default posture instructions. The JSON expresses the intended gait; local tests check the composed prompts, while visual walking behavior must be checked in a fresh model generation.

## Controls

For **Mortal Kombat Ice vs Fire**, hold **1** for the left blue ice fighter's ice ball toward the right red fire fighter; hold **2** for the right fighter's small fireball toward the left fighter. Both fighters' head, gaze, chest, shoulders, hips, knees, and feet must face directly toward each other before, during, and after attacks. The fixed camera shows opposing side profiles and remains perpendicular to the line joining them. Each projectile follows a straight horizontal path into the opponent's chest. Only the selected attacker animates; the target stays planted in an unchanged guard throughout wind-up and flight, with only a passive impact shudder after contact. The target never dodges, blocks, turns, advances, or counterattacks. Separate `left_ice` and `right_fire` base and movement layers make the attacks exclusive: if both keys are held, the most recently pressed attack wins; releasing it reactivates the remaining held key. Release both to return to guard. The revised preset ID `case_mortal_kombat_ice_fire_facing_v2` bypasses old saved scene edits without deleting them; refresh and select the case again to use it.

Each attack requests a reduction of about one tenth of the target's current health-bar fill only after visible contact. The attacker's health bar stays unchanged and reduced health persists between actions. Health, facing, hits, and animation are instructions for generated video, not enforced game physics or a numeric health system; local tests verify the prompts, not rendered behavior. For this case, use the prompt-only jump/crouch modes and leave mouse-look and orbit off to preserve the fixed arena framing.

For **Football Solo Drill**, hold **1** to shoot toward the goal and **2** to dribble. Normal movement walks with the ball at a relaxed pace. Dribble selects close-control alternating touches while walking, or side-to-side touches in place when stationary. Shooting selects a separate movement description so the prompt does not simultaneously insist that the ball stays at the player's feet. All actions use the inherited hold/release prompt controls; the HUD remains part of generated video. Use one number-key action at a time for consistent choreography; multiple held actions still stack, and the most recently held action selects the movement layer.

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

The five number-key actions add their description to the live prompt while held and remove it on release. Multiple held actions stack. The PS5 collection, HUD counter, hazards, dash, and timer are instructions for the generated video; this app does not track score, collisions, elapsed race time, or completion. The collection prompt asks the visible counter to increase by one, showing 1 on the first pickup.

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

Tests verify all three scene registrations and images, action order, hold/release prompt behavior, football shooting and dribbling, fighting projectile directions and target health bars, moving versus idle framing, and jump/slide/stand prompts. A live generation session requires a Reactor key and is separate from these local checks.

They also check grounded walking language, separation of the dash gait, validity of action-layer references, and agreement between the model prompt and the live inspector.

Next.js 15 · React 19 · TypeScript · Tailwind v4 · `@reactor-models/lingbot-world-2`.
