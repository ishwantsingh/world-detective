const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { analyzeBroomFrames, readBroomSteeringRequest } = require('../lib/broom-autopilot.ts');
const { broomMotion, safeBroomKeys } = require('../lib/broom-controls.ts');
const { POST } = require('../app/api/broom/steer/route.ts');
const frames = [{ timestamp: 1000, image: '/9j/AAAA' }, { timestamp: 1850, image: '/9j/AAAA' }];
const decision = { keys: ['w', 'ArrowLeft'], confidence: 0.9, target: 'ring' };
const reply = (text, finishReason = 'STOP', extraParts = []) => Response.json({ candidates: [{
  finishReason, content: { parts: [...extraParts, { text }] },
}] });
const analyze = fetcher => analyzeBroomFrames(frames, 'private-key', 'gemini-3.8-flash', new AbortController().signal, fetcher);

test('Gemini 3 receives a separate low thinking setting and sufficient answer budget', async () => {
  const result = await analyze(async (_url, options) => {
    const config = JSON.parse(options.body).generationConfig;
    assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'low' });
    assert.equal(config.maxOutputTokens, 2048);
    assert.deepEqual(config.responseSchema.properties.keys.items.enum, ['w', 's', 'a', 'd', 'Space', 'c', 'ArrowLeft', 'ArrowRight']);
    assert.equal(config.responseSchema.properties.keys.maxItems, 4);
    assert.match(JSON.parse(options.body).systemInstruction.parts[0].text, /Keep camera pitch fixed/);
    return reply(JSON.stringify(decision));
  });
  assert.deepEqual(result, decision);
});

test('the observed MAX_TOKENS partial JSON retries once without executing partial controls', async () => {
  let calls = 0;
  assert.deepEqual(await analyze(async (_url, options) => {
    const config = JSON.parse(options.body).generationConfig;
    calls += 1;
    assert.equal(config.maxOutputTokens, calls === 1 ? 2048 : 4096);
    return calls === 1 ? reply('{"keys": ["w', 'MAX_TOKENS') : reply(JSON.stringify(decision));
  }), decision);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(analyze(async () => {
    calls += 1;
    return reply(JSON.stringify(decision), 'MAX_TOKENS');
  }), error => error.status === 502 && /output limit/.test(error.message));
  assert.equal(calls, 2);
});

test('complete fenced/split JSON is parsed and thought parts are excluded', async () => {
  assert.deepEqual(await analyze(async () => reply('```json\n' + JSON.stringify(decision) + '\n```', 'STOP', [
    { thought: true, text: 'ignore this reasoning' }, { thoughtSignature: 'opaque' },
  ])), decision);
  const encoded = JSON.stringify(decision);
  assert.deepEqual(await analyze(async () => reply(encoded.slice(10), 'STOP', [{ text: encoded.slice(0, 10) }])), decision);
});

test('empty, blocked, malformed and contradictory replies fail without controls', async () => {
  for (const body of [
    null,
    { candidates: [] },
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: JSON.stringify(decision) }] } }] },
  ]) await assert.rejects(analyze(async () => Response.json(body)), error => error.status === 502);
  for (const text of ['{"keys":["w"', 'null', '[]', 'please fly ' + JSON.stringify(decision),
    JSON.stringify({ ...decision, keys: ['ArrowLeft', 'ArrowRight'] }),
    JSON.stringify({ ...decision, keys: ['w', 'w'] }),
    JSON.stringify({ ...decision, keys: ['w', 'ArrowUp'] }),
    JSON.stringify({ ...decision, keys: ['ArrowDown'] }),
    JSON.stringify({ ...decision, keys: ['Space', 'c'] }),
    JSON.stringify({ ...decision, confidence: '0.9' })]) {
    await assert.rejects(analyze(async () => reply(text)), error => error.status === 502);
  }
});

test('only confident visible targets can hold motion; arrow signs match the main controller', () => {
  assert.deepEqual(safeBroomKeys(decision), decision.keys);
  assert.deepEqual(safeBroomKeys({ ...decision, confidence: 0.54 }), []);
  assert.deepEqual(safeBroomKeys({ ...decision, target: 'none' }), []);
  assert.deepEqual(safeBroomKeys({ ...decision, keys: ['w', 's'] }), []);
  assert.deepEqual(broomMotion(safeBroomKeys(decision)), {
    longitudinal: 'forward', lateral: 'idle', pitch: 0, yaw: -0.015, vertical: 0,
  });
  assert.deepEqual(broomMotion([]), { longitudinal: 'idle', lateral: 'idle', pitch: 0, yaw: 0, vertical: 0 });
  assert.equal(broomMotion(['ArrowUp']).pitch, 0);
  assert.equal(broomMotion(['ArrowDown']).pitch, 0);
});

test('vertical camera keys are still rejected independently', async () => {
  for (const key of ['ArrowUp', 'ArrowDown']) {
    const result = { ...decision, keys: ['w', key, 'ArrowRight'] };
    await assert.rejects(analyze(async () => reply(JSON.stringify(result))), /invalid steering decision/);
    assert.deepEqual(safeBroomKeys(result), []);
  }
});

test('altitude keys translate up/down with fixed pitch and support combined steering', async () => {
  for (const [key, vertical] of [['Space', -1], ['c', 1]]) {
    const result = { ...decision, keys: ['w', 'a', key, 'ArrowRight'] };
    assert.deepEqual(await analyze(async () => reply(JSON.stringify(result))), result);
    assert.deepEqual(broomMotion(safeBroomKeys(result)), {
      longitudinal: 'forward', lateral: 'strafe_left', pitch: 0, yaw: 0.015, vertical,
    });
    assert.equal(broomMotion([key]).vertical, vertical);
  }
  assert.deepEqual(safeBroomKeys({ ...decision, keys: ['Space', 'c'] }), []);
});

test('steering route validates requests and keeps provider failures and keys private', async () => {
  const request = (body, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/broom/steer', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request({ frames }, 'https://other.example'))).status, 403);
  await assert.rejects(readBroomSteeringRequest(request({ frames: [...frames, ...frames] })), error => error.status === 400);
  await assert.rejects(readBroomSteeringRequest(request({ frames: [{ ...frames[0], image: 'A'.repeat(250001) }, frames[1]] })), error => error.status === 400);
  await assert.rejects(readBroomSteeringRequest(request({ junk: 'A'.repeat(1500001) })), error => error.status === 413);
  const gemini = process.env.GEMINI_API_KEY;
  const google = process.env.GOOGLE_API_KEY;
  const originalFetch = global.fetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    assert.equal((await POST(request({ frames }))).status, 503);
    process.env.GEMINI_API_KEY = 'private-key';
    global.fetch = async () => reply(JSON.stringify(decision));
    const response = await POST(request({ frames }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await response.json(), decision);
    global.fetch = async () => Response.json({ error: { message: 'private-key AIzaSensitive' } }, { status: 429 });
    const failure = await POST(request({ frames }));
    assert.equal(failure.status, 429);
    assert.doesNotMatch((await failure.json()).error, /private-key|AIzaSensitive/);
  } finally {
    global.fetch = originalFetch;
    if (gemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = gemini;
    if (google === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = google;
  }
});
