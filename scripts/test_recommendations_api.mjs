import assert from 'node:assert/strict';
import test from 'node:test';

import {
    collectCandidates,
    onRequestPost,
} from '../functions/api/recommendations.js';

test('collectCandidates mixes discovery and seed sources before truncation', () => {
    const candidates = collectCandidates([
        {
            source: { type: 'discover', genreIds: [18] },
            movies: [
                { id: 1, title: 'Discover 1' },
                { id: 2, title: 'Discover 2' },
                { id: 3, title: 'Discover 3' },
            ],
        },
        {
            source: { type: 'seed', seedId: '101', seedTitle: '末路狂花' },
            movies: [
                { id: 10, title: 'Seed 1' },
                { id: 11, title: 'Seed 2' },
            ],
        },
        {
            source: { type: 'seed', seedId: '102', seedTitle: '苦月亮' },
            movies: [
                { id: 20, title: 'Seed 3' },
                { id: 21, title: 'Seed 4' },
            ],
        },
    ], new Set(), 4);

    assert.deepEqual(candidates.map(movie => movie.id), [1, 10, 20, 2]);
    assert.equal(candidates[1].recommendationContext.sources[0].seedTitle, '末路狂花');
    assert.equal(candidates[2].recommendationContext.sources[0].seedTitle, '苦月亮');
});

test('collectCandidates dedupes candidates and preserves all recommendation sources', () => {
    const candidates = collectCandidates([
        {
            source: { type: 'discover', genreIds: [18] },
            movies: [{ id: 5, title: 'Shared Candidate' }],
        },
        {
            source: { type: 'seed', seedId: '101', seedTitle: '末路狂花' },
            movies: [
                { id: 5, title: 'Shared Candidate' },
                { id: 6, title: 'Seed Candidate' },
            ],
        },
    ], new Set(), 3);

    assert.deepEqual(candidates.map(movie => movie.id), [5, 6]);
    assert.deepEqual(
        candidates[0].recommendationContext.sources.map(source => source.type),
        ['discover', 'seed'],
    );
});

test('onRequestPost returns mixed candidates and excludes existing movie IDs', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths = [];

    globalThis.fetch = async input => {
        const url = new URL(input);
        requestedPaths.push(url.pathname);

        if (url.pathname.endsWith('/genre/movie/list')) {
            return Response.json({
                genres: [
                    { id: 18, name: '剧情' },
                    { id: 35, name: '喜剧' },
                ],
            });
        }

        if (url.pathname.endsWith('/movie/101/recommendations')) {
            return Response.json({
                results: [
                    { id: 10, title: 'Seed Candidate', genre_ids: [18], vote_average: 8.2, vote_count: 900 },
                ],
            });
        }

        return Response.json({
            results: [
                { id: 1, title: 'Existing Movie', genre_ids: [18], vote_average: 9, vote_count: 2000 },
                { id: 2, title: 'Discover Candidate', genre_ids: [35], vote_average: 8, vote_count: 1200 },
            ],
        });
    };

    try {
        const request = new Request('https://example.test/api/recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profile: {
                    existingMovieIds: ['1'],
                    topGenres: [{ id: 18, name: '剧情', score: 1 }],
                    seedMovies: [{ id: '101', title: '末路狂花', score: 1 }],
                },
                limit: 10,
            }),
        });
        const response = await onRequestPost({
            request,
            env: { TMDB_API_KEY: 'test-key' },
        });
        const data = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(data.results.map(movie => movie.id), [10, 2]);
        assert.equal(
            data.results.find(movie => movie.id === 10).recommendationContext.sources[0].seedTitle,
            '末路狂花',
        );
        assert.ok(requestedPaths.some(path => path.endsWith('/discover/movie')));
        assert.ok(requestedPaths.some(path => path.endsWith('/movie/101/recommendations')));
    } finally {
        globalThis.fetch = originalFetch;
    }
});
