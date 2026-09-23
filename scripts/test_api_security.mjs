import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest, resetRateLimits } from '../functions/api/_middleware.js';
import { onRequestPost as login } from '../functions/api/auth.js';
import { onRequestPost as addMovie } from '../functions/api/add.js';

const SITE = 'https://movie.guoyibo.top';
const okHandler = async () => new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*' } });

function call(path, { origin, method = 'GET', ip = '1.1.1.1', env = {}, next = okHandler } = {}) {
    const headers = { 'CF-Connecting-IP': ip };
    if (origin) headers.Origin = origin;
    return onRequest({ request: new Request(`${SITE}${path}`, { method, headers }), env, next });
}

test('api rejects cross-site browser requests and echoes only allowed origins', async () => {
    resetRateLimits();
    assert.equal((await call('/api/search?q=a', { origin: 'https://evil.example' })).status, 403);
    const own = await call('/api/search?q=a', { origin: SITE });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('Access-Control-Allow-Origin'), SITE);
    const extra = await call('/api/search?q=a', { origin: 'https://preview.example', env: { ALLOWED_ORIGINS: 'https://preview.example' } });
    assert.equal(extra.headers.get('Access-Control-Allow-Origin'), 'https://preview.example');
    const noOrigin = await call('/api/search?q=a');
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get('Access-Control-Allow-Origin'), null, '不再对外返回 *');
});

test('preflight from the site is answered without reaching the handler', async () => {
    resetRateLimits();
    let reached = false;
    const response = await call('/api/add', { origin: SITE, method: 'OPTIONS', next: async () => { reached = true; return new Response(); } });
    assert.equal(response.status, 204);
    assert.equal(reached, false);
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('login attempts are rate limited per IP', async () => {
    resetRateLimits();
    for (let i = 0; i < 10; i++) assert.equal((await call('/api/auth', { method: 'POST', origin: SITE })).status, 200);
    const blocked = await call('/api/auth', { method: 'POST', origin: SITE });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.equal((await call('/api/auth', { method: 'POST', origin: SITE, ip: '2.2.2.2' })).status, 200, '其他 IP 不受影响');
});

test('TMDB proxy endpoints are rate limited, admin writes are not', async () => {
    resetRateLimits();
    for (let i = 0; i < 60; i++) await call('/api/search?q=a');
    assert.equal((await call('/api/search?q=a')).status, 429);
    for (let i = 0; i < 80; i++) assert.equal((await call('/api/update', { method: 'POST', origin: SITE })).status, 200);
});

const loginRequest = password => new Request(`${SITE}/api/auth`, { method: 'POST', body: JSON.stringify({ password }) });

test('login checks the password and refuses to sign tokens without JWT_SECRET', async () => {
    const env = { ADMIN_PASSWORD: 'correct horse', JWT_SECRET: 'secret' };
    assert.equal((await login({ request: loginRequest('wrong'), env })).status, 401);
    assert.equal((await login({ request: loginRequest('correct hors'), env })).status, 401);
    const ok = await login({ request: loginRequest('correct horse'), env });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).token);
    assert.equal((await login({ request: loginRequest('correct horse'), env: { ADMIN_PASSWORD: 'correct horse' } })).status, 500);
});

test('write endpoints do not accept tokens signed with the old default secret', async () => {
    const forged = await (await login({ request: loginRequest('pw'), env: { ADMIN_PASSWORD: 'pw', JWT_SECRET: 'default-secret-change-me' } })).json();
    const request = new Request(`${SITE}/api/add`, { method: 'POST', headers: { Authorization: `Bearer ${forged.token}` }, body: '{}' });
    const response = await addMovie({ request, env: {} });
    assert.equal(response.status, 500);
});
