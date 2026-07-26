const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildTasteProfile,
    rankExternalRecommendations,
} = require('../recommendation-engine.js');
const recommendationEngine = require('../recommendation-engine.js');

test('recommendation engine does not expose local wishlist recommendations', () => {
    assert.equal(recommendationEngine.getLocalWishlistRecommendations, undefined);
});

test('buildTasteProfile weights watched genres from rated history', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: 'High Rated Drama',
            status: 'watched',
            rating: 9,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }, { id: 53, name: '惊悚' }],
                directors: ['A'],
            },
        },
        {
            id: 2,
            title: 'Lower Rated Comedy',
            status: 'watched',
            rating: 6,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 35, name: '喜剧' }],
                directors: ['B'],
            },
        },
        {
            id: 3,
            title: 'Wishlist Drama',
            status: 'wishlist',
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
    ]);

    assert.equal(profile.watchedCount, 2);
    assert.equal(profile.topGenres[0].id, 18);
    assert.equal(profile.topGenres[0].name, '剧情');
    assert.deepEqual(profile.existingMovieIds.sort(), ['1', '2', '3']);
});

test('buildTasteProfile treats low ratings as negative preference signals', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: 'Loved Drama',
            status: 'watched',
            rating: 10,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
        {
            id: 2,
            title: 'Disliked Comedy',
            status: 'watched',
            rating: 4,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 35, name: '喜剧' }],
            },
        },
        {
            id: 3,
            title: 'Unknown Status',
            rating: 10,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 27, name: '恐怖' }],
            },
        },
    ]);

    assert.equal(profile.watchedCount, 2);
    assert.equal(profile.topGenres[0].id, 18);
    assert.equal(profile.dislikedGenres[0].id, 35);
    assert.ok(profile.dislikedGenres[0].score < 0);
    assert.equal(profile.topGenres.some(genre => genre.id === 35), false);
});

test('rankExternalRecommendations excludes existing movies and dedupes candidates', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: 'Watched Drama',
            status: 'watched',
            rating: 9,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
        {
            id: 2,
            title: 'Existing Wishlist',
            status: 'wishlist',
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
    ]);

    const ranked = rankExternalRecommendations([
        {
            id: 2,
            title: 'Existing Wishlist',
            genre_ids: [18],
            vote_average: 9,
            vote_count: 2000,
        },
        {
            id: 3,
            title: 'New Drama',
            genre_ids: [18],
            vote_average: 7.2,
            vote_count: 300,
        },
        {
            id: 3,
            title: 'New Drama Duplicate',
            genre_ids: [18],
            vote_average: 7.2,
            vote_count: 300,
        },
    ], profile, {
        genreMap: { 18: '剧情' },
        limit: 5,
    });

    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, 3);
    assert.equal(ranked[0].mediaType, 'movie');
    assert.equal(ranked[0].recommendationSource, 'tmdb');
    assert.match(ranked[0].recommendationReason, /剧情/);
});

test('rankExternalRecommendations explains seed-based matches with a watched title', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: '末路狂花',
            status: 'watched',
            rating: 10,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
    ]);

    const [recommendation] = rankExternalRecommendations([
        {
            id: 2,
            title: 'New Road Movie',
            genre_ids: [18],
            vote_average: 8.1,
            vote_count: 1200,
            recommendationContext: {
                sources: [{ type: 'seed', seedId: '1', seedTitle: '末路狂花' }],
            },
        },
    ], profile, {
        genreMap: { 18: '剧情' },
        limit: 1,
    });

    assert.match(recommendation.recommendationReason, /《末路狂花》/);
});

test('rankExternalRecommendations prefers reliable ratings over tiny vote samples', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: 'Loved Drama',
            status: 'watched',
            rating: 10,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
    ]);

    const ranked = rankExternalRecommendations([
        { id: 2, title: 'Tiny Sample', genre_ids: [18], vote_average: 9.5, vote_count: 8 },
        { id: 3, title: 'Reliable Favorite', genre_ids: [18], vote_average: 8.4, vote_count: 5000 },
    ], profile, {
        genreMap: { 18: '剧情' },
        limit: 2,
    });

    assert.equal(ranked[0].id, 3);
});

test('rankExternalRecommendations diversifies the primary genres in the final list', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: 'Loved Drama',
            status: 'watched',
            rating: 10,
            mediaType: 'movie',
            tmdb: {
                genres: [
                    { id: 18, name: '剧情' },
                    { id: 35, name: '喜剧' },
                    { id: 878, name: '科幻' },
                ],
            },
        },
    ]);

    const candidates = [
        { id: 10, title: 'Drama 1', genre_ids: [18], vote_average: 9.0, vote_count: 4000 },
        { id: 11, title: 'Drama 2', genre_ids: [18], vote_average: 8.9, vote_count: 3500 },
        { id: 12, title: 'Drama 3', genre_ids: [18], vote_average: 8.8, vote_count: 3000 },
        { id: 13, title: 'Drama 4', genre_ids: [18], vote_average: 8.7, vote_count: 2500 },
        { id: 20, title: 'Comedy', genre_ids: [35], vote_average: 8.0, vote_count: 1800 },
        { id: 30, title: 'Science Fiction', genre_ids: [878], vote_average: 7.9, vote_count: 1600 },
    ];

    const ranked = rankExternalRecommendations(candidates, profile, {
        genreMap: {
            18: '剧情',
            35: '喜剧',
            878: '科幻',
        },
        limit: 4,
    });
    const primaryGenreIds = ranked.map(movie => movie.tmdb.genres[0].id);

    assert.equal(ranked.length, 4);
    assert.ok(new Set(primaryGenreIds).size >= 3);
    assert.ok(primaryGenreIds.filter(id => id === 18).length <= 2);
});

test('rankExternalRecommendations returns only TMDB-sourced movies outside the library', () => {
    const profile = buildTasteProfile([
        {
            id: 1,
            title: 'Watched Drama',
            status: 'watched',
            rating: 9,
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
        {
            id: 2,
            title: 'Wishlist Drama',
            status: 'wishlist',
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
        {
            id: 3,
            title: 'Watching Drama',
            status: 'watching',
            mediaType: 'movie',
            tmdb: {
                genres: [{ id: 18, name: '剧情' }],
            },
        },
    ]);

    const ranked = rankExternalRecommendations([
        { id: 1, title: 'Already Watched', genre_ids: [18], vote_average: 9, vote_count: 2000 },
        { id: 2, title: 'Already Wishlist', genre_ids: [18], vote_average: 8.5, vote_count: 1500 },
        { id: 3, title: 'Already Watching', genre_ids: [18], vote_average: 8, vote_count: 1200 },
        { id: 4, title: 'New TMDB Movie', genre_ids: [18], vote_average: 7.8, vote_count: 900 },
    ], profile, {
        genreMap: { 18: '剧情' },
        limit: 5,
    });

    assert.deepEqual(ranked.map(movie => movie.id), [4]);
    assert.ok(ranked.every(movie => movie.recommendationSource === 'tmdb'));
});
