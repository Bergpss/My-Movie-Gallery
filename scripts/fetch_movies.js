#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_REGION = process.env.TMDB_REGION || null;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const LIBRARY_PATH = resolve(process.cwd(), 'data/library.json');
const OUTPUT_PATH = resolve(process.cwd(), 'data/movies.json');

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable');
    process.exit(1);
}

async function loadLibrary() {
    const raw = await readFile(LIBRARY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    const watching = Array.isArray(parsed?.watching) ? parsed.watching : [];
    const watched = Array.isArray(parsed?.watched) ? parsed.watched : [];

    const deduped = new Map();

    const upsert = (entry, defaultStatus) => {
        if (!entry || typeof entry.id === 'undefined') {
            return;
        }

        const key = String(entry.id);
        const existing = deduped.get(key) || {};

        deduped.set(key, {
            id: entry.id,
            title: entry.title ?? existing.title ?? null,
            watchDate: entry.watchDate ?? existing.watchDate ?? null,
            rating: typeof entry.rating === 'number' ? entry.rating : existing.rating ?? null,
            status: (entry.status || existing.status || defaultStatus || null),
            note: entry.note ?? existing.note ?? null,
        });
    };

    watching.forEach(entry => upsert(entry, 'watching'));
    watched.forEach(entry => upsert(entry, 'watched'));

    return Array.from(deduped.values());
}

async function fetchMovieDetails(id) {
    const url = new URL(`${TMDB_BASE_URL}/movie/${id}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    if (TMDB_REGION) {
        url.searchParams.set('region', TMDB_REGION);
    }
    url.searchParams.set('append_to_response', 'credits,release_dates');

    const response = await fetch(url);

    if (response.status === 404) {
        console.warn(`Movie ${id} not found on TMDB (404)`);
        return null;
    }

    if (!response.ok) {
        throw new Error(`TMDB request failed for movie ${id} with status ${response.status}`);
    }

    return response.json();
}

function extractDirectors(credits) {
    if (!credits || !Array.isArray(credits.crew)) {
        return [];
    }

    return credits.crew
        .filter(member => member.job === 'Director')
        .map(member => member.name)
        .filter(Boolean);
}

async function buildSnapshot(libraryEntries) {
    const enriched = [];

    for (const entry of libraryEntries) {
        const details = await fetchMovieDetails(entry.id);

        if (!details) {
            continue;
        }

        const directors = extractDirectors(details.credits);

        enriched.push({
            id: details.id,
            title: entry.title ?? details.title ?? details.name ?? '',
            status: entry.status ?? null,
            watchDate: entry.watchDate ?? null,
            rating: typeof entry.rating === 'number' ? entry.rating : null,
            note: entry.note ?? null,
            tmdb: {
                original_title: details.original_title,
                original_language: details.original_language,
                title: details.title,
                overview: details.overview,
                poster_path: details.poster_path,
                backdrop_path: details.backdrop_path,
                release_date: details.release_date,
                runtime: details.runtime,
                genres: details.genres ?? [],
                vote_average: details.vote_average,
                vote_count: details.vote_count,
                popularity: details.popularity,
                homepage: details.homepage ?? null,
                directors,
            },
        });
    }

    return enriched;
}

async function main() {
    try {
        const entries = await loadLibrary();

        if (entries.length === 0) {
            console.warn('Library is empty. No movies to fetch.');
        }

        const snapshot = await buildSnapshot(entries);

        const payload = {
            generatedAt: new Date().toISOString(),
            source: {
                type: 'local-library',
                language: TMDB_LANGUAGE,
                region: TMDB_REGION ?? undefined,
                total: snapshot.length,
            },
            items: snapshot,
        };

        await mkdir(dirname(OUTPUT_PATH), { recursive: true });
        await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
        console.log(`Wrote ${snapshot.length} movies to ${OUTPUT_PATH}`);
    } catch (error) {
        console.error('Failed to build movie snapshot:', error.message);
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
});
