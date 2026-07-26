(function attachRecommendationEngine(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.MovieRecommendationEngine = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRecommendationEngine() {
    function normalizeId(id) {
        return id === null || id === undefined ? '' : String(id);
    }

    function normalizeStatus(movie) {
        return String(movie?.status || '').toLowerCase();
    }

    function getMediaType(movie) {
        return movie?.mediaType || movie?.media_type || 'movie';
    }

    function isMovie(movie) {
        return getMediaType(movie) === 'movie';
    }

    function isWatchedMovie(movie) {
        const status = normalizeStatus(movie);
        return isMovie(movie) && status === 'watched';
    }

    function getWatchDate(movie) {
        if (Array.isArray(movie?.watchDates) && movie.watchDates.length > 0) {
            return movie.watchDates[0];
        }
        return movie?.watchDate || null;
    }

    function getReleaseDate(movie) {
        return movie?.tmdb?.release_date || movie?.release_date || movie?.releaseDate || null;
    }

    function getRating(movie) {
        if (typeof movie?.rating === 'number') {
            return movie.rating;
        }
        if (typeof movie?.tmdb?.vote_average === 'number') {
            return movie.tmdb.vote_average;
        }
        if (typeof movie?.vote_average === 'number') {
            return movie.vote_average;
        }
        return null;
    }

    function getVoteCount(movie) {
        if (typeof movie?.tmdb?.vote_count === 'number') {
            return movie.tmdb.vote_count;
        }
        if (typeof movie?.vote_count === 'number') {
            return movie.vote_count;
        }
        return 0;
    }

    function getTitle(movie) {
        return movie?.tmdb?.title
            || movie?.title
            || movie?.name
            || movie?.original_title
            || movie?.original_name
            || 'Untitled';
    }

    function normalizeGenre(genre, genreMap = {}) {
        if (!genre) {
            return null;
        }

        if (typeof genre === 'number') {
            const id = genre;
            return {
                id,
                name: genreMap[String(id)] || String(id),
            };
        }

        if (typeof genre === 'string') {
            const id = genre;
            return {
                id,
                name: genreMap[id] || id,
            };
        }

        const id = genre.id === null || genre.id === undefined ? '' : genre.id;
        const name = genre.name || genreMap[String(id)] || String(id);

        if (!id && !name) {
            return null;
        }

        return { id, name };
    }

    function getGenres(movie, genreMap = {}) {
        const sourceGenres = Array.isArray(movie?.tmdb?.genres)
            ? movie.tmdb.genres
            : Array.isArray(movie?.genres)
                ? movie.genres
                : Array.isArray(movie?.genre_ids)
                    ? movie.genre_ids
                    : [];

        return sourceGenres
            .map(genre => normalizeGenre(genre, genreMap))
            .filter(Boolean);
    }

    function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
    }

    function calculateRatingStats(movies) {
        const ratings = movies
            .map(movie => movie?.rating)
            .filter(rating => typeof rating === 'number');

        if (ratings.length === 0) {
            return { count: 0, mean: 7, standardDeviation: 0 };
        }

        const mean = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
        const variance = ratings.reduce((sum, rating) => sum + ((rating - mean) ** 2), 0) / ratings.length;

        return {
            count: ratings.length,
            mean,
            standardDeviation: Math.sqrt(variance),
        };
    }

    function getPreferenceSignal(movie, ratingStats) {
        const rating = typeof movie?.rating === 'number' ? clamp(movie.rating, 0, 10) : null;
        if (rating === null) {
            return 0.1;
        }

        const semanticSignal = clamp((rating - 7) / 3, -1, 1);
        const relativeSignal = ratingStats.count >= 3 && ratingStats.standardDeviation >= 0.25
            ? clamp((rating - ratingStats.mean) / (ratingStats.standardDeviation * 2), -1, 1)
            : 0;

        return clamp((semanticSignal * 0.8) + (relativeSignal * 0.2), -1, 1);
    }

    function getRecencyWeight(movie) {
        const watchDate = getWatchDate(movie);

        if (!watchDate) {
            return 1;
        }

        const year = Number(String(watchDate).slice(0, 4));
        if (!Number.isFinite(year)) {
            return 1;
        }

        const currentYear = new Date().getFullYear();
        const age = Math.max(0, currentYear - year);
        return age <= 1 ? 1.18 : age <= 3 ? 1.08 : 1;
    }

    function getHistoryWeight(movie, ratingStats) {
        return getPreferenceSignal(movie, ratingStats) * getRecencyWeight(movie);
    }

    function addWeightedScore(map, key, label, weight) {
        if (!key && !label) {
            return;
        }

        const stableKey = key || label;
        const existing = map.get(stableKey) || {
            id: key || '',
            name: label || key,
            score: 0,
            count: 0,
        };

        existing.score += weight;
        existing.count += 1;
        map.set(stableKey, existing);
    }

    function normalizeGenreScores(entries, direction) {
        const matchingEntries = entries.filter(entry => direction === 'positive'
            ? entry.score > 0.05
            : entry.score < -0.05);
        const maximumMagnitude = Math.max(
            ...matchingEntries.map(entry => Math.abs(entry.score)),
            1,
        );

        return matchingEntries
            .map(entry => ({
                ...entry,
                rawScore: Number(entry.score.toFixed(3)),
                score: Number((entry.score / maximumMagnitude).toFixed(4)),
            }))
            .sort((a, b) => {
                if (a.score !== b.score) {
                    return direction === 'positive' ? b.score - a.score : a.score - b.score;
                }
                if (a.count !== b.count) {
                    return b.count - a.count;
                }
                return String(a.name).localeCompare(String(b.name));
            });
    }

    function buildTasteProfile(movies) {
        const items = Array.isArray(movies) ? movies : [];
        const watchedMovies = items.filter(isWatchedMovie);
        const existingMovieIds = items
            .filter(isMovie)
            .map(movie => normalizeId(movie.id))
            .filter(Boolean);

        const genreScores = new Map();
        const ratingStats = calculateRatingStats(watchedMovies);

        watchedMovies.forEach(movie => {
            const weight = getHistoryWeight(movie, ratingStats);

            getGenres(movie).forEach(genre => {
                addWeightedScore(genreScores, genre.id, genre.name, weight);
            });
        });

        const seedMovies = watchedMovies
            .map(movie => ({
                id: normalizeId(movie.id),
                title: getTitle(movie),
                score: getHistoryWeight(movie, ratingStats),
            }))
            .filter(movie => movie.id && movie.score > 0.2)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
        const allGenreScores = Array.from(genreScores.values());

        return {
            watchedCount: watchedMovies.length,
            existingMovieIds: Array.from(new Set(existingMovieIds)),
            topGenres: normalizeGenreScores(allGenreScores, 'positive').slice(0, 8),
            dislikedGenres: normalizeGenreScores(allGenreScores, 'negative').slice(0, 5),
            seedMovies,
            ratingStats: {
                count: ratingStats.count,
                mean: Number(ratingStats.mean.toFixed(2)),
                standardDeviation: Number(ratingStats.standardDeviation.toFixed(2)),
            },
        };
    }

    function createLookup(entries) {
        const lookup = new Map();

        (Array.isArray(entries) ? entries : []).forEach(entry => {
            if (entry.id) {
                lookup.set(String(entry.id), entry);
            }
            if (entry.name) {
                lookup.set(String(entry.name), entry);
            }
        });

        return lookup;
    }

    function scoreCandidate(candidate, profile, options = {}) {
        const genreMap = options.genreMap || {};
        const genres = getGenres(candidate, genreMap);
        const genreLookup = createLookup(profile?.topGenres);
        const dislikedGenreLookup = createLookup(profile?.dislikedGenres);

        let score = 0;
        const matchedGenres = [];

        genres.forEach(genre => {
            const profileGenre = genreLookup.get(String(genre.id)) || genreLookup.get(String(genre.name));
            if (profileGenre) {
                score += profileGenre.score * 4;
                matchedGenres.push(genre.name);
            }

            const dislikedGenre = dislikedGenreLookup.get(String(genre.id))
                || dislikedGenreLookup.get(String(genre.name));
            if (dislikedGenre) {
                score += dislikedGenre.score * 5;
            }
        });

        const sources = Array.isArray(candidate?.recommendationContext?.sources)
            ? candidate.recommendationContext.sources
            : [];
        const seedSources = sources.filter(source => source?.type === 'seed' && source.seedTitle);
        if (seedSources.length > 0) {
            score += 4 + Math.min(seedSources.length - 1, 2) * 0.5;
        }

        const rating = getRating(candidate);
        const voteCount = getVoteCount(candidate);
        if (typeof rating === 'number' && voteCount > 0) {
            const priorRating = 6.5;
            const priorVoteCount = 500;
            const weightedRating = ((rating * voteCount) + (priorRating * priorVoteCount))
                / (voteCount + priorVoteCount);
            score += (weightedRating - priorRating) * 1.5;
        }

        const releaseDate = getReleaseDate(candidate);
        if (releaseDate) {
            const releaseYear = Number(String(releaseDate).slice(0, 4));
            if (releaseYear >= 1970 && releaseYear <= new Date().getFullYear() + 1) {
                score += 0.4;
            }
        }

        const reasonParts = [];
        if (seedSources.length > 0) {
            reasonParts.push(`因为你喜欢《${seedSources[0].seedTitle}》`);
        }

        const uniqueMatchedGenres = Array.from(new Set(matchedGenres)).slice(0, 2);
        if (uniqueMatchedGenres.length > 0) {
            reasonParts.push(seedSources.length > 0
                ? `同属${uniqueMatchedGenres.join('、')}`
                : `符合你的${uniqueMatchedGenres.join('、')}偏好`);
        }

        if (reasonParts.length < 2 && typeof rating === 'number' && rating >= 8 && voteCount >= 300) {
            reasonParts.push(`TMDB ${rating.toFixed(1)} 分`);
        }

        return {
            score,
            reason: reasonParts.length > 0 ? reasonParts.join('；') : '和你的观影口味相近',
        };
    }

    function withRecommendationMeta(candidate, profile, options = {}) {
        const result = scoreCandidate(candidate, profile, options);
        return {
            ...candidate,
            recommendationScore: Number(result.score.toFixed(3)),
            recommendationReason: result.reason,
            recommendationSource: options.source || candidate.recommendationSource || 'tmdb',
        };
    }

    function sortRecommendations(a, b) {
        if (b.recommendationScore !== a.recommendationScore) {
            return b.recommendationScore - a.recommendationScore;
        }

        const ratingA = getRating(a) ?? -Infinity;
        const ratingB = getRating(b) ?? -Infinity;
        if (ratingB !== ratingA) {
            return ratingB - ratingA;
        }

        return getTitle(a).localeCompare(getTitle(b));
    }

    function normalizeExternalCandidate(candidate, genreMap = {}) {
        const genres = getGenres(candidate, genreMap);

        return {
            id: candidate.id,
            title: candidate.title || candidate.name || candidate.original_title || candidate.original_name || 'Untitled',
            mediaType: 'movie',
            tmdb: {
                title: candidate.title || candidate.name || candidate.original_title || candidate.original_name || 'Untitled',
                original_title: candidate.original_title || candidate.original_name || null,
                overview: candidate.overview || '',
                poster_path: candidate.poster_path || null,
                backdrop_path: candidate.backdrop_path || null,
                release_date: candidate.release_date || candidate.first_air_date || null,
                vote_average: typeof candidate.vote_average === 'number' ? candidate.vote_average : null,
                vote_count: typeof candidate.vote_count === 'number' ? candidate.vote_count : 0,
                genres,
            },
            recommendationContext: candidate.recommendationContext || { sources: [] },
        };
    }

    function getPrimaryGenreId(movie) {
        return normalizeId(getGenres(movie)[0]?.id);
    }

    function getGenreSimilarity(movieA, movieB) {
        const genresA = new Set(getGenres(movieA).map(genre => normalizeId(genre.id)).filter(Boolean));
        const genresB = new Set(getGenres(movieB).map(genre => normalizeId(genre.id)).filter(Boolean));
        const union = new Set([...genresA, ...genresB]);

        if (union.size === 0) {
            return 0;
        }

        const intersectionSize = [...genresA].filter(id => genresB.has(id)).length;
        return intersectionSize / union.size;
    }

    function diversifyRecommendations(sortedRecommendations, limit) {
        const remaining = [...sortedRecommendations];
        const selected = [];
        const primaryGenreCounts = new Map();
        const maxPerPrimaryGenre = Math.max(2, Math.ceil(limit / 3));

        while (remaining.length > 0 && selected.length < limit) {
            const eligible = remaining.filter(movie => {
                const primaryGenreId = getPrimaryGenreId(movie);
                return !primaryGenreId
                    || (primaryGenreCounts.get(primaryGenreId) || 0) < maxPerPrimaryGenre;
            });
            const pool = eligible.length > 0 ? eligible : remaining;
            let bestMovie = pool[0];
            let bestAdjustedScore = -Infinity;

            pool.forEach(movie => {
                const maximumSimilarity = selected.length > 0
                    ? Math.max(...selected.map(selectedMovie => getGenreSimilarity(movie, selectedMovie)))
                    : 0;
                const primaryGenreId = getPrimaryGenreId(movie);
                const samePrimaryGenreCount = primaryGenreCounts.get(primaryGenreId) || 0;
                const adjustedScore = movie.recommendationScore
                    - (maximumSimilarity * 2)
                    - (samePrimaryGenreCount * 0.5);

                if (adjustedScore > bestAdjustedScore) {
                    bestMovie = movie;
                    bestAdjustedScore = adjustedScore;
                }
            });

            selected.push(bestMovie);
            remaining.splice(remaining.indexOf(bestMovie), 1);

            const primaryGenreId = getPrimaryGenreId(bestMovie);
            if (primaryGenreId) {
                primaryGenreCounts.set(
                    primaryGenreId,
                    (primaryGenreCounts.get(primaryGenreId) || 0) + 1,
                );
            }
        }

        return selected;
    }

    function rankExternalRecommendations(candidates, profile, options = {}) {
        const limit = options.limit || 12;
        const genreMap = options.genreMap || {};
        const existingIds = new Set((profile?.existingMovieIds || []).map(normalizeId));
        const seenIds = new Set();

        const rankedRecommendations = (Array.isArray(candidates) ? candidates : [])
            .filter(candidate => {
                const id = normalizeId(candidate?.id);
                const mediaType = candidate?.media_type || candidate?.mediaType || 'movie';
                if (!id || mediaType !== 'movie') {
                    return false;
                }
                if (existingIds.has(id) || seenIds.has(id)) {
                    return false;
                }
                seenIds.add(id);
                return true;
            })
            .map(candidate => normalizeExternalCandidate(candidate, genreMap))
            .map(movie => withRecommendationMeta(movie, profile, { genreMap, source: 'tmdb' }))
            .sort(sortRecommendations);

        return diversifyRecommendations(rankedRecommendations, limit);
    }

    return {
        buildTasteProfile,
        rankExternalRecommendations,
        scoreCandidate,
    };
});
