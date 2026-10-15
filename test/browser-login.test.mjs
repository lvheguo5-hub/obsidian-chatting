import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { api } from './harness.mjs';

const fetch = (url) => globalThis.fetch(url, { headers: { Connection: 'close' } });

const callback = (login, params) => {
  const auth = new URL(login.authUrl);
  const url = new URL(auth.searchParams.get('redirect_uri'));
  url.hostname = '127.0.0.1';
  url.search = new URLSearchParams({ state: auth.searchParams.get('state'), ...params });
  return url;
};

test('Browser login: rejects wrong state, exchanges one valid PKCE callback, then releases listener', async () => {
  const calls = [];
  const login = await api.startBrowserLogin(async (...args) => { calls.push(args); });
  try {
    const auth = new URL(login.authUrl);
    assert.equal(auth.origin, 'https://auth.openai.com');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal((await fetch(callback(login, { state: 'wrong', code: 'fake' }))).status, 400);
    assert.equal(calls.length, 0);
    const r = await fetch(callback(login, { code: 'fake-authorization-code' }));
    assert.equal(r.status, 200);
    assert.match(await r.text(), /ChatGPT connected/);
    await login.promise;
    assert.equal(calls.length, 1);
    const [code, verifier, redirectUri] = calls[0];
    assert.equal(code, 'fake-authorization-code');
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), auth.searchParams.get('code_challenge'));
    assert.equal(redirectUri, auth.searchParams.get('redirect_uri'));
  } finally { login.cancel(); }
});

test('Browser login: cancellation during exchange cannot commit a late result', async () => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let committed = false;
  const login = await api.startBrowserLogin(async (code, verifier, redirectUri, isCancelled) => {
    started();
    await new Promise(resolve => { release = resolve; });
    if (!isCancelled()) committed = true;
  });
  const request = fetch(callback(login, { code: 'fake' })).catch(() => {});
  await entered;
  const cancelled = assert.rejects(login.promise, /cancelled/);
  login.cancel();
  release();
  await cancelled;
  await request;
  assert.equal(committed, false);
});

test('Browser login: a busy preferred port uses the allowed fallback without stopping its owner', async () => {
  const busy = createServer((req, res) => res.end('existing app'));
  await new Promise((resolve, reject) => { busy.once('error', reject); busy.listen(1455, '127.0.0.1', resolve); });
  let login;
  try {
    login = await api.startBrowserLogin(async () => {});
    assert.equal(new URL(new URL(login.authUrl).searchParams.get('redirect_uri')).port, '1457');
    assert.equal(await (await fetch('http://127.0.0.1:1455')).text(), 'existing app');
    const denied = assert.rejects(login.promise, /declined/);
    assert.equal((await fetch(callback(login, { error: 'access_denied' }))).status, 400);
    await denied;
  } finally { login?.cancel(); busy.closeAllConnections(); await new Promise(resolve => busy.close(resolve)); }
});

test('Browser login: duplicate callbacks do not exchange the authorization code twice', async () => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const login = await api.startBrowserLogin(async () => { calls++; started(); await new Promise(resolve => { release = resolve; }); });
  try {
    const first = fetch(callback(login, { code: 'fake' }));
    await entered;
    assert.equal((await fetch(callback(login, { code: 'fake' }))).status, 409);
    release();
    await first;
    await login.promise;
    assert.equal(calls, 1);
  } finally { login.cancel(); }
});

test('Browser login: mobile never starts a Node listener', async () => {
  globalThis.__isMobile = true;
  try {
    const oauth = new api.ChatGPTOAuthService({});
    await assert.rejects(oauth.beginBrowserAuthorization(), /device-code login on mobile/);
  } finally { delete globalThis.__isMobile; }
});
