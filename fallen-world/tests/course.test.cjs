const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

// Load actual TypeScript scene modules with the app's @/ alias without
// adding another runtime or generating test build files in the source tree.
const root = path.resolve(__dirname, "..");
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
  const module = { exports: {} };
  modules.set(file, module);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  vm.runInThisContext(`(function(require, module, exports) {${outputText}\n})`, {
    filename: file,
  })((specifier) => {
    let target = specifier.startsWith("@/")
      ? path.join(root, specifier.slice(2))
      : path.resolve(path.dirname(file), specifier);
    if (!path.extname(target)) target += ".ts";
    return load(target);
  }, module, module.exports);
  return module.exports;
}

const { EXAMPLES, STRUCTURED_EXAMPLES, composePrompt } = load(
  path.join(root, "lib/lingbot-world-prompts.ts"),
);
const course = STRUCTURED_EXAMPLES.case_fallguys_ps5_walk_v2;
const football = STRUCTURED_EXAMPLES.case_football_solo_drill_walk_v2;
const fighting = STRUCTURED_EXAMPLES.case_mortal_kombat_ice_fire_facing_v2;
const { resolveSelection, composePromptSegments } = load(
  path.join(root, "components/lingbot-world-2/prompt-segments.ts"),
);

test("all three scenes are registered with their reference images", () => {
  assert.deepEqual(EXAMPLES.map((example) => example.id), [
    "case_fallguys_ps5_walk_v2", "case_football_solo_drill_walk_v2",
    "case_mortal_kombat_ice_fire_facing_v2",
  ]);
  assert.equal(course.id, "case_fallguys_ps5_walk_v2");
  assert.equal(STRUCTURED_EXAMPLES[course.id], course);
  assert.equal(course.image.src, "/lingbot-cases/fallguys_ps5.jpg");
  assert.deepEqual(fs.readdirSync(path.join(root, "lib/lingbot-cases")), [
    "fallguys-ps5.json",
    "football-solo-drill.json",
    "mortal-kombat-ice-fire.json",
  ]);
  assert.deepEqual(fs.readdirSync(path.join(root, "public/lingbot-cases")), [
    "fallguys_ps5.jpg",
    "football-solo-drill.png",
    "mortal-kombat-ice-fire.jpg",
  ]);
  const image = fs.readFileSync(path.join(root, "public", course.image.src));
  assert.equal(image.subarray(0, 3).toString("hex"), "ffd8ff");
  const footballImage = fs.readFileSync(path.join(root, "public", football.image.src));
  assert.equal(footballImage.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const fightingImage = fs.readFileSync(path.join(root, "public", fighting.image.src));
  assert.equal(fightingImage.subarray(0, 3).toString("hex"), "ffd8ff");
});

test("football has exactly Shoot and Dribble, with relaxed default movement", () => {
  const { scene } = football;
  assert.deepEqual(scene.events.map((event) => event.name), ["Shoot", "Dribble"]);
  const walking = composePrompt(scene, true, []);
  assert.ok(walking.includes("steady, leisurely walking pace"));
  assert.ok(walking.includes("keeping it close to his feet"));
  assert.ok(walking.includes(scene.camera.default.dynamic));
  assert.ok(!walking.includes(scene.events[0].detail));
});

test("football shoot releases ball possession and dribble follows movement input", () => {
  const { scene } = football;
  for (const moving of [false, true]) {
    const variant = moving ? "dynamic" : "static";
    const shot = composePrompt(scene, moving, [0]);
    assert.ok(shot.includes(scene.events[0].detail));
    assert.ok(shot.includes(scene.movement.shoot[variant]));
    assert.ok(!shot.includes(scene.movement.default[variant]));
    const dribble = composePrompt(scene, moving, [1]);
    assert.ok(dribble.includes(scene.movement.dribble[variant]));
    assert.ok(!dribble.includes(scene.movement.default[variant]));
    assert.ok(dribble.includes(scene.events[1].detail[variant]));
    assert.ok(!dribble.includes(scene.events[0].detail));
    const released = composePrompt(scene, moving, []);
    assert.ok(!released.includes(scene.events[0].detail));
    assert.ok(!released.includes(scene.events[1].detail[variant]));
    assert.ok(released.includes(scene.movement.default[variant]));
  }
});

test("keys 1–5 append the correct action and release restores the scene", () => {
  const { scene } = course;
  assert.deepEqual(scene.events.map((event) => event.name), [
    "Collect PS5", "Belly Dive", "Celebratory Wave", "Stumble Recovery", "Speed Dash",
  ]);
  const idle = composePrompt(scene, false, []);
  scene.events.forEach((event, slot) => {
    const held = composePrompt(scene, false, [slot]);
    assert.ok(held.endsWith(event.detail));
    scene.events.forEach((other, otherSlot) => {
      if (otherSlot !== slot) assert.ok(!held.includes(other.detail));
    });
    assert.equal(composePrompt(scene, false, []), idle);
  });
  const stacked = composePrompt(scene, false, [0, 4]);
  assert.ok(stacked.includes(scene.events[0].detail));
  assert.ok(stacked.includes(scene.events[4].detail));
  const released = composePrompt(scene, false, [4]);
  assert.ok(!released.includes(scene.events[0].detail));
  assert.ok(released.includes(scene.events[4].detail));
});

test("movement and vertical controls use this course's prompts", () => {
  const { scene } = course;
  for (const moving of [false, true]) {
    const variant = moving ? "dynamic" : "static";
    for (const field of ["jumpPrompt", "crouchPrompt", "standPrompt"]) {
      const prompt = composePrompt(scene, moving, [1], scene[field]);
      assert.ok(prompt.includes(scene.camera.default[variant]));
      assert.ok(prompt.includes(scene.movement.dive[variant]));
      assert.ok(prompt.endsWith(scene[field]));
    }
  }
});

test("default prompts describe grounded walking with a fixed rear camera", () => {
  for (const { scene } of [course, football]) {
    const moving = composePrompt(scene, true, []);
    assert.ok(moving.includes("steady, leisurely walking pace"));
    assert.ok(moving.includes("one foot supporting"));
    assert.ok(moving.includes("torso stays upright"));
    assert.ok(moving.includes("fixed position relative"));
    assert.ok(!/\b(run|running|sprint|sprinting|dash|chase)\b/i.test(moving));
    const idle = composePrompt(scene, false, []);
    assert.ok(idle.includes("stands still"));
    assert.ok(!idle.includes(scene.movement.default.dynamic));
  }
});

test("fighting attacks target the opponent's health only after contact", () => {
  const { scene } = fighting;
  assert.deepEqual(scene.events.map((event) => event.name), [
    "Left Ice Ball", "Right Small Fireball",
  ]);
  const [ice, fire] = scene.events;
  assert.ok(ice.detail.includes("from LEFT to RIGHT"));
  assert.ok(ice.detail.includes("TOP-RIGHT SCORPION health bar loses"));
  assert.ok(ice.detail.includes("TOP-LEFT SUB-ZERO health bar remains unchanged"));
  assert.ok(fire.detail.includes("from RIGHT to LEFT"));
  assert.ok(fire.detail.includes("roughly fist-sized"));
  assert.ok(fire.detail.includes("TOP-LEFT SUB-ZERO health bar loses"));
  assert.ok(fire.detail.includes("TOP-RIGHT SCORPION health bar remains unchanged"));
  for (const moving of [false, true]) {
    const variant = moving ? "dynamic" : "static";
    for (const [slot, event] of scene.events.entries()) {
      const attack = composePrompt(scene, moving, [slot]);
      assert.ok(attack.includes("Only AFTER this visible hit"));
      assert.ok(attack.includes(event.detail));
      assert.ok(!attack.includes(scene.events[1 - slot].detail));
      assert.ok(attack.includes(scene.movement[event.movementVersion][variant]));
      assert.ok(!attack.includes(scene.movement.default[variant]));
    }
    const released = composePrompt(scene, moving, []);
    assert.ok(!released.includes(ice.detail));
    assert.ok(!released.includes(fire.detail));
    assert.ok(released.includes("retain the latest visible health levels"));
    assert.ok(released.includes(scene.camera.default[variant]));
    assert.ok(released.includes(scene.movement.default[variant]));
  }
});

test("fighting orientation stays locked and only the selected attacker animates", () => {
  const { scene } = fighting;
  for (const moving of [false, true]) {
    const variant = moving ? "dynamic" : "static";
    for (const held of [[], [0], [1]]) {
      const prompt = composePrompt(scene, moving, held);
      assert.ok(prompt.includes("head, gaze, chest, shoulders, hips, knees, and toes"));
      assert.ok(prompt.includes("at ALL TIMES"));
      assert.ok(prompt.includes("opposing side profiles"));
      assert.ok(prompt.includes("camera remains perpendicular"));
    }
    const ice = composePrompt(scene, moving, [0]);
    assert.ok(ice.includes("Only the LEFT blue ice fighter animates"));
    assert.ok(ice.includes("RIGHT red fire fighter remains motionless"));
    assert.ok(ice.includes("directly hits the RIGHT fighter's chest"));
    assert.ok(!ice.includes(scene.movement.right_fire[variant]));
    const fire = composePrompt(scene, moving, [1]);
    assert.ok(fire.includes("Only the RIGHT red fire fighter animates"));
    assert.ok(fire.includes("LEFT blue ice fighter remains motionless"));
    assert.ok(fire.includes("directly hits the LEFT fighter's chest"));
    assert.ok(!fire.includes(scene.movement.left_ice[variant]));
  }
});

test("overlapping fighting keys keep one attacker, switching back on release", () => {
  const { scene } = fighting;
  for (const moving of [false, true]) {
    for (const held of [[0, 1], [1, 0]]) {
      const latest = held[1];
      const prompt = composePrompt(scene, moving, held);
      assert.equal(prompt, composePrompt(scene, moving, [latest]));
      assert.ok(!prompt.includes(scene.events[held[0]].detail));
    }
    // Hold 1, press 2, then release 2: the remaining ice key becomes active.
    assert.equal(resolveSelection(scene, moving, [0]).activeMovement, "left_ice");
    assert.equal(resolveSelection(scene, moving, []).activeMovement, "default");
  }
});

test("only the dash action selects fast movement; release restores walking", () => {
  const { scene } = course;
  for (let slot = 0; slot < 4; slot++) {
    const prompt = composePrompt(scene, true, [slot]);
    assert.ok(!prompt.includes(scene.movement.dash.dynamic));
    assert.ok(!/\b(run|running|sprint|sprinting|dash)\b/i.test(prompt));
  }
  const dash = composePrompt(scene, true, [4]);
  assert.ok(dash.includes(scene.movement.dash.dynamic));
  assert.ok(!dash.includes(scene.movement.default.dynamic));
  const released = composePrompt(scene, true, []);
  assert.ok(released.includes(scene.movement.default.dynamic));
  assert.ok(!released.includes(scene.movement.dash.dynamic));
});

test("action layers exist and the inspector matches every composed event prompt", () => {
  for (const { scene } of EXAMPLES) {
    for (const event of scene.events) {
      for (const layer of ["base", "camera", "movement"]) {
        const version = event[`${layer}Version`] ?? "default";
        assert.ok(Object.hasOwn(scene[layer], version), `${event.name}: ${layer}.${version}`);
      }
    }
    const allSlots = scene.events.map((_, slot) => slot);
    const selections = [[], ...allSlots.map((slot) => [slot]), allSlots, [...allSlots].reverse()];
    for (const moving of [false, true]) {
      for (const held of selections) {
        const selection = resolveSelection(scene, moving, held);
        const displayed = composePromptSegments(selection, moving)
          .map((segment) => segment.text).join(" ");
        assert.equal(displayed, composePrompt(scene, moving, held));
      }
    }
  }
});
