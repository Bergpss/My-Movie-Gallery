import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { onRequestPost as deleteMovie } from '../functions/api/delete.js';
import { onRequestPost as updateMovie } from '../functions/api/update.js';
import { onRequestPost as addMovie } from '../functions/api/add.js';

test('recap films and series support add, duplicate prevention, editing, moving and deletion', async () => {
    const secret = 'test-only-secret';
    const data = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 60000 })).toString('base64url')}`;
    const token = `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
    const originalFetch = globalThis.fetch;
    let library = { watched: [{ id: 1, title: 'Test', watchDates: ['2026-09-07'] }] };
    let writes = 0;
    globalThis.fetch = async (_url, options) => {
        if (options.method === 'PUT') {
            library = JSON.parse(Buffer.from(JSON.parse(options.body).content, 'base64').toString());
            writes++;
            return Response.json({});
        }
        return Response.json({ sha: 'fixture', content: Buffer.from(JSON.stringify(library)).toString('base64') });
    };
    const call = (handler, body) => handler({
        request: new Request('https://example.test/api/update', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        env: { JWT_SECRET: secret, GITHUB_TOKEN: 'fixture', GITHUB_OWNER: 'fixture', GITHUB_REPO: 'fixture' },
    });
    try {
        for (const mediaType of ['movie', 'tv']) {
            const id = mediaType === 'movie' ? 2 : 3;
            const added = await call(addMovie, { id, title: '解说测试', mediaType, status: 'recap', watchStartDate: '2026-09-11', note: '博主解说' });
            assert.equal(added.status, 200);
            assert.match((await added.json()).message, /看过解说/);
            assert.equal(library.recap[0].status, 'recap');
            assert.equal(library.recap[0].mediaType, mediaType);
            assert.equal((await call(addMovie, { id, title: 'Duplicate', status: 'watched' })).status, 400);
            assert.equal((await call(updateMovie, { id, note: '更新笔记' })).status, 200);
            assert.equal(library.recap[0].note, '更新笔记');
            assert.equal((await call(updateMovie, { id, status: 'watched' })).status, 200);
            assert.equal(library.recap.length, 0);
            assert.equal(library.watched[0].status, 'watched');
            assert.equal((await call(updateMovie, { id, status: 'recap' })).status, 200);
            assert.equal(library.recap[0].status, 'recap');
            assert.equal((await call(deleteMovie, { id })).status, 200);
            assert.equal(library.recap.length, 0);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('snapshot regeneration retains recap films and TV series', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'movie-period-'));
    const entry = { id: 1, title: 'Fixture', mediaType: 'movie', watchDates: ['2026-09-01'], watchStartDate: '2026-09-01', watchEndDate: '2026-09-07' };
    try {
        await mkdir(join(cwd, 'data'));
        await writeFile(join(cwd, 'data/library.json'), JSON.stringify({ recap: [entry, { ...entry, id: 2, mediaType: 'tv', status: 'recap' }] }));
        await writeFile(join(cwd, 'data/movies.json'), JSON.stringify({ items: [entry, { ...entry, id: 2, mediaType: 'tv' }].map(item => ({ ...item, tmdb: { title: 'Fixture' } })) }));
        execFileSync(process.execPath, [new URL('./fetch_movies.js', import.meta.url).pathname], { cwd, env: { ...process.env, TMDB_API_KEY: 'fixture-unused' } });
        const snapshot = JSON.parse(await readFile(join(cwd, 'data/movies.json'), 'utf8'));
        assert.equal(snapshot.items.length, 2);
        for (const movie of snapshot.items) assert.equal(movie.status, 'recap');
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
