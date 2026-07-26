const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_LANGUAGE = 'zh-CN';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
    });
}

function normalizeId(id) {
    return id === null || id === undefined ? '' : String(id);
}

function getTopGenreIds(profile) {
    return (Array.isArray(profile?.topGenres) ? profile.topGenres : [])
        .map(genre => Number(genre.id))
        .filter(id => Number.isInteger(id) && id > 0)
        .slice(0, 3);
}

function getSeedMovies(profile) {
    return (Array.isArray(profile?.seedMovies) ? profile.seedMovies : [])
        .map(movie => ({
            id: Number(movie.id),
            title: String(movie.title || '').trim(),
        }))
        .filter(movie => Number.isInteger(movie.id) && movie.id > 0)
        .slice(0, 4);
}

function buildTmdbUrl(path, apiKey, params = {}) {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('language', TMDB_LANGUAGE);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });

    return url;
}

async function fetchTmdbJson(path, apiKey, params) {
    const response = await fetch(buildTmdbUrl(path, apiKey, params));

    if (!response.ok) {
        throw new Error(`TMDB request failed with status ${response.status}`);
    }

    return response.json();
}

async function fetchGenreMap(apiKey) {
    const data = await fetchTmdbJson('/genre/movie/list', apiKey);
    const genreMap = {};

    (data.genres || []).forEach(genre => {
        if (genre.id && genre.name) {
            genreMap[String(genre.id)] = genre.name;
        }
    });

    return genreMap;
}

async function fetchDiscoverCandidates(apiKey, genreIds, page = 1) {
    const params = {
        include_adult: 'false',
        include_video: 'false',
        page: String(page),
        sort_by: 'vote_average.desc',
        'vote_count.gte': '300',
    };

    if (genreIds.length > 0) {
        params.with_genres = genreIds.join('|');
    }

    const data = await fetchTmdbJson('/discover/movie', apiKey, params);
    return data.results || [];
}

async function fetchRecommendationCandidates(apiKey, seedId) {
    const data = await fetchTmdbJson(`/movie/${seedId}/recommendations`, apiKey, {
        page: '1',
    });
    return data.results || [];
}

function addRecommendationSource(movie, source) {
    const sources = movie.recommendationContext.sources;
    const sourceKey = JSON.stringify(source);
    const hasSource = sources.some(existingSource => JSON.stringify(existingSource) === sourceKey);

    if (!hasSource) {
        sources.push(source);
    }
}

export function collectCandidates(candidateSets, existingIds, limit) {
    const candidatesById = new Map();
    const candidates = [];
    const positions = candidateSets.map(() => 0);
    let hasRemainingCandidates = true;

    while (hasRemainingCandidates && candidates.length < limit) {
        hasRemainingCandidates = false;

        candidateSets.forEach((candidateSet, index) => {
            const movies = Array.isArray(candidateSet?.movies) ? candidateSet.movies : [];
            if (positions[index] >= movies.length) {
                return;
            }

            hasRemainingCandidates = true;
            const movie = movies[positions[index]];
            positions[index] += 1;

            const id = normalizeId(movie?.id);
            if (!id || existingIds.has(id) || movie.adult) {
                return;
            }

            const existingCandidate = candidatesById.get(id);
            if (existingCandidate) {
                addRecommendationSource(existingCandidate, candidateSet.source);
                return;
            }

            if (candidates.length >= limit) {
                return;
            }

            const candidate = {
                ...movie,
                recommendationContext: {
                    sources: [],
                },
            };
            addRecommendationSource(candidate, candidateSet.source);
            candidatesById.set(id, candidate);
            candidates.push(candidate);
        });
    }

    return candidates;
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const tmdbApiKey = env.TMDB_API_KEY;
        if (!tmdbApiKey) {
            return jsonResponse({ error: 'TMDB API 未配置' }, 500);
        }

        const body = await request.json().catch(() => ({}));
        const profile = body.profile || {};
        const limit = Math.max(1, Math.min(Number(body.limit) || 40, 60));
        const existingIds = new Set((profile.existingMovieIds || []).map(normalizeId));
        const topGenreIds = getTopGenreIds(profile);
        const seedMovies = getSeedMovies(profile);

        const candidateRequests = [
            {
                source: { type: 'discover', genreIds: topGenreIds },
                promise: fetchDiscoverCandidates(tmdbApiKey, topGenreIds, 1),
            },
            {
                source: { type: 'discover', genreIds: topGenreIds.slice(0, 1) },
                promise: fetchDiscoverCandidates(tmdbApiKey, topGenreIds.slice(0, 1), 1),
            },
            ...seedMovies.map(seedMovie => ({
                source: {
                    type: 'seed',
                    seedId: normalizeId(seedMovie.id),
                    seedTitle: seedMovie.title,
                },
                promise: fetchRecommendationCandidates(tmdbApiKey, seedMovie.id),
            })),
        ];

        const [genreMapResult, ...candidateResults] = await Promise.allSettled([
            fetchGenreMap(tmdbApiKey),
            ...candidateRequests.map(candidateRequest => candidateRequest.promise),
        ]);

        const genreMap = genreMapResult.status === 'fulfilled' ? genreMapResult.value : {};
        const candidateSets = candidateResults
            .map((result, index) => result.status === 'fulfilled'
                ? {
                    source: candidateRequests[index].source,
                    movies: result.value,
                }
                : null)
            .filter(Boolean);

        if (candidateSets.length === 0) {
            console.error(JSON.stringify({
                message: 'All TMDB recommendation requests failed',
                seedCount: seedMovies.length,
                genreCount: topGenreIds.length,
            }));
            return jsonResponse({ error: 'TMDB 推荐服务暂不可用' }, 502);
        }

        const results = collectCandidates(candidateSets, existingIds, limit);

        return jsonResponse({
            results,
            genreMap,
        });
    } catch (error) {
        console.error(JSON.stringify({
            message: 'Recommendation request failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        return jsonResponse({ error: '推荐请求失败' }, 500);
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: corsHeaders,
    });
}
