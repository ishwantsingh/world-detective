// The app's built-in Wizard: Ring Flying Trial case.
//
// The scene DATA lives one-file-per-example under ./lingbot-cases/<slug>.json
// (slug = the example's kebab-cased name) — this module is just the loader /
// manifest: it imports each JSON and exports the ordered list the rest of the
// app consumes (LINGBOT_CASES_EXAMPLE_LIST). To edit a scene, edit its JSON; to
// add one, drop a new <slug>.json into ./lingbot-cases/ and add it below.
//
// Each JSON conforms to StructuredExample (see lingbot-world-prompts.ts) and is
// authored in layered-composition form: base.default = POV/motion-agnostic
// world identity (subject + environment + style); camera.default.{static,
// dynamic} = framing selected by WASD state (static orbits look-input around
// the centred subject, dynamic is rear-view tracking); movement.default.
// {static,dynamic} = idle vs. forward motion; each non-jump action slot
// (keys 1..9) is one append-mode event clause. composePrompt() concatenates
// the active selection at runtime. Source images live at
// public/lingbot-cases/ at each example's image.src path.

import type { StructuredExample } from "@/lib/lingbot-world-prompts";

import wizardRingFlyingTrial from "./lingbot-cases/wizard-ring-flying-trial.json";

// The display order of the example chips. Add new examples here.
export const LINGBOT_CASES_EXAMPLE_LIST: StructuredExample[] = [
  wizardRingFlyingTrial,
] as StructuredExample[];
