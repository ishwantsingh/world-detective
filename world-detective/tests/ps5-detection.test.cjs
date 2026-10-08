const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Load the same TypeScript used by the app, without adding a test runtime dependency.
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { applyObservation, emptyPickupState } = require('../lib/ps5-detection.ts');
const { analyzePs5Frames, readDetectionRequest } = require('../lib/ps5-gemini.ts');
const { POST } = require('../app/api/ps5/detect/route.ts');
const { analyzeBroomFrames, readBroomSteeringRequest } = require('../lib/broom-autopilot.ts');
const frames = (...timestamps) => timestamps.map(timestamp => ({ timestamp, image: '/9j/AAAA' }));
const observation = (phase, crossingAt = null, confidence = 0.95) => ({ phase, crossingAt, confidence });
const request = (body, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/ps5/detect', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const mockGemini = result => async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
const analyze = (result, window = frames(1000, 2000), last = -1) => analyzePs5Frames(
  window, last, 'test-key', 'gemini-2.5-flash', new AbortController().signal, mockGemini(result),
);

test('confirmed walk-over counts once despite repeated overlapping windows', () => {
  let state = applyObservation(emptyPickupState(), observation('crossed', 2000), frames(1000, 2000));
  assert.equal(state.count, 1);
  state = applyObservation(state, observation('crossed', 2000), frames(1000, 2000, 3000));
  state = applyObservation(state, observation('crossed', 3000), frames(2000, 3000, 4000));
  assert.equal(state.count, 1);
});

test('seeing a console, uncertainty, and low-confidence crossings do not count', () => {
  for (const result of [observation('approaching'), observation('uncertain'), observation('clear'), observation('crossed', 2000, 0.84)]) {
    assert.equal(applyObservation(emptyPickupState(), result, frames(1000, 2000)).count, 0);
  }
});

test('clear path rearms and a second crossing increments exactly one', () => {
  let state = applyObservation(emptyPickupState(), observation('crossed', 2000), frames(1000, 2000));
  state = applyObservation(state, observation('clear'), frames(2000, 3000));
  assert.equal(state.armed, false);
  state = applyObservation(state, observation('clear'), frames(3000, 4000));
  assert.equal(state.armed, true);
  state = applyObservation(state, observation('crossed', 5000), frames(4000, 5000));
  assert.equal(state.count, 2);
});

test('new approach rearms; stale analyses and unknown crossing timestamps are ignored', () => {
  let state = applyObservation(emptyPickupState(), observation('crossed', 2000), frames(1000, 2000));
  state = applyObservation(state, observation('approaching'), frames(3000, 4000));
  assert.equal(state.armed, true);
  assert.equal(applyObservation(state, observation('crossed', 2000), frames(1000, 2000)), state);
  assert.equal(applyObservation(state, observation('crossed', 4500), frames(4000, 5000)).count, 1);
  assert.deepEqual(emptyPickupState().count, 0);
});

test('accepts bounded chronological JPEG snapshots', async () => {
  const body = { frames: frames(1000, 2000), lastCrossingAt: -1 };
  assert.deepEqual(await readDetectionRequest(request(body)), body);
});

test('rejects malformed, unordered, oversized and unsupported frame payloads', async () => {
  const invalid = [
    { frames: frames(1000), lastCrossingAt: -1 },
    { frames: frames(2000, 1000), lastCrossingAt: -1 },
    { frames: frames(1000, 1000), lastCrossingAt: -1 },
    { frames: frames(1, 2, 3, 4, 5, 6), lastCrossingAt: -1 },
    { frames: [{ timestamp: 1, image: 'data:image/png;base64,abcd' }, ...frames(2)], lastCrossingAt: -1 },
    { frames: [{ timestamp: 1, image: '/9j/' + 'A'.repeat(250_001) }, ...frames(2)], lastCrossingAt: -1 },
    { frames: frames(1, 2), lastCrossingAt: 'none' },
  ];
  for (const body of invalid) await assert.rejects(readDetectionRequest(request(body)), error => error.status === 400);
  await assert.rejects(readDetectionRequest(request({ text: 'A'.repeat(1_500_001) })), error => error.status === 413);
  await assert.rejects(readDetectionRequest(new Request('http://localhost', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  })), error => error.status === 400);
});

test('Gemini receives ordered images, deduplication context and a server-only key', async () => {
  await analyzePs5Frames(frames(1000, 2000), 500, 'private-key', 'gemini-2.5-flash', new AbortController().signal, async (url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'private-key');
    assert.equal(url.includes('private-key'), false);
    const payload = JSON.parse(options.body);
    assert.match(payload.systemInstruction.parts[0].text, /500/);
    assert.match(payload.systemInstruction.parts[0].text, /physically flies THROUGH/);
    assert.match(payload.systemInstruction.parts[0].text, /Sparks or disappearance alone are insufficient/);
    assert.equal(payload.contents[0].parts.length, 4);
    assert.match(payload.contents[0].parts[0].text, /1000/);
    assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
    assert.equal(payload.generationConfig.responseMimeType, 'application/json');
    return mockGemini(observation('clear'))();
  });
});

test('validates Gemini confidence, phase and exact uncounted timestamps', async () => {
  assert.deepEqual(await analyze(observation('crossed', 2000)), observation('crossed', 2000));
  for (const result of [observation('crossed', 1500), observation('crossed', null), observation('clear', 2000), observation('crossed', 2000, 2), observation('fake')]) {
    await assert.rejects(analyze(result), error => error.status === 502);
  }
  await assert.rejects(analyze(observation('crossed', 2000), frames(1000, 2000), 2000), error => error.status === 502);
});

test('rate limits, blocked output and invalid API responses do not become pickups', async () => {
  for (const [fetcher, expected] of [
    [async () => new Response('', { status: 429 }), 429],
    [async () => new Response('', { status: 403 }), 502],
    [async () => Response.json({ candidates: [] }), 502],
    [async () => Response.json({ candidates: [{ content: { parts: [{ text: 'invalid' }] } }] }), 502],
  ]) {
    await assert.rejects(analyzePs5Frames(frames(1000, 2000), -1, 'test', 'gemini-2.5-flash', new AbortController().signal, fetcher), error => error.status === expected);
  }
});

test('provider errors explain retired models and redact credentials', async () => {
  await assert.rejects(analyzePs5Frames(frames(1000, 2000), -1, 'private-test-key', 'retired-model', new AbortController().signal,
    async () => Response.json({ error: { message: 'Model is no longer available. Credential private-test-key AIzaSensitiveValue' } }, { status: 404 })),
    error => error.status === 502 && error.message.includes('no longer available') &&
      !error.message.includes('private-test-key') && !error.message.includes('AIzaSensitiveValue'));
});

test('route blocks cross-origin requests and reports missing configuration without exposing keys', async () => {
  const body = { frames: frames(1000, 2000), lastCrossingAt: -1 };
  assert.equal((await POST(request(body, 'https://other.example'))).status, 403);
  const gemini = process.env.GEMINI_API_KEY;
  const google = process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const response = await POST(request(body));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match((await response.json()).error, /GEMINI_API_KEY/);
    const normalized = new Request('http://localhost:3000/api/ps5/detect', {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal((await POST(normalized)).status, 503);
  } finally {
    if (gemini !== undefined) process.env.GEMINI_API_KEY = gemini;
    if (google !== undefined) process.env.GOOGLE_API_KEY = google;
  }
});

test('broom autopilot accepts bounded chronological frames and rejects conflicting keys', async () => {
  const body = { frames: frames(1000, 2000) };
  assert.deepEqual(await readBroomSteeringRequest(request(body)), body.frames);
  await assert.rejects(readBroomSteeringRequest(request({ frames: frames(1000) })), error => error.status === 400);
  await assert.rejects(readBroomSteeringRequest(request({ frames: frames(2000, 1000) })), error => error.status === 400);
  const steer = result => analyzeBroomFrames(frames(1000, 2000), 'private-key', 'gemini-2.5-flash', new AbortController().signal, mockGemini(result));
  assert.deepEqual(await steer({ keys: ['w', 'ArrowLeft'], confidence: 0.9, target: 'ring' }), {
    keys: ['w', 'ArrowLeft'], confidence: 0.9, target: 'ring',
  });
  for (const result of [
    { keys: ['w', 's'], confidence: 0.9, target: 'ring' },
    { keys: ['x'], confidence: 0.9, target: 'ring' },
    { keys: ['w'], confidence: 2, target: 'ring' },
    { keys: [], confidence: 0.9, target: 'made-up' },
  ]) await assert.rejects(steer(result), error => error.status === 502);
});

test('broom autopilot gives Gemini ordered frames and ring-specific controls', async () => {
  await analyzeBroomFrames(frames(1000, 2000), 'private-key', 'gemini-2.5-flash', new AbortController().signal, async (url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'private-key');
    assert.equal(url.includes('private-key'), false);
    const payload = JSON.parse(options.body);
    assert.match(payload.systemInstruction.parts[0].text, /golden ring/);
    assert.match(payload.systemInstruction.parts[0].text, /ArrowLeft/);
    assert.equal(payload.contents[0].parts.length, 4);
    assert.deepEqual(payload.generationConfig.responseSchema.properties.keys.items.enum, ['w', 's', 'a', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    return mockGemini({ keys: ['w'], confidence: 0.9, target: 'ring' })();
  });
});
