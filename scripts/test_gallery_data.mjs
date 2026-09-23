import assert from 'node:assert/strict';
import test from 'node:test';
import { getGalleryPage, normalizeMovie, PLACEHOLDER, selectMovies } from '../gallery-data.js';

test('gallery preserves status aliases and keeps recap separate from watched', () => {
    const statuses = ['WATCHED', 'ongoing', 'in-progress', 'planned', 'recap', 'dropped', 'legacy'];
    const movies = statuses.map((status, id) => normalizeMovie({ id, status }));
    assert.deepEqual(movies.map(movie => movie.category), ['watched', 'watching', 'watching', 'wishlist', 'recap', 'dropped', 'watched']);
    assert.deepEqual(selectMovies(movies).map(movie => movie.id), [0, 6]);
    assert.deepEqual(selectMovies(movies, { status: 'recap' }).map(movie => movie.id), [4]);
});

test('gallery sorts by the latest valid viewing or rewatch date', () => {
    const movies = [
        { id: 1, title: 'First', watchDates: ['2026-01-01', '2026-09-12'], watchStartDate: '2026-01-01', watchEndDate: '2026-01-03' },
        { id: 2, title: 'Second', watchDate: '2026-09-11' },
        { id: 3, title: 'Third', watchDates: ['2026-02-30', '2026-13-01', 'invalid'] },
    ].map(normalizeMovie);
    assert.equal(movies[0].watchSortDate, '2026-09-12');
    assert.equal(movies[2].watchSortDate, '');
    assert.deepEqual(selectMovies(movies).map(movie => movie.id), [1, 2, 3]);
});

test('personal ratings remain distinct from TMDB and zero is a real rating', () => {
    const movies = [
        { id: 1, rating: null, tmdb: { vote_average: 9.8 } },
        { id: 2, rating: 0, tmdb: { vote_average: 8 } },
        { id: 3, rating: 8 },
    ].map(normalizeMovie);
    assert.equal(movies[0].personalRating, null);
    assert.equal(movies[0].tmdbRating, 9.8);
    assert.equal(movies[1].personalRating, 0);
    assert.deepEqual(selectMovies(movies, { sort: 'rating' }).map(movie => movie.id), [3, 2, 1]);
    for (const rating of [Infinity, NaN, -1, 11, '8']) {
        assert.equal(normalizeMovie({ rating }).personalRating, null);
    }
});

test('gallery permits web links and blocks executable URLs and malformed poster paths', () => {
    const web = normalizeMovie({ id: 'web-1', mediaType: 'web-video', url: 'https://example.com/watch', coverUrl: 'https://example.com/cover.jpg' });
    assert.equal(web.externalUrl, 'https://example.com/watch');
    assert.equal(web.poster, 'https://example.com/cover.jpg');
    for (const value of ['javascript:alert(1)', 'data:text/html,evil', 'file:///etc/passwd', 'not a url']) {
        const movie = normalizeMovie({ mediaType: 'web-video', url: value, coverUrl: value });
        assert.equal(movie.externalUrl, '');
        assert.equal(movie.poster, PLACEHOLDER);
    }
    assert.equal(normalizeMovie({ tmdb: { poster_path: '/poster.jpg" onerror="alert(1)' } }).poster, PLACEHOLDER);
    assert.equal(normalizeMovie({ id: '1/../../bad' }).externalUrl, '');
    assert.equal(normalizeMovie({ id: 123, mediaType: 'tv' }).externalUrl, 'https://www.themoviedb.org/tv/123');
    assert.equal(normalizeMovie({ tmdb: { backdrop_path: '/fallback.jpg' } }).poster, 'https://image.tmdb.org/t/p/w500/fallback.jpg');
});

test('search and type filters compose without changing the source collection', () => {
    const movies = [
        { id: 1, title: 'B Movie', mediaType: 'movie', note: 'A memorable SUNSET' },
        { id: 2, title: 'A Series', mediaType: 'tv', tmdb: { original_title: 'Sunset Story' } },
        { id: 3, title: 'C Video', mediaType: 'web-video', creator: 'Sunset Creator' },
        { id: 4, title: 'D Wishlist', status: 'wishlist', note: 'sunset' },
    ].map(normalizeMovie);
    assert.equal(selectMovies(movies, { query: ' SUNSET ' }).length, 3);
    assert.deepEqual(selectMovies(movies, { query: 'sunset', type: 'tv' }).map(movie => movie.id), [2]);
    assert.deepEqual(selectMovies(movies, { sort: 'title' }).map(movie => movie.id), [2, 1, 3]);
    assert.deepEqual(movies.map(movie => movie.id), [1, 2, 3, 4]);
});

test('page boundaries cover all movies once and clamp after a filter reduces the collection', () => {
    const movies = Array.from({ length: 15 }, (_, id) => ({ id }));
    const pages = [0, 1, 2].map(page => getGalleryPage(movies, page, 7));
    assert.deepEqual(pages.flatMap(page => page.items), movies);
    assert.equal(pages[2].items.length, 1);
    assert.equal(pages[0].pages, 3);
    assert.equal(pages[0].total, 15);
    assert.equal(getGalleryPage(movies.slice(0, 2), 2, 7).page, 0);
    assert.equal(getGalleryPage(movies, -1, 7).page, 0);
    assert.deepEqual(getGalleryPage([], 8, 7), { items: [], page: 0, pages: 0, total: 0 });
});
