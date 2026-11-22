import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./ai-chat.js', import.meta.url), 'utf8');

function harness({ fetchImpl, env = { OPENAI_API_KEY: 'test-secret' } = {} } = {}) {
  const code = source.replace('export default async function handler', 'async function handler') + '\n;globalThis.__handler = handler;';
  const context = {
    Buffer,
    process: { env },
    AbortController,
    setTimeout,
    clearTimeout,
    console: { error() {} },
    fetch: fetchImpl
  };
  vm.runInNewContext(code, context);
  const result = () => ({ statusCode: 0, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; }
  });
  return { handler: context.__handler, result };
}

const validBody = { messages: [{ role: 'user', content: 'ما أفضل سماعة للألعاب؟' }] };
const jsonHeaders = { 'content-type': 'application/json' };
const openAiOk = () => ({ ok: true, json: async () => ({ output_text: 'إجابة تجريبية' }) });

test('guest request remains supported and calls OpenAI', async () => {
  const calls = [];
  const { handler, result } = harness({ fetchImpl: async (url, options) => { calls.push({ url, options }); return openAiOk(); } });
  const res = result();
  await handler({ method: 'POST', headers: jsonHeaders, body: validBody }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'إجابة تجريبية');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
});

test('valid Supabase bearer token is verified before OpenAI is called', async () => {
  const calls = [];
  const { handler, result } = harness({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'verified-user' }) };
    return openAiOk();
  } });
  const res = result();
  await handler({ method: 'POST', headers: { ...jsonHeaders, authorization: 'Bearer good-jwt' }, body: validBody }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/auth\/v1\/user$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer good-jwt');
  assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
});

test('invalid token is rejected and OpenAI is not called', async () => {
  let openAiCalled = false;
  const { handler, result } = harness({ fetchImpl: async url => url.endsWith('/auth/v1/user') ? { ok: false } : (openAiCalled = true, openAiOk()) });
  const res = result();
  await handler({ method: 'POST', headers: { ...jsonHeaders, authorization: 'Bearer bad-jwt' }, body: validBody }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(openAiCalled, false);
});

test('bad method and content type are rejected', async () => {
  const { handler, result } = harness({ fetchImpl: async () => openAiOk() });
  const methodRes = result();
  await handler({ method: 'GET', headers: jsonHeaders }, methodRes);
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.headers.Allow, 'POST');
  const typeRes = result();
  await handler({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }, typeRes);
  assert.equal(typeRes.statusCode, 415);
});

test('malformed JSON, invalid messages and excessive message count are rejected', async () => {
  const { handler, result } = harness({ fetchImpl: async () => openAiOk() });
  for (const body of ['{', { messages: [{ role: 'system', content: 'no' }] }, { messages: Array.from({ length: 11 }, () => ({ role: 'user', content: 'x' })) }]) {
    const res = result();
    await handler({ method: 'POST', headers: jsonHeaders, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('declared and actual oversize bodies are rejected', async () => {
  const { handler, result } = harness({ fetchImpl: async () => openAiOk() });
  const declared = result();
  await handler({ method: 'POST', headers: { ...jsonHeaders, 'content-length': String(70 * 1024) }, body: validBody }, declared);
  assert.equal(declared.statusCode, 413);
  const actual = result();
  await handler({ method: 'POST', headers: jsonHeaders, body: { messages: [{ role: 'user', content: 'x'.repeat(70 * 1024) }] } }, actual);
  assert.equal(actual.statusCode, 413);
});

test('OpenAI timeout returns a generic error without leaking internal details', async () => {
  const { handler, result } = harness({ fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { const error = new Error('secret timeout internals'); error.name = 'AbortError'; reject(error); });
  }) });
  const res = result();
  await handler({ method: 'POST', headers: jsonHeaders, body: validBody }, res);
  assert.equal(res.statusCode, 504);
  assert.doesNotMatch(JSON.stringify(res.body), /secret timeout internals|test-secret/);
});
