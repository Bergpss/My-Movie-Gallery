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
    if (numeric < 0) return 0;
    if (numeric <= 5) {
        return Number((numeric * 2).toFixed(1));
    }
    if (numeric <= 10) {
        return Number(numeric.toFixed(1));
    }
    return 10;
}

function normaliseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalised = value.trim().toLowerCase();
        if (!normalised) return false;
        return ['1', 'true', 'yes', 'y', '是'].includes(normalised);
    }
    return false;
}

function earliestWatchDate(entry) {
    if (Array.isArray(entry?.watchDates) && entry.watchDates.length) {
        return entry.watchDates[0];
    }
    return entry?.watchDate ?? null;
}

function latestWatchDate(entry) {
    if (Array.isArray(entry?.watchDates) && entry.watchDates.length) {
        return entry.watchDates[entry.watchDates.length - 1];
    }
    return entry?.watchDate ?? null;
}

function sortByWatchDateDesc(list) {
    return [...list].sort((a, b) => {
        const dateA = latestWatchDate(a);
        const dateB = latestWatchDate(b);
        if (dateA && dateB) {
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;
        } else if (dateA) {
            return -1;
        } else if (dateB) {
            return 1;
        }
        return (a.title || '').localeCompare(b.title || '');
    });
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
    return Array.from(new Set([...existing, ...incoming].filter(Boolean))).sort((a, b) => a.localeCompare(b));
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
        const additionalDates = Array.isArray(item?.watchDates)
            ? item.watchDates.map(normaliseDate).filter(Boolean)
            : [];
        const combinedDates = mergeDates(additionalDates, watchDate ? [watchDate] : []);
        const rating = parseRating(item?.my_rating);
        const note = item?.note?.trim() || null;
        const inCinema = normaliseBoolean(item?.inCinema ?? item?.in_cinema);

        watching = removeById(watching, tmdbId);
        wishlist = removeById(wishlist, tmdbId);

        const existingIndex = watched.findIndex(entry => String(entry.id) === String(tmdbId));
        if (existingIndex !== -1) {
            const existing = watched[existingIndex];
            const mergedDates = mergeDates(extractWatchDates(existing), combinedDates);
            watched[existingIndex] = {
                ...existing,
                title: title || existing.title,
                mediaType: 'movie',
                status: 'watched',
                watchDates: mergedDates,
                watchDate: mergedDates[0] || null,
                rating: typeof rating === 'number' ? rating : existing.rating,
                note: note || existing.note || null,
                inCinema: typeof item?.inCinema !== 'undefined'
                    ? inCinema
                    : (existing.inCinema ?? false),
            };
        } else {
            const watchDates = combinedDates;
            watched.unshift({
                id: tmdbId,
                title,
                mediaType,
                status: 'watched',
                watchDates,
                watchDate: watchDates[0] || null,
                rating: typeof rating === 'number' ? rating : null,
                note,
                inCinema,
            });
        }

        imported += 1;
    }

    library.watching = watching;
    library.watched = sortByWatchDateDesc(watched);
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
