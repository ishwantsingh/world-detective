const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');

// Execute the actual hooks/components with a deterministic clock and SDK.
// No GPU session, React test dependency, or Google request is needed.
function harness(componentPath, props, fetcher, savedScene) {
  const root = path.resolve(__dirname, '..');
  let index = 0, dirty = true, tree, listener, now = 0;
  const slots = [], effects = [], timers = new Map(), events = new Map(), calls = [];
  const video = { readyState: 2, videoWidth: 1280, videoHeight: 720, currentTime: 0, paused: false, ended: false };
  const sdk = { status: 'ready', sessionId: 'test-session', sendCommand() {},
    uploadFile: async () => ({}), setImage: async () => ({ width: 1280, height: 720 }),
    start: async () => undefined, reset: async () => ({ type: 'generation_reset' }),
  };
  for (const name of ['setPrompt', 'setCameraPose', 'setMoveLongitudinal', 'setMoveLateral', 'setSeed',
    'setRotationSpeedDeg', 'setAttnWindow', 'setKvCacheReset', 'setLookHorizontal', 'setLookVertical']) {
    sdk[name] = async payload => { calls.push({ name, payload: JSON.parse(JSON.stringify(payload)) }); return {}; };
  }
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const position = index++;
      if (!slots[position]) slots[position] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[position];
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(initial) { const position = index++; return slots[position] ??= { current: initial }; },
    useEffect(callback, deps) {
      const position = index++, slot = slots[position];
      if (!slot || !depsEqual(slot.deps, deps)) {
        effects.push(() => {
          slot?.cleanup?.();
          slots[position] = { deps, cleanup: callback() };
        });
      }
    },
    useMemo(callback, deps) {
      const position = index++, slot = slots[position];
      if (!slot || !depsEqual(slot.deps, deps)) slots[position] = { deps, value: callback() };
      return slots[position].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
  };
  const addEventListener = (name, callback) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback);
  };
  const removeEventListener = (name, callback) => events.get(name)?.delete(callback);
  const document = { hidden: false, pointerLockElement: null, activeElement: null,
    addEventListener, removeEventListener, exitPointerLock() {},
    createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/AAAA' }),
  };
  const context = { console, AbortSignal, AbortController, Response, Request, Buffer, process: { env: {} },
    HTMLElement: class HTMLElement {}, document,
    performance: { now: () => now }, Date: class extends Date { static now() { return now; } },
    fetch: fetcher ?? (async () => ({ ok: true, blob: async () => ({ type: 'image/png' }) })),
    File: class File {}, URL,
    localStorage: { getItem: key => key === 'lingbot-world-2:overrides:v1' && savedScene
      ? JSON.stringify({ wizard_ring_flying_trial: savedScene }) : null, setItem() {}, removeItem() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener, removeEventListener,
      setInterval: callback => { const id = timers.size + 1; timers.set(id, callback); return id; },
      clearInterval: id => timers.delete(id), confirm: () => true,
    },
  };
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const nativeRequire = createRequire(filename);
    const requireMock = name => {
      if (name === 'react') return hooks;
      if (name === '@reactor-models/lingbot-world-2') return {
        useLingbotWorld2: () => sdk, useLingbotWorld2Message: callback => { listener = callback; },
        LingbotWorld2MainVideoView: function Video() {},
      };
      if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
      if (name === '@/components/lingbot-world-2/LingbotWorldController') return {
        LingbotWorldController: () => ({ sidebar: 'setup', controls: 'movement', activeExampleId: 'wizard_ring_flying_trial',
          generationEpoch: 1, isRunning: true, setBroomControl() {} }),
      };
      if (name.startsWith('@/components/')) return new Proxy({}, { get: () => function Component() {} });
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        if (target.endsWith('.json')) return nativeRequire(target);
        if (fs.existsSync(target + '.ts')) return load(target + '.ts');
      }
      return nativeRequire(name);
    };
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(output, { ...context, module, exports: module.exports, require: requireMock }, { filename });
    return module.exports;
  }
  const component = Object.values(load(path.join(root, componentPath)))[0];
  function render() {
    let limit = 20;
    while (dirty) {
      assert.ok(limit-- > 0, 'hooks settled');
      dirty = false; index = 0; tree = component(props);
      for (const effect of effects.splice(0)) effect();
    }
    return tree;
  }
  function find(predicate, value = tree) {
    if (!value) return undefined;
    if (Array.isArray(value)) return value.map(child => find(predicate, child)).find(Boolean);
    if (typeof value !== 'object') return undefined;
    return predicate(value) ? value : find(predicate, value.props?.children ?? null);
  }
  render();
  return { calls, sdk, video, document, props, render, find,
    update(next) { Object.assign(props, next); dirty = true; render(); },
    message(message) { listener?.(message); render(); },
    async tick() { now += 850; video.currentTime += 0.85; for (const callback of [...timers.values()]) callback(); await new Promise(resolve => setImmediate(resolve)); render(); },
    event(name) { for (const callback of events.get(name) ?? []) callback(); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('autopilot only enables for Ring Flying Trial, samples during inference, and rejects late scene replies', async () => {
  const controls = [], requests = [];
  let resolve;
  const h = harness('components/BroomTrialAutopilot.tsx', {
    videoContainer: { current: null }, activeExampleId: '__custom__',
    running: true, generationEpoch: 1, onControl: keys => controls.push(keys && [...keys]),
  }, async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise(done => { resolve = done; });
  });
  h.props.videoContainer.current = { querySelector: () => h.video };
  const toggle = () => h.find(element => element.props?.role === 'switch');
  assert.equal(toggle().props.disabled, true);
  h.update({ activeExampleId: 'wizard_ring_flying_trial' });
  assert.equal(toggle().props.disabled, false);
  toggle().props.onClick(); h.render();
  assert.deepEqual(controls.at(-1), []);
  await h.tick(); await h.tick(); await h.tick();
  assert.equal(requests.length, 1); // no concurrent inference
  h.update({ activeExampleId: '__custom__' });
  assert.equal(controls.at(-1), null);
  resolve(Response.json({ keys: ['w'], confidence: 0.9, target: 'ring' }));
  await new Promise(done => setImmediate(done)); h.render();
  assert.equal(controls.at(-1), null); // old request never moves the new scene
  h.unmount();
});

test('hiding the tab or pausing releases held controls and stopping remains available', async () => {
  const controls = [];
  const h = harness('components/BroomTrialAutopilot.tsx', {
    videoContainer: { current: null }, activeExampleId: 'wizard_ring_flying_trial',
    running: true, generationEpoch: 1, onControl: keys => controls.push(keys && [...keys]),
  }, async () => Response.json({ keys: ['w', 'ArrowRight'], confidence: 0.9, target: 'ring' }));
  h.props.videoContainer.current = { querySelector: () => h.video };
  h.find(element => element.props?.role === 'switch').props.onClick(); h.render();
  await h.tick(); await h.tick();
  assert.deepEqual(controls.at(-1), ['w', 'ArrowRight']);
  h.document.hidden = true; h.event('visibilitychange');
  assert.deepEqual(controls.at(-1), []);
  h.update({ running: false });
  assert.equal(controls.at(-1), null);
  assert.equal(h.find(element => element.props?.role === 'switch').props['aria-checked'], false);
  h.unmount();
});

test('video stalls expire held motion and inference uses the latest sampled window', async () => {
  const controls = [], requests = [];
  let resolve;
  const h = harness('components/BroomTrialAutopilot.tsx', {
    videoContainer: { current: null }, activeExampleId: 'wizard_ring_flying_trial',
    running: true, generationEpoch: 1, onControl: keys => controls.push(keys && [...keys]),
  }, async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise(done => { resolve = done; });
  });
  h.props.videoContainer.current = { querySelector: () => h.video };
  h.find(element => element.props?.role === 'switch').props.onClick(); h.render();
  await h.tick(); await h.tick(); await h.tick();
  resolve(Response.json({ keys: ['w'], confidence: 0.9, target: 'ring' }));
  await new Promise(done => setImmediate(done)); h.render();
  assert.deepEqual(controls.at(-1), ['w']);
  await h.tick();
  assert.deepEqual(requests[1].frames.map(frame => frame.timestamp), [1700, 2550, 3400]);
  h.video.paused = true;
  await h.tick(); await h.tick(); await h.tick();
  assert.deepEqual(controls.at(-1), []);
  resolve(Response.json({ keys: ['w'], confidence: 0.9, target: 'ring' }));
  await new Promise(done => setImmediate(done)); h.render();
  assert.deepEqual(controls.at(-1), []);
  h.unmount();
});

test('main controller keeps prompt, WASD and one camera-pose sender coherent', async () => {
  const h = harness('components/lingbot-world-2/LingbotWorldController.tsx', {});
  let view = h.render();
  const example = h.find(element => element.type === 'button' &&
    element.props.title === 'Apply this example (loads image and starts generation)' &&
    JSON.stringify(element.props.children).includes('Wizard: Ring Flying Trial'), view.sidebar);
  assert.ok(example);
  await example.props.onClick(); h.render();
  h.message({ type: 'generation_started', chunk_num: 100 });
  view = h.render(); h.calls.length = 0;
  view.setBroomControl(['w', 'ArrowLeft']); h.render();
  assert.equal(h.calls.find(call => call.name === 'setMoveLongitudinal').payload.move_longitudinal, 'forward');
  assert.match(h.calls.find(call => call.name === 'setPrompt').payload.prompt, /rear tracking view/);
  h.calls.length = 0;
  h.message({ type: 'chunk_complete', chunk_index: 1 });
  const poses = h.calls.filter(call => call.name === 'setCameraPose');
  assert.equal(poses.length, 1);
  assert.deepEqual(poses[0].payload.camera_pose, [0, -0.015, 0, 0, 0, 0, 0, -0.015, 0, 0, 0, 0, 0, -0.015, 0, 0, 0, 0]);
  const manualStrafe = h.find(element => element.props?.label === 'A', h.render().controls);
  h.calls.length = 0;
  manualStrafe.props.onPress(); h.render();
  assert.equal(h.calls.filter(call => call.name === 'setMoveLateral').length, 0);
  h.calls.length = 0;
  h.render().setBroomControl(null); h.render();
  assert.equal(h.calls.find(call => call.name === 'setMoveLongitudinal').payload.move_longitudinal, 'idle');
  assert.match(h.calls.find(call => call.name === 'setPrompt').payload.prompt, /hovers steadily/);
  assert.deepEqual(h.calls.filter(call => call.name === 'setCameraPose').at(-1).payload.camera_pose, []);
  h.render().setBroomControl(['w', 'ArrowRight']); h.render();
  h.calls.length = 0;
  h.message({ type: 'generation_paused' });
  assert.equal(h.render().isRunning, false);
  assert.equal(h.calls.find(call => call.name === 'setMoveLongitudinal').payload.move_longitudinal, 'idle');
  h.message({ type: 'generation_reset' });
  assert.equal(h.render().activeExampleId, null);
  h.unmount();
});

test('autopilot altitude is sustained translation with fixed pitch; manual jump stays disabled', async () => {
  const h = harness('components/lingbot-world-2/LingbotWorldController.tsx', {});
  const example = h.find(element => element.type === 'button' &&
    element.props.title === 'Apply this example (loads image and starts generation)', h.render().sidebar);
  await example.props.onClick(); h.render();
  h.message({ type: 'generation_started', chunk_num: 100 });
  for (const label of ['⤒ Space', '⤓ C']) {
    const button = h.find(element => element.props?.label === label, h.render().controls);
    assert.equal(button.props.disabled, true);
    h.calls.length = 0;
    button.props.onDown(); h.render();
    assert.equal(h.calls.length, 0, 'altitude handler ignores input even if called directly');
  }
  const { scene } = require('../lib/lingbot-cases/wizard-ring-flying-trial.json');
  for (const [keys, ty, yaw, prompt, label] of [
    [['Space'], -1, 0, scene.jumpPrompt, '⤒ Space'],
    [['c'], 1, 0, scene.crouchPrompt, '⤓ C'],
    [['w', 'a', 'Space', 'ArrowLeft'], -1, -0.015, scene.jumpPrompt, '⤒ Space'],
    [['w', 'd', 'c', 'ArrowRight'], 1, 0.015, scene.crouchPrompt, '⤓ C'],
  ]) {
    h.render().setBroomControl(null); h.render();
    h.calls.length = 0;
    h.render().setBroomControl(keys); h.render();
    const composed = h.calls.find(call => call.name === 'setPrompt').payload.prompt;
    assert.ok(composed.includes(scene.camera.default.dynamic), 'altitude-only flight uses the moving camera prompt');
    assert.ok(composed.includes(prompt), 'scene altitude prompt matches the command');
    assert.equal(h.find(element => element.props?.label === label, h.render().controls).props.lit, true);
    const expected = Array.from({ length: 3 }, () => [0, yaw, 0, 0, ty, 0]).flat();
    assert.deepEqual(h.calls.filter(call => call.name === 'setCameraPose').at(-1).payload.camera_pose, expected);
    h.calls.length = 0;
    h.message({ type: 'chunk_complete', chunk_index: 1 });
    assert.equal(h.calls.filter(call => call.name === 'setCameraPose').length, 1);
    assert.deepEqual(h.calls.find(call => call.name === 'setCameraPose').payload.camera_pose, expected);
  }
  h.calls.length = 0;
  h.render().setBroomControl([]); h.render();
  assert.deepEqual(h.calls.filter(call => call.name === 'setCameraPose').at(-1).payload.camera_pose, []);
  assert.match(h.calls.find(call => call.name === 'setPrompt').payload.prompt, /holds position without movement input/);
  h.render().setBroomControl(['Space']); h.render();
  h.calls.length = 0;
  h.message({ type: 'generation_paused' });
  assert.equal(h.render().isRunning, false);
  assert.deepEqual(h.calls.filter(call => call.name === 'setCameraPose').at(-1).payload.camera_pose, []);
  h.unmount();
});

test('autopilot altitude has fallback prompts for saved scenes without vertical text', async () => {
  const scene = structuredClone(require('../lib/lingbot-cases/wizard-ring-flying-trial.json').scene);
  delete scene.jumpPrompt;
  scene.crouchPrompt = '   ';
  const h = harness('components/lingbot-world-2/LingbotWorldController.tsx', {}, undefined, scene);
  const example = h.find(element => element.type === 'button' &&
    element.props.title === 'Apply this example (loads image and starts generation)', h.render().sidebar);
  await example.props.onClick(); h.render();
  h.message({ type: 'generation_started', chunk_num: 100 });
  for (const [key, text] of [['Space', 'climbs smoothly'], ['c', 'descends smoothly']]) {
    h.calls.length = 0;
    h.render().setBroomControl([key]); h.render();
    const prompt = h.calls.find(call => call.name === 'setPrompt').payload.prompt;
    assert.ok(prompt.includes(text));
    assert.ok(prompt.includes('fixed pitch'));
  }
  h.unmount();
});

test('game viewport expands without unmounting controls or interrupting autopilot', () => {
  const h = harness('app/LingbotWorld2App.tsx', {});
  const rail = () => h.find(element => element.type === 'aside');
  const toggle = () => h.find(element => element.props?.['aria-controls'] === 'game-controls');
  const autopilot = () => h.find(element => element.props?.onControl && element.props?.videoContainer);
  const video = () => h.find(element => element.props?.videoObjectFit === 'contain');
  const videoRef = autopilot().props.videoContainer;
  assert.equal(toggle().props['aria-expanded'], true);
  assert.match(rail().props.className, /lg:overflow-y-auto/);
  assert.match(h.find(element => element.props?.ref === videoRef).props.className, /lg:flex-1/);
  assert.doesNotMatch(h.render().props.className, /max-w-/);
  for (const expanded of [false, true]) {
    toggle().props.onClick(); h.render();
    assert.equal(toggle().props['aria-expanded'], expanded);
    assert.equal(rail().props.className.startsWith('hidden'), !expanded);
    assert.equal(autopilot().props.videoContainer, videoRef);
    assert.equal(autopilot().props.running, true);
    assert.ok(video(), 'video remains mounted');
  }
  h.unmount();
});
