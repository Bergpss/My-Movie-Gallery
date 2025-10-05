#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { argv, exit } from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY; // not required but kept for consistency

const args = argv.slice(2);
let inputArg = null;
let libraryArg = null;
let limit = null;

args.forEach(arg => {
    if (arg.startsWith('--library=')) {
        libraryArg = arg.replace('--library=', '').trim();
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
    const target = inputArg || 'fromdouban.json';
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
})();

const LIBRARY_PATH = (() => {
    const target = libraryArg || 'data/library.json';
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
})();

function normaliseDate(value) {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const iso = new Date(trimmed);
    if (Number.isNaN(iso.getTime())) {
        return null;
    }
    return iso.toISOString().slice(0, 10);
}

function parseRating(raw) {
    if (!raw && raw !== 0) return null;
    const numeric = Number(String(raw).trim());
    if (Number.isNaN(numeric)) {
        return null;
    }
    return numeric;
}

async function loadJson(path, fallback = null) {
    try {
        const raw = await readFile(path, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        if (fallback !== null && error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}

function extractWatchDates(entry) {
    if (Array.isArray(entry.watchDates)) {
        return entry.watchDates;
    }
    if (entry.watchDate) {
        return [entry.watchDate];
    }
    return [];
}

function mergeDates(existing = [], incoming = []) {
    return Array.from(new Set([...existing, ...incoming].filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function removeById(list, id) {
    return list.filter(item => String(item.id) !== String(id));
}

async function main() {
    const entries = await loadJson(INPUT_PATH, []);
    if (!Array.isArray(entries) || entries.length === 0) {
        console.log('fromdouban.json 为空，未进行任何导入。');
        return;
    }

    const library = await loadJson(LIBRARY_PATH, { watching: [], watched: [], wishlist: [] });
    library.watching = Array.isArray(library.watching) ? library.watching : [];
    library.watched = Array.isArray(library.watched) ? library.watched : [];
    library.wishlist = Array.isArray(library.wishlist) ? library.wishlist : [];

    let watching = [...library.watching];
    let wishlist = [...library.wishlist];
    const watched = [...library.watched];

    let imported = 0;

    for (const item of entries) {
        if (limit && imported >= limit) {
            break;
        }

        const tmdbId = item?.tmdb_id;
        if (!tmdbId) {
            continue;
        }

        const title = item?.title?.trim();
        if (!title) {
            continue;
        }

        if (item?.media_type && item.media_type !== 'movie') {
            continue;
        }

        const mediaType = 'movie';
        const watchDate = normaliseDate(item?.watch_date);
        const rating = parseRating(item?.my_rating);
        const note = item?.note?.trim() || null;

        watching = removeById(watching, tmdbId);
        wishlist = removeById(wishlist, tmdbId);

        const existingIndex = watched.findIndex(entry => String(entry.id) === String(tmdbId));
        if (existingIndex !== -1) {
            const existing = watched[existingIndex];
            const mergedDates = mergeDates(extractWatchDates(existing), watchDate ? [watchDate] : []);
            watched[existingIndex] = {
                ...existing,
                title: title || existing.title,
                mediaType: 'movie',
                status: 'watched',
                watchDates: mergedDates,
                watchDate: mergedDates[0] || null,
                rating: typeof rating === 'number' ? rating : existing.rating,
                note: note || existing.note || null,
            };
        } else {
            const watchDates = watchDate ? [watchDate] : [];
            watched.unshift({
                id: tmdbId,
                title,
                mediaType,
                status: 'watched',
                watchDates,
                watchDate: watchDates[0] || null,
                rating: typeof rating === 'number' ? rating : null,
                note,
            });
        }

        imported += 1;
    }

    library.watching = watching;
    library.watched = watched;
    library.wishlist = wishlist;

    await writeFile(LIBRARY_PATH, `${JSON.stringify(library, null, 2)}\n`);
    console.log(`已导入 ${imported} 条记录到 ${LIBRARY_PATH} 的 watched 列表。`);
    if (imported === 0) {
        console.log('提示：可能缺少 tmdb_id，请确保 export 脚本已成功匹配影片。');
    }
}

main().catch(error => {
    console.error('导入失败：', error.message);
    process.exitCode = 1;
});
