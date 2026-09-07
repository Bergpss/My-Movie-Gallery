import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyWatchPeriod, formatWatchPeriod, validateWatchPeriod } from '../watch-dates.js';
import { onRequestPost as updateMovie } from '../functions/api/update.js';
import { onRequestPost as addMovie } from '../functions/api/add.js';

test('valid periods, single dates, open periods and impossible dates', () => {
    assert.equal(validateWatchPeriod('2026-09-01', '2026-09-07'), null);
    assert.equal(validateWatchPeriod('2024-02-29', null), null);
    for (const [start, end] of [['2026-02-29', null], ['2026-09-08', '2026-09-07'], [null, '2026-09-07'], ['bad', null]]) {
        assert.ok(validateWatchPeriod(start, end));
    }
    assert.equal(formatWatchPeriod({ watchDates: ['2026-09-01'] }), '2026-09-01');
    assert.equal(formatWatchPeriod({ watchStartDate: '2026-09-01', status: 'watching' }), '2026-09-01 至今');
    assert.equal(formatWatchPeriod({ watchStartDate: '2026-09-01', watchEndDate: '2026-09-07' }), '2026-09-01 至 2026-09-07');
    assert.equal(formatWatchPeriod({ watchStartDate: '2026-09-01', watchEndDate: '2026-09-01' }), '2026-09-01');
});

test('editing replaces the primary date, preserves rewatches and clears a period', () => {
    const movie = { watchDate: '2026-09-07', watchDates: ['2026-09-07', '2025-01-01'] };
    applyWatchPeriod(movie, { watchStartDate: '2026-09-01', watchEndDate: '2026-09-07' });
    assert.deepEqual(movie.watchDates, ['2026-09-01', '2025-01-01']);
    applyWatchPeriod(movie, { watchStartDate: '2026-09-01', watchEndDate: null });
    assert.equal(formatWatchPeriod(movie), '2026-09-01');
    applyWatchPeriod(movie, { status: 'wishlist' });
    assert.equal(formatWatchPeriod(movie), '');
    assert.equal(movie.watchEndDate, undefined);
    const single = { watchDates: ['2026-09-07'] };
    applyWatchPeriod(single, { watchStartDate: null, watchEndDate: null });
    assert.equal(formatWatchPeriod(single), '');
});

test('API persists ranges, rejects invalid dates before writing and clears wishlist dates', async () => {
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
        assert.equal((await call(updateMovie, { id: 1, watchStartDate: '2026-09-01', watchEndDate: '2026-09-07' })).status, 200);
        assert.equal(formatWatchPeriod(library.watched[0]), '2026-09-01 至 2026-09-07');
        assert.equal((await call(updateMovie, { id: 1, watchStartDate: '2026-09-08', watchEndDate: '2026-09-07' })).status, 400);
        assert.equal(writes, 1);
        assert.equal((await call(updateMovie, { id: 1, status: 'wishlist' })).status, 200);
        assert.equal(formatWatchPeriod(library.wishlist[0]), '');
        assert.equal((await call(addMovie, { id: 2, title: 'Series', status: 'watching', watchStartDate: '2026-09-01', watchEndDate: null })).status, 200);
        assert.equal(formatWatchPeriod(library.watching[0]), '2026-09-01 至今');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('snapshot regeneration retains ranges for movies and web videos without remote requests', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'movie-period-'));
    const entry = { id: 1, title: 'Fixture', mediaType: 'tv', watchDates: ['2026-09-01'], watchStartDate: '2026-09-01', watchEndDate: '2026-09-07' };
    try {
        await mkdir(join(cwd, 'data'));
        await writeFile(join(cwd, 'data/library.json'), JSON.stringify({ watched: [entry, { ...entry, id: 2, mediaType: 'web-video' }] }));
        await writeFile(join(cwd, 'data/movies.json'), JSON.stringify({ items: [{ ...entry, tmdb: { title: 'Fixture' } }] }));
        execFileSync(process.execPath, [new URL('./fetch_movies.js', import.meta.url).pathname], { cwd, env: { ...process.env, TMDB_API_KEY: 'fixture-unused' } });
        const snapshot = JSON.parse(await readFile(join(cwd, 'data/movies.json'), 'utf8'));
        assert.equal(snapshot.items.length, 2);
        for (const movie of snapshot.items) assert.equal(formatWatchPeriod(movie), '2026-09-01 至 2026-09-07');
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
