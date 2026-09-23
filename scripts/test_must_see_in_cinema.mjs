import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { onRequestPost as login } from '../functions/api/auth.js';
import { onRequestPost as addMovie } from '../functions/api/add.js';
import { onRequestPost as updateMovie } from '../functions/api/update.js';

const env = { ADMIN_PASSWORD: 'pw', JWT_SECRET: 'secret', GITHUB_TOKEN: 't', GITHUB_OWNER: 'o', GITHUB_REPO: 'r' };
const encode = value => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
const decode = value => JSON.parse(decodeURIComponent(escape(atob(value))));

// 用内存里的 library.json 代替 GitHub Contents API，返回最后一次写入的内容
async function withFakeGitHub(library, run) {
    const original = globalThis.fetch;
    let written = null;
    globalThis.fetch = async (url, options = {}) => {
        if (options.method === 'PUT') {
            written = decode(JSON.parse(options.body).content);
            return new Response('{}');
        }
        return new Response(JSON.stringify({ content: encode(library), sha: 'abc' }));
    };
    try {
        const response = await run();
        assert.equal(response.status, 200, await response.clone().text());
        return written;
    } finally {
        globalThis.fetch = original;
    }
}

async function authed(body) {
    const { token } = await (await login({ request: new Request('https://x/api/auth', { method: 'POST', body: JSON.stringify({ password: 'pw' }) }), env })).json();
    return new Request('https://x/api', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

test('adding a wishlist film keeps the must-see-in-cinema flag', async () => {
    const saved = await withFakeGitHub({ watched: [], wishlist: [] }, async () =>
        addMovie({ request: await authed({ id: 1, title: '生化危机', status: 'wishlist', mustSeeInCinema: true }), env }));
    assert.equal(saved.wishlist[0].mustSeeInCinema, true);
});

test('the flag is only stored on wishlist films', async () => {
    const saved = await withFakeGitHub({ watched: [], wishlist: [] }, async () =>
        addMovie({ request: await authed({ id: 2, title: 'A', status: 'watched', mustSeeInCinema: true }), env }));
    assert.equal(saved.watched[0].mustSeeInCinema, undefined);
});

test('editing can turn the flag on and off, and watching the film clears it', async () => {
    const library = { watched: [], watching: [], wishlist: [{ id: 3, title: 'B', status: 'wishlist' }] };
    let saved = await withFakeGitHub(library, async () =>
        updateMovie({ request: await authed({ id: 3, status: 'wishlist', mustSeeInCinema: true }), env }));
    assert.equal(saved.wishlist[0].mustSeeInCinema, true);

    saved = await withFakeGitHub(saved, async () =>
        updateMovie({ request: await authed({ id: 3, status: 'wishlist', mustSeeInCinema: false }), env }));
    assert.equal(saved.wishlist[0].mustSeeInCinema, undefined);

    library.wishlist[0].mustSeeInCinema = true;
    saved = await withFakeGitHub(library, async () =>
        updateMovie({ request: await authed({ id: 3, status: 'watched', watchDate: '2026-09-23', inCinema: true }), env }));
    assert.equal(saved.watched[0].mustSeeInCinema, undefined);
    assert.equal(saved.watched[0].inCinema, true);
});

test('fetch_movies copies the flag and the wishlist reason into movies.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'movies-'));
    await mkdir(join(dir, 'data'));
    const tmdb = { title: 'B', poster_path: '/b.jpg' };
    await writeFile(join(dir, 'data/library.json'), JSON.stringify({
        wishlist: [
            { id: 3, title: 'B', status: 'wishlist', mustSeeInCinema: true, wishlistReason: '大银幕才过瘾' },
            { id: 4, title: 'C', status: 'wishlist' },
        ],
    }));
    await writeFile(join(dir, 'data/movies.json'), JSON.stringify({ items: [{ id: 3, mediaType: 'movie', tmdb }, { id: 4, mediaType: 'movie', tmdb }] }));
    await promisify(execFile)('node', [new URL('./fetch_movies.js', import.meta.url).pathname], { cwd: dir, env: { ...process.env, TMDB_API_KEY: 'unused' } });
    const { items } = JSON.parse(await readFile(join(dir, 'data/movies.json'), 'utf8'));
    const [b, c] = [3, 4].map(id => items.find(item => item.id === id));
    assert.equal(b.mustSeeInCinema, true);
    assert.equal(b.wishlistReason, '大银幕才过瘾');
    assert.equal('mustSeeInCinema' in c, false, '没勾选的片不写这个字段');
    assert.equal('wishlistReason' in c, false);
});
