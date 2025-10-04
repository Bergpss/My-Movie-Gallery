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

function normaliseWatchDates(...sources) {
    const combined = [];
    sources.forEach(source => {
        if (Array.isArray(source)) {
            combined.push(...source);
        } else if (source) {
            combined.push(source);
        }
    });
    return Array.from(new Set(
        combined
            .filter(Boolean)
            .map(item => item.trim())
            .filter(Boolean),
    )).sort((a, b) => b.localeCompare(a));
}

async function loadLibrary() {
    const raw = await readFile(LIBRARY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    const watching = Array.isArray(parsed?.watching) ? parsed.watching : [];
    const watched = Array.isArray(parsed?.watched) ? parsed.watched : [];
    const wishlist = Array.isArray(parsed?.wishlist) ? parsed.wishlist : [];

    const deduped = new Map();

    const upsert = (entry, defaultStatus) => {
        if (!entry || typeof entry.id === 'undefined') {
            return;
        }
        const key = String(entry.id);
        const existing = deduped.get(key) || {};

        const watchDates = normaliseWatchDates(
            existing.watchDates,
            existing.watchDate,
            entry.watchDates,
            entry.watchDate,
        );

        deduped.set(key, {
            id: entry.id,
            title: entry.title ?? existing.title ?? null,
            watchDates,
            watchDate: watchDates[0] ?? null,
            rating: typeof entry.rating === 'number' ? entry.rating : existing.rating ?? null,
            status: entry.status || existing.status || defaultStatus || null,
            note: entry.note ?? existing.note ?? null,
            mediaType: entry.mediaType || existing.mediaType || 'movie',
        });
    };

    watching.forEach(entry => upsert(entry, 'watching'));
    watched.forEach(entry => upsert(entry, 'watched'));
    wishlist.forEach(entry => upsert(entry, 'wishlist'));

    return Array.from(deduped.values());
}

async function fetchDetails(id, mediaType = 'movie') {
    const path = mediaType === 'tv' ? `/tv/${id}` : `/movie/${id}`;
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    if (TMDB_REGION && mediaType === 'movie') {
        url.searchParams.set('region', TMDB_REGION);
    }
    const append = mediaType === 'tv' ? 'credits' : 'credits,release_dates';
    url.searchParams.set('append_to_response', append);

    const response = await fetch(url);

    if (response.status === 404) {
        console.warn(`${mediaType.toUpperCase()} ${id} not found on TMDB (404)`);
        return null;
    }

    if (!response.ok) {
        throw new Error(`TMDB request failed for ${mediaType} ${id} with status ${response.status}`);
    }

    return response.json();
}

function extractDirectors(credits) {
    if (!credits || !Array.isArray(credits.crew)) {
        return [];
    }

    return credits.crew
        .filter(member => member.job === 'Director' || member.job === 'Series Director')
        .map(member => member.name)
        .filter(Boolean);
}

function buildTmdbPayload(details, mediaType) {
    if (mediaType === 'tv') {
        return {
            original_title: details.original_name,
            original_language: details.original_language,
            title: details.name,
            overview: details.overview,
            poster_path: details.poster_path,
            backdrop_path: details.backdrop_path,
            release_date: details.first_air_date,
            runtime: Array.isArray(details.episode_run_time) && details.episode_run_time.length
                ? details.episode_run_time[0]
                : null,
            genres: details.genres ?? [],
            vote_average: details.vote_average,
            vote_count: details.vote_count,
            popularity: details.popularity,
            homepage: details.homepage ?? null,
            directors: extractDirectors(details.credits),
        };
    }

    return {
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
        directors: extractDirectors(details.credits),
    };
}

async function buildSnapshot(entries) {
    const enriched = [];

    for (const entry of entries) {
        const mediaType = entry.mediaType || 'movie';
        const details = await fetchDetails(entry.id, mediaType);
        if (!details) {
            continue;
        }

        const watchDates = Array.isArray(entry.watchDates)
            ? entry.watchDates
            : entry.watchDate
                ? [entry.watchDate]
                : [];
        const orderedWatchDates = [...watchDates].sort((a, b) => b.localeCompare(a));

        enriched.push({
            id: details.id,
            title: entry.title ?? (mediaType === 'tv' ? details.name : details.title) ?? '',
            mediaType,
            status: entry.status ?? null,
            watchDates: orderedWatchDates,
            watchDate: orderedWatchDates[0] ?? null,
            rating: typeof entry.rating === 'number' ? entry.rating : null,
            note: entry.note ?? null,
            tmdb: buildTmdbPayload(details, mediaType),
        });
    }

    return enriched;
}

async function main() {
    try {
        const entries = await loadLibrary();
        if (!entries.length) {
            console.warn('Library is empty. No entries to process.');
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
        await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
        console.log(`Wrote ${snapshot.length} entries to ${OUTPUT_PATH}`);
    } catch (error) {
        console.error('Failed to build movie snapshot:', error.message);
        process.exitCode = 1;
    }
}

main()
    .catch(error => {
        console.error('Unexpected error:', error);
        process.exitCode = 1;
    });
