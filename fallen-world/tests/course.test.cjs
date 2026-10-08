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
const course = EXAMPLES[0];

test("only the supplied course is registered and its JPEG is present", () => {
  assert.equal(EXAMPLES.length, 1);
  assert.equal(course.id, "case_fallguys_ps5");
  assert.equal(STRUCTURED_EXAMPLES[course.id], course);
  assert.equal(course.image.src, "/lingbot-cases/fallguys_ps5.jpg");
  assert.deepEqual(fs.readdirSync(path.join(root, "lib/lingbot-cases")), [
    "fallguys-ps5.json",
  ]);
  assert.deepEqual(fs.readdirSync(path.join(root, "public/lingbot-cases")), [
    "fallguys_ps5.jpg",
  ]);
  const image = fs.readFileSync(path.join(root, "public", course.image.src));
  assert.equal(image.subarray(0, 3).toString("hex"), "ffd8ff");
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
      assert.ok(prompt.includes(scene.movement.default[variant]));
      assert.ok(prompt.endsWith(scene[field]));
    }
  }
});
