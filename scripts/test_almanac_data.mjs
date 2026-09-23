import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMovie } from '../gallery-data.js';
import { calendarDays, posterAt, watchedByYear, yearSummary } from '../almanac-data.js';

const movie = (id, date, extra = {}) => normalizeMovie({ id, title: `片${id}`, status: 'watched', watchDate: date, ...extra });

test('watched films group by the year of their latest viewing, newest first inside a year', () => {
    const years = watchedByYear([
        movie(1, '2025-03-01'),
        movie(2, '2026-01-02'),
        movie(3, '2026-09-10'),
        movie(4, null),
        normalizeMovie({ id: 5, status: 'watching', watchDate: '2026-05-05' }),
        movie(6, '2025-01-01', { watchDates: ['2025-01-01', '2026-02-02'] }),
    ]);
    assert.deepEqual([...years.keys()], ['2025', '2026']);
    assert.deepEqual(years.get('2026').map(m => m.id), [3, 6, 2]);
    assert.deepEqual(years.get('2025').map(m => m.id), [1]);
});

test('year summary counts hours, cinema visits, average, top genre and the most memorable film', () => {
    const drama = { genres: [{ name: '剧情' }] };
    const summary = yearSummary([
        movie(1, '2026-09-10', { rating: 10, inCinema: true, tmdb: { runtime: 100, ...drama } }),
        movie(2, '2026-08-01', { rating: 10, tmdb: { runtime: 90, ...drama } }),
        movie(3, '2026-07-01', { rating: 7, tmdb: { runtime: null, genres: [{ name: '恐怖' }] } }),
        movie(4, '2026-06-01', { rating: null }),
    ]);
    assert.equal(summary.count, 4);
    assert.equal(summary.hours, 3);
    assert.equal(summary.averageRating, 9);
    assert.equal(summary.cinemaCount, 1);
    assert.equal(summary.topGenre, '剧情');
    assert.equal(summary.favorite.id, 1, '同分时取最近看的那部');
    assert.deepEqual(summary.topRated.map(m => m.id), [1, 2, 3]);
});

test('an unrated year has no average and no favorite', () => {
    const summary = yearSummary([movie(1, '2024-01-01')]);
    assert.equal(summary.averageRating, null);
    assert.equal(summary.favorite, null);
    assert.equal(summary.topGenre, null);
});

test('calendar groups films watched on the same day', () => {
    const days = calendarDays([movie(1, '2026-01-24'), movie(2, '2026-01-24'), movie(3, '2026-02-05')]);
    assert.deepEqual(days.get('01-24').map(m => m.id), [1, 2]);
    assert.deepEqual(days.get('02-05').map(m => m.id), [3]);
});

test('poster sizes only change for TMDB images', () => {
    assert.equal(posterAt('https://image.tmdb.org/t/p/w500/a.jpg', 'w92'), 'https://image.tmdb.org/t/p/w92/a.jpg');
    assert.equal(posterAt('movie_posters/placeholder.png', 'w92'), 'movie_posters/placeholder.png');
});
