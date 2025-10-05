#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';
import { argv, exit } from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_REGION = process.env.TMDB_REGION || null;
const TMDB_SEARCH_MOVIE_URL = 'https://api.themoviedb.org/3/search/movie';
const TMDB_SEARCH_TV_URL = 'https://api.themoviedb.org/3/search/tv';
const TMDB_MOVIE_DETAILS_URL = (id) => `https://api.themoviedb.org/3/movie/${id}`;
const TMDB_TV_DETAILS_URL = (id) => `https://api.themoviedb.org/3/tv/${id}`;
const TMDB_TV_EXTERNAL_IDS_URL = (id) => `https://api.themoviedb.org/3/tv/${id}/external_ids`;

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    exit(1);
}

const args = argv.slice(2);
let inputArg = null;
let outputArg = null;
let limit = null;

args.forEach(arg => {
    if (arg.startsWith('--output=')) {
        outputArg = arg.replace('--output=', '').trim();
    } else if (arg.startsWith('--limit=')) {
        const value = Number(arg.replace('--limit=', ''));
        if (!Number.isNaN(value) && value > 0) {
            limit = value;
        }
    } else if (!inputArg) {
        inputArg = arg;
    }
});

const INPUT_PATH = (() => {
    const defaultPath = 'data/豆伴(180354423).csv';
    const target = inputArg || defaultPath;
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
})();

const OUTPUT_PATH = (() => {
    const defaultPath = 'fromdouban.json';
    const target = outputArg || defaultPath;
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
})();

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.length || line.endsWith(',')) {
        values.push(current.trim());
    }
    return values;
}

function parseCsv(raw) {
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length);
    if (!lines.length) {
        return [];
    }
    const headers = parseCsvLine(lines[0]);
    const records = [];
    for (let i = 1; i < lines.length; i += 1) {
        const values = parseCsvLine(lines[i]);
        if (!values.length) continue;
        const record = {};
        headers.forEach((header, index) => {
            record[header.trim()] = values[index] ?? '';
        });
        const title = (record['标题'] || record['title'] || '').trim();
        const watchDateRaw = (record['创建时间'] || record['watch_date'] || record['watchDate'] || '').trim();
        const watchDate = watchDateRaw ? watchDateRaw.split(' ')[0] : '';
        const imdb = (record['IMDb'] || record['IMDb链接'] || record['imdb_id'] || record['imdb'] || '').trim();
        const doubanUrl = (record['链接'] || record['douban_link'] || record['url'] || '').trim();
        const note = (record['评论'] || record['note'] || '').trim();
        const rating = (record['我的评分'] || record['rating'] || '').trim();
        records.push({
            title,
            watch_date: watchDate,
            imdb_id: imdb,
            douban_url: doubanUrl,
            note,
            my_rating: rating,
        });
    }
    return records;
}

async function loadEntries(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf-8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`File not found: ${path}`);
            return [];
        }
        throw error;
    }
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (path.toLowerCase().endsWith('.csv')) {
        return parseCsv(trimmed);
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('JSON parse failed, attempting CSV parsing instead.');
            return parseCsv(trimmed);
        }
    }
    return parseCsv(trimmed);
}

async function searchMovies(title, year) {
    const url = new URL(TMDB_SEARCH_MOVIE_URL);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('query', title);
    url.searchParams.set('language', TMDB_LANGUAGE);
    url.searchParams.set('include_adult', 'false');
    if (year) {
        url.searchParams.set('year', year);
        url.searchParams.set('primary_release_year', year);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB movie search failed (${response.status})`);
    }
    const data = await response.json();
    return Array.isArray(data.results)
        ? data.results.map(item => ({ ...item, media_type: 'movie' }))
        : [];
}

async function searchTvShows(title, year) {
    const url = new URL(TMDB_SEARCH_TV_URL);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('query', title);
    url.searchParams.set('language', TMDB_LANGUAGE);
    url.searchParams.set('include_adult', 'false');
    if (year) {
        url.searchParams.set('first_air_date_year', year);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB TV search failed (${response.status})`);
    }
    const data = await response.json();
    return Array.isArray(data.results)
        ? data.results.map(item => ({ ...item, media_type: 'tv' }))
        : [];
}

function releaseYearFromResult(result) {
    const source = result.media_type === 'tv'
        ? result.first_air_date
        : result.release_date;
    return source ? source.slice(0, 4) : '';
}

function pickBestMatch(results, title, year) {
    if (!results.length) return null;
    const normalizedTitle = title.replace(/\s+/g, '').toLowerCase();

    let filtered = results;
    if (year) {
        filtered = results.filter(res => releaseYearFromResult(res) === year);
    }
    if (filtered.length === 1) {
        return filtered[0];
    }

    const exactMatches = filtered.filter(res => {
        const resTitle = (res.title || res.name || '').replace(/\s+/g, '').toLowerCase();
        return resTitle === normalizedTitle;
    });
    if (exactMatches.length === 1) {
        return exactMatches[0];
    }
    if (exactMatches.length > 1) {
        filtered = exactMatches;
    }

    return filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
}

async function resolveImdbId(result) {
    if (!result) return null;
    if (result.media_type === 'tv') {
        const url = new URL(TMDB_TV_EXTERNAL_IDS_URL(result.id));
        url.searchParams.set('api_key', TMDB_API_KEY);
        url.searchParams.set('language', TMDB_LANGUAGE);
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`获取 TV External IDs 失败 (${response.status})`);
            return null;
        }
        const data = await response.json();
        return data.imdb_id || null;
    }

    const url = new URL(TMDB_MOVIE_DETAILS_URL(result.id));
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`获取 Movie Details 失败 (${response.status})`);
        return null;
    }
    const data = await response.json();
    return data.imdb_id || null;
}

async function main() {
    console.log(`读取影片列表：${INPUT_PATH}`);
    const entries = await loadEntries(INPUT_PATH);
    if (!entries.length) {
        console.log('未读取到任何数据。');
        return;
    }

    const results = [];
    for (let index = 0; index < entries.length; index += 1) {
        if (limit && results.length >= limit) {
            break;
        }
        const item = entries[index];
        const title = (item.title || '').trim();
        if (!title) {
            console.log(`\n[${index + 1}] 缺少标题，已跳过。`);
            continue;
        }

        const year = (item.year || '').trim();
        let imdbId = item.imdb_id?.trim();
        let tmdbId = null;
        let mediaType = 'movie';

        if (imdbId) {
            tmdbId = null;
        } else {
            const movieResults = await searchMovies(title, year);
            const tvResults = await searchTvShows(title, year);
            const combined = [...movieResults, ...tvResults];
            const best = pickBestMatch(combined, title, year);
            if (best) {
                tmdbId = best.id;
                mediaType = best.media_type || 'movie';
                imdbId = await resolveImdbId(best);
            } else {
                console.log(`未找到 TMDB 匹配：${title}`);
            }
        }

        results.push({
            title,
            watch_date: item.watch_date || '',
            year,
            imdb_id: imdbId || null,
            tmdb_id: tmdbId,
            douban_url: item.douban_url || null,
            note: item.note || null,
            my_rating: item.my_rating || null,
            media_type: mediaType,
        });
    }

    const outputDir = dirname(OUTPUT_PATH);
    await mkdir(outputDir, { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`);

    console.log(`已写入 ${results.length} 条记录到 ${OUTPUT_PATH}`);
}

main()
    .catch(error => {
        console.error('转换失败：', error.message);
        process.exitCode = 1;
    });
