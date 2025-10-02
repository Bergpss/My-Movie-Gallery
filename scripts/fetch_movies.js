#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_SESSION_ID = process.env.TMDB_SESSION_ID;
const TMDB_ACCOUNT_ID = process.env.TMDB_ACCOUNT_ID;
const TMDB_V4_ACCESS_TOKEN = process.env.TMDB_V4_ACCESS_TOKEN;
const TMDB_V3_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_V4_BASE_URL = 'https://api.themoviedb.org/4';
const LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const SORT_BY = process.env.TMDB_SORT_BY || 'created_at.desc';

async function fetchRatedMoviesV3() {
    if (!TMDB_API_KEY) {
        throw new Error('Missing TMDB_API_KEY environment variable');
    }

    if (!TMDB_SESSION_ID) {
        throw new Error('Missing TMDB_SESSION_ID environment variable');
    }

    if (!TMDB_ACCOUNT_ID) {
        throw new Error('Missing TMDB_ACCOUNT_ID environment variable');
    }

    let page = 1;
    let totalPages = 1;
    const rated = [];

    while (page <= totalPages) {
        const url = new URL(`${TMDB_V3_BASE_URL}/account/${TMDB_ACCOUNT_ID}/rated/movies`);
        url.searchParams.set('api_key', TMDB_API_KEY);
        url.searchParams.set('session_id', TMDB_SESSION_ID);
        url.searchParams.set('language', LANGUAGE);
        url.searchParams.set('sort_by', SORT_BY);
        url.searchParams.set('page', String(page));

        console.log(`Fetching rated movies page ${page}/${totalPages}...`);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`TMDB request failed with status ${response.status}`);
        }

        const data = await response.json();
        const results = data.results ?? [];

        rated.push(...results.map(item => ({
            ...item,
            media_type: 'movie',
            rated_at: item.rated_at || item.created_at || null,
        })));

        totalPages = data.total_pages ?? 1;
        page += 1;
    }

    return rated;
}

async function fetchRatedMoviesV4() {
    if (!TMDB_V4_ACCESS_TOKEN) {
        return null;
    }

    let page = 1;
    let totalPages = 1;
    const rated = [];

    while (page <= totalPages) {
        const url = new URL(`${TMDB_V4_BASE_URL}/account/${TMDB_ACCOUNT_ID}/movie/rated`);
        url.searchParams.set('language', LANGUAGE);
        url.searchParams.set('sort_by', SORT_BY);
        url.searchParams.set('page', String(page));

        console.log(`Fetching rated movies (v4) page ${page}/${totalPages}...`);
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${TMDB_V4_ACCESS_TOKEN}`,
                'Content-Type': 'application/json;charset=utf-8',
            },
        });

        if (!response.ok) {
            throw new Error(`TMDB v4 request failed with status ${response.status}`);
        }

        const data = await response.json();
        const results = data.results ?? [];

        rated.push(...results.map(item => ({
            ...item,
            rating: item.account_rating?.value ?? item.rating ?? null,
            rated_at: item.account_rating?.created_at ?? item.rated_at ?? null,
        })));

        totalPages = data.total_pages ?? 1;
        page += 1;
    }

    return rated;
}

async function fetchRatedMovies() {
    if (!TMDB_ACCOUNT_ID) {
        throw new Error('Missing TMDB_ACCOUNT_ID environment variable');
    }

    if (TMDB_V4_ACCESS_TOKEN) {
        return fetchRatedMoviesV4();
    }

    const movies = await fetchRatedMoviesV3();

    const hasTimestamps = movies.some(item => item.rated_at);
    if (!hasTimestamps) {
        console.warn('TMDB v3 responses do not include rating timestamps. Provide TMDB_V4_ACCESS_TOKEN to populate watch dates.');
    }

    return movies;
}

async function main() {
    try {
        const movies = await fetchRatedMovies();
        const outputPath = resolve(process.cwd(), 'data/movies.json');

        const payload = {
            generatedAt: new Date().toISOString(),
            source: {
                type: 'account-rated-movies',
                accountId: TMDB_ACCOUNT_ID,
                language: LANGUAGE,
                sortBy: SORT_BY,
                auth: TMDB_V4_ACCESS_TOKEN ? 'v4' : 'v3',
            },
            items: movies,
        };

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(payload, null, 2));
        console.log(`Wrote ${payload.items.length} rated movies to ${outputPath}`);
    } catch (error) {
        console.error('Failed to fetch rated movies:', error.message);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
});
