#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_SESSION_ID = process.env.TMDB_SESSION_ID;
const TMDB_ACCOUNT_ID = process.env.TMDB_ACCOUNT_ID;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const SORT_BY = process.env.TMDB_SORT_BY || 'rated_at.desc';

async function fetchRatedMovies() {
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
        const url = new URL(`${TMDB_BASE_URL}/account/${TMDB_ACCOUNT_ID}/rated/movies`);
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
